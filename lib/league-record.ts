import { summarizeLeagueEpisode, tallyLeagueOutcomes, type LeagueOutcome, type LeagueTally } from "./league-episodes";
import { getEpisodeResults, leagueRoundNumbers, listPolicyVersionEpisodeRequests } from "./softmax";

export const leagueWindowHours = 72;
export type LeagueRecord = LeagueTally & {
  window_hours: number;
  /** False when the window holds more episodes than one read is allowed to page through. */
  complete: boolean;
};

// A finished episode never changes, so each one is read from Softmax once per server instance.
type Known = { at: number; outcome: LeagueOutcome | null };
const known = new Map<string, Map<string, Known>>();
const fresh = new Map<string, { at: number; record: Promise<LeagueRecord> }>();
const maxPages = 30;

async function read(token: string, policyVersionId: string): Promise<LeagueRecord> {
  const since = Date.now() - leagueWindowHours * 3600_000;
  const episodes = known.get(policyVersionId) ?? new Map<string, Known>();
  known.set(policyVersionId, episodes);
  let cursor: string | null = null;
  let complete = true;
  for (let page = 0; ; page += 1) {
    if (page === maxPages) { complete = false; break; }
    const batch = await listPolicyVersionEpisodeRequests(token, policyVersionId, cursor, 100);
    const finished = batch.entries.filter((entry) => entry.round_id && entry.status === "completed" && new Date(entry.created_at).getTime() >= since);
    const unread = finished.filter((entry) => !episodes.has(entry.id));
    const rounds = await leagueRoundNumbers(token, [...new Set(unread.map((entry) => entry.round_id!))]);
    const inLeague = unread.filter((entry) => rounds.has(entry.round_id!));
    const results = (await Promise.all(Array.from({ length: Math.ceil(inLeague.length / 50) }, (_, index) =>
      getEpisodeResults(token, inLeague.slice(index * 50, index * 50 + 50).map((entry) => entry.id))))).flat();
    const resultById = new Map(results.map((result) => [result.id, result]));
    for (const entry of unread) {
      const result = resultById.get(entry.id);
      episodes.set(entry.id, {
        at: new Date(entry.created_at).getTime(),
        outcome: result ? summarizeLeagueEpisode(policyVersionId, result.participants ?? [], result.participant_scores ?? [], true).outcome : null,
      });
    }
    const oldest = batch.entries.at(-1);
    // Stop at the end of the list, at the edge of the window, or once a whole page was already read:
    // everything older than that page was read by an earlier pass.
    if (!batch.next_cursor || !oldest || new Date(oldest.created_at).getTime() < since) break;
    if (finished.length > 0 && unread.length === 0) break;
    cursor = batch.next_cursor;
  }
  for (const [id, episode] of episodes) if (episode.at < since) episodes.delete(id);
  return { ...tallyLeagueOutcomes([...episodes.values()].map((episode) => episode.outcome)), window_hours: leagueWindowHours, complete };
}

/**
 * One policy version's league record over the last 72 hours, counted from its own round episodes.
 * Softmax's policy leaderboard counts a tie for first as a win, which turns every time-limit game
 * into a win; this count does not.
 */
export function leagueRecord(token: string, policyVersionId: string): Promise<LeagueRecord> {
  const recent = fresh.get(policyVersionId);
  if (recent && Date.now() - recent.at < 45_000) return recent.record;
  const record = read(token, policyVersionId);
  fresh.set(policyVersionId, { at: Date.now(), record });
  record.catch(() => fresh.delete(policyVersionId));
  return record;
}

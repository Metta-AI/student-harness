import { defineTool } from "eve/tools";
import { z } from "zod";
import { trackServer } from "../../lib/analytics-server";
import { events } from "../../lib/analytics-events";
import { latestPolicyVersion, policyVersionByRevision } from "../../lib/db";
import { leagueRecord } from "../../lib/league-record";
import { leagueState } from "../../lib/league-results";
import { getLeagueStandings, getCompetitionDivision, getLeague, getPolicyLeaderboard, listLeagueSubmissions } from "../../lib/softmax";
import { requireStudentToken } from "../lib/student";

export default defineTool({
  description: "Read this revision's actual submission to the configured GoTA league and its separate 72-hour league results. A missing leaderboard row does not mean the revision was never entered. Use for status, score, rank, and the win/loss/time-limit record; never infer submission from standings. A win is a destroyed enemy fort: a time-limit game scores 0 and is not a win.",
  inputSchema: z.object({ revision: z.number().int().positive().optional().describe("Saved revision to look up. Omit for the latest saved revision.") }),
  label: { start: () => "Read league standing" },
  async execute({ revision }, ctx) {
    const student = await requireStudentToken(ctx);
    const version = revision === undefined ? await latestPolicyVersion(student.subjectId) : await policyVersionByRevision(student.subjectId, revision);
    const [league, division, submissions] = await Promise.all([getLeague(student.token), getCompetitionDivision(student.token), listLeagueSubmissions(student.token)]);
    const [board, standings] = await Promise.all([getPolicyLeaderboard(student.token, division.id).then(rows=>rows??[]), getLeagueStandings(student.token, division.id)]);
    const mine = version?.softmax_policy_version_id ? board.find((row) => row.policy_version_id === version.softmax_policy_version_id) ?? null : null;
    const submission = version?.softmax_policy_version_id ? submissions.find((entry) => entry.policy_version?.id === version.softmax_policy_version_id) ?? null : null;
    const playerStanding = standings.find(row=>row.player_id === (mine?.player_id ?? submission?.player?.id));
    // The leaderboard's own win column counts a tie for first as a win, so every time-limit game reads
    // as a win there. Count the record from the revision's league episodes instead.
    const record = mine && version?.softmax_policy_version_id ? await leagueRecord(student.token, version.softmax_policy_version_id) : null;
    await trackServer(student.subjectId, events.leagueStandingRead, { has_standing: !!mine, win_rate: record?.games ? record.wins / record.games : undefined, games: record?.games, rank: playerStanding?.rank });
    return {
      league: { name: league.name, rounds_paused: !!league.rounds_paused_at, submissions_locked: !!league.submissions_locked_at },
      window_hours: 72,
      my_revision: version ? { revision: version.revision_number, uploaded_as: version.softmax_policy_label, player: version.softmax_player_name } : null,
      submission: submission ? { id: submission.id, status: submission.status, created_at: submission.created_at, auto_champion: submission.auto_champion } : null,
      league_state: leagueState(version?.softmax_policy_version_id ?? null, !!submission, mine?.episodes_played ?? 0),
      ranking_metric: "player MMR (across policy versions)",
      my_standing: playerStanding ?? null,
      revision_record_72h: record,
      win_rule: "A win is a destroyed enemy fort. A game that reaches the time limit scores 0 for both sides and is not a win. Never describe time-limit games as wins or fold them into a win rate.",
      entries: standings.length,
      note: submission && !mine ? "Submitted, but no games appear in the 72-hour leaderboard yet. Check again after league rounds." : undefined,
    };
  },
});

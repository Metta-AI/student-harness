import { defineTool } from "eve/tools";
import { z } from "zod";
import { listExperiments, listPolicyVersions } from "../../lib/db";
import { leagueRecord } from "../../lib/league-record";
import { bestLeagueRevision, leagueState } from "../../lib/league-results";
import { getCompetitionDivision, getPolicyLeaderboard, listLeagueSubmissions } from "../../lib/softmax";
import { requireStudentToken } from "../lib/student";

export default defineTool({
  description: "Compare all saved revisions with separate hosted self-play and live GoTA league evidence. Includes actual submission status even when a submitted revision has no leaderboard games. Rank league revisions by league score, never by hosted score or win rate alone. League wins are destroyed forts; time-limit games score 0 and are reported separately, never as wins.",
  inputSchema: z.object({}),
  label: { start: () => "List saved revisions" },
  async execute(_input, ctx) {
    const student = await requireStudentToken(ctx);
    const [versions, experiments] = await Promise.all([listPolicyVersions(student.subjectId), listExperiments(student.subjectId)]);
    const [division, submissions] = await Promise.all([getCompetitionDivision(student.token), listLeagueSubmissions(student.token)]);
    const board = (await getPolicyLeaderboard(student.token, division.id)) ?? [];
    // Wins come from each revision's own league episodes: the leaderboard counts time-limit ties as wins.
    const played = board.filter((row) => row.episodes_played > 0 && versions.some((version) => version.softmax_policy_version_id === row.policy_version_id));
    const records = new Map(await Promise.all(played.map(async (row) => [row.policy_version_id, await leagueRecord(student.token, row.policy_version_id).catch(() => null)] as const)));
    const revisions = versions.map((version) => {
        const games = experiments.filter((experiment) => experiment.policy_version_id === version.id);
        const scores = games.flatMap((game) => game.episodes.flatMap((episode) => episode.our_scores));
        const completed = games.filter((game) => game.status === "completed");
        const deaths = completed.map((game) => (game.summary as { mean_deaths_per_seat?: number | null } | null)?.mean_deaths_per_seat).filter((value): value is number => typeof value === "number");
        const standing = board.find((row) => row.policy_version_id === version.softmax_policy_version_id);
        const submission = submissions.find((entry) => entry.policy_version?.id === version.softmax_policy_version_id);
        return {
          revision: version.revision_number, summary: version.summary, created_at: version.created_at, evidence: version.evidence,
          uploaded_as: version.softmax_policy_label, player: version.softmax_player_name, policy_version_id: version.softmax_policy_version_id,
          hosted_games: games.map((game) => ({ xp_request_id: game.xp_request_id, title: game.title, status: game.status, hypothesis: game.hypothesis })),
          hosted_mean_score: scores.length ? scores.reduce((total, score) => total + score, 0) / scores.length : null,
          hosted_scored_seats: scores.length,
          hosted_completed_games: completed.length,
          hosted_mean_deaths_per_seat: deaths.length ? deaths.reduce((total, value) => total + value, 0) / deaths.length : null,
          hosted_death_samples: deaths.length,
          league_state: leagueState(version.softmax_policy_version_id, !!submission, standing?.episodes_played ?? 0),
          league_submission: submission ? { id: submission.id, status: submission.status, created_at: submission.created_at } : null,
          league_result_72h: standing ? (() => {
            const record = records.get(standing.policy_version_id);
            return { score: standing.score, games: record?.games ?? standing.episodes_played, ...(record ? { wins: record.wins, losses: record.losses, time_limits: record.time_limits } : {}) };
          })() : null,
        };
      });
    return {
      revisions,
      best_league_revision_72h: bestLeagueRevision(revisions),
      league_ranking_metric: "72h policy mean score; not official player MMR rank",
      note: versions.length ? undefined : "No saved revisions yet; the working copy is the official starter policy.",
    };
  },
});

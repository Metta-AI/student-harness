import { defineTool } from "eve/tools";
import { z } from "zod";
import { trackServer } from "../../lib/analytics-server";
import { events } from "../../lib/analytics-events";
import { latestPolicyVersion, policyVersionByRevision } from "../../lib/db";
import { leagueState } from "../../lib/league-results";
import { getCompetitionDivision, getLeague, getPolicyLeaderboard, listLeagueSubmissions } from "../../lib/softmax";
import { requireStudentToken } from "../lib/student";

export default defineTool({
  description: "Read this revision's actual NeuralHub submission and its separate 72-hour league results. A missing leaderboard row does not mean the revision was never entered. Use for status, score, rank, and wins; never infer submission from standings.",
  inputSchema: z.object({ revision: z.number().int().positive().optional().describe("Saved revision to look up. Omit for the latest saved revision.") }),
  label: { start: () => "Read league standing" },
  async execute({ revision }, ctx) {
    const student = await requireStudentToken(ctx);
    const version = revision === undefined ? await latestPolicyVersion(student.subjectId) : await policyVersionByRevision(student.subjectId, revision);
    const [league, division, submissions] = await Promise.all([getLeague(student.token), getCompetitionDivision(student.token), listLeagueSubmissions(student.token)]);
    const board = (await getPolicyLeaderboard(student.token, division.id)) ?? [];
    const mine = version?.softmax_policy_version_id ? board.find((row) => row.policy_version_id === version.softmax_policy_version_id) ?? null : null;
    const submission = version?.softmax_policy_version_id ? submissions.find((entry) => entry.policy_version?.id === version.softmax_policy_version_id) ?? null : null;
    await trackServer(student.subjectId, events.leagueStandingRead, { has_standing: !!mine, win_rate: mine?.win_rate, games: mine?.episodes_played, rank: mine?.rank });
    return {
      league: { name: league.name, rounds_paused: !!league.rounds_paused_at, submissions_locked: !!league.submissions_locked_at },
      window_hours: 72,
      my_revision: version ? { revision: version.revision_number, uploaded_as: version.softmax_policy_label } : null,
      submission: submission ? { id: submission.id, status: submission.status, created_at: submission.created_at, auto_champion: submission.auto_champion } : null,
      league_state: leagueState(version?.softmax_policy_version_id ?? null, !!submission, mine?.episodes_played ?? 0),
      my_standing: mine ? { rank: mine.rank, wins: mine.wins, games: mine.episodes_played, win_rate: mine.win_rate, score: mine.score } : null,
      entries: board.length,
      note: submission && !mine ? "Submitted, but no games appear in the 72-hour leaderboard yet. Check again after league rounds." : undefined,
    };
  },
});

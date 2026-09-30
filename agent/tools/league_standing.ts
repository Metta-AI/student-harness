import { defineTool } from "eve/tools";
import { z } from "zod";
import { trackServer } from "../../lib/analytics-server";
import { events } from "../../lib/analytics-events";
import { latestPolicyVersion, policyVersionByRevision } from "../../lib/db";
import { getCompetitionDivision, getLeague, getPolicyLeaderboard } from "../../lib/softmax";
import { requireStudentToken } from "../lib/student";

export default defineTool({
  description: "Read the live league: whether rounds are running, the competition leaderboard top entries, and this student's uploaded revision's standing (wins, games, win rate, score over the last 72 hours) if it has played.",
  inputSchema: z.object({ revision: z.number().int().positive().optional().describe("Saved revision to look up. Omit for the latest uploaded one.") }),
  label: { start: () => "Read league standing" },
  async execute({ revision }, ctx) {
    const student = await requireStudentToken(ctx);
    const version = revision === undefined ? await latestPolicyVersion(student.subjectId) : await policyVersionByRevision(student.subjectId, revision);
    const [league, division] = await Promise.all([getLeague(student.token), getCompetitionDivision(student.token)]);
    const board = (await getPolicyLeaderboard(student.token, division.id)) ?? [];
    const mine = version?.softmax_policy_version_id ? board.find((row) => row.policy_version_id === version.softmax_policy_version_id) ?? null : null;
    await trackServer(student.subjectId, events.leagueStandingRead, { has_standing: !!mine, win_rate: mine?.win_rate, games: mine?.episodes_played, rank: mine?.rank });
    return {
      league: { name: league.name, rounds_paused: !!league.rounds_paused_at, submissions_locked: !!league.submissions_locked_at },
      window_hours: 72,
      my_revision: version ? { revision: version.revision_number, uploaded_as: version.softmax_policy_label } : null,
      my_standing: mine ? { rank: mine.rank, wins: mine.wins, games: mine.episodes_played, win_rate: mine.win_rate, score: mine.score } : null,
      top: board.slice(0, 5).map((row) => ({ rank: row.rank, policy: row.policy_label, player: row.player_name, win_rate: row.win_rate, games: row.episodes_played, score: row.score })),
      entries: board.length,
      caveat: mine ? undefined : "This revision has no league games in the window. A policy plays in the league only after enter_league.",
    };
  },
});

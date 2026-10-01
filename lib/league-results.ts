export type LeagueState = "not_uploaded" | "not_entered" | "entered_no_games" | "played";

/** Submission existence and leaderboard participation are different facts. */
export function leagueState(policyVersionId: string | null, submitted: boolean, games: number): LeagueState {
  if (!policyVersionId) return "not_uploaded";
  if (!submitted) return "not_entered";
  return games > 0 ? "played" : "entered_no_games";
}

export function bestLeagueRevision(revisions: { revision: number; league_result_72h: { score: number; games: number } | null }[]) {
  return revisions.filter((item) => item.league_result_72h && item.league_result_72h.games > 0)
    .sort((a, b) => b.league_result_72h!.score - a.league_result_72h!.score
      || b.league_result_72h!.games - a.league_result_72h!.games
      || b.revision - a.revision)[0]?.revision ?? null;
}

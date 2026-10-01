/** One seat in a league episode, as Softmax reports it. Human seats carry no policy. */
export type LeagueParticipant = {
  position: number;
  policy_version_id?: string;
  policy_name?: string;
  version?: number;
  player_name?: string | null;
};
export type LeagueSide = "Red" | "Blue";
export type LeagueOutcome = "won" | "lost" | "time_limit";
export type LeagueRival = { policyVersionId: string | null; policy: string; player: string | null; seats: number };
export type LeagueEpisodeSummary = {
  /** Seats this policy version controlled. */
  seats: number[];
  /** The side those seats played, or null when the policy sat on both sides. */
  side: LeagueSide | null;
  /** "team": this policy controlled its whole side. "mixed": it shared the side with other policies. */
  format: "team" | "mixed";
  /** Mean score across the heroes this policy controlled. */
  score: number | null;
  outcome: LeagueOutcome | null;
  teammates: LeagueRival[];
  opponents: LeagueRival[];
};

function groupRivals(seats: LeagueParticipant[]): LeagueRival[] {
  const rivals = new Map<string, LeagueRival>();
  for (const seat of seats) {
    const key = seat.policy_version_id ?? `seat:${seat.position}`;
    const rival = rivals.get(key);
    if (rival) rival.seats += 1;
    else rivals.set(key, {
      policyVersionId: seat.policy_version_id ?? null,
      policy: seat.policy_name ? `${seat.policy_name}${seat.version === undefined ? "" : `:v${seat.version}`}` : "Human player",
      player: seat.player_name ?? null,
      seats: 1,
    });
  }
  return [...rivals.values()];
}

/**
 * Read one league episode from one policy version's point of view.
 *
 * Gods of the Arena seats the first half of the roster as Red (team 0) and the second half as Blue
 * (team 1). Every hero on the winning side gets a positive score and the losing side gets 0; a match
 * that reaches the time limit with no fort destroyed scores 0 for all ten heroes. So the outcome is
 * read from the two side totals, not from one hero's score.
 */
export function summarizeLeagueEpisode(
  policyVersionId: string,
  participants: LeagueParticipant[],
  seatScores: { position: number; score: number }[],
  completed: boolean,
): LeagueEpisodeSummary {
  const half = participants.length / 2;
  const sideOf = (position: number): LeagueSide => (position < half ? "Red" : "Blue");
  const mine = participants.filter((seat) => seat.policy_version_id === policyVersionId);
  const sides = new Set(mine.map((seat) => sideOf(seat.position)));
  const side = sides.size === 1 ? [...sides][0]! : null;
  const others = participants.filter((seat) => seat.policy_version_id !== policyVersionId);
  const teammates = side ? groupRivals(others.filter((seat) => sideOf(seat.position) === side)) : [];
  const opponents = side ? groupRivals(others.filter((seat) => sideOf(seat.position) !== side)) : groupRivals(others);
  const scoreAt = new Map(seatScores.map((seat) => [seat.position, seat.score]));
  const scored = completed && mine.length > 0 && mine.every((seat) => scoreAt.has(seat.position));
  const total = (wanted: LeagueSide) => participants.filter((seat) => sideOf(seat.position) === wanted).reduce((sum, seat) => sum + (scoreAt.get(seat.position) ?? 0), 0);
  let outcome: LeagueOutcome | null = null;
  if (scored && side) {
    const ours = total(side);
    const theirs = total(side === "Red" ? "Blue" : "Red");
    outcome = ours > theirs ? "won" : theirs > ours ? "lost" : ours === 0 ? "time_limit" : null;
  }
  return {
    seats: mine.map((seat) => seat.position),
    side,
    format: teammates.length ? "mixed" : "team",
    score: scored ? mine.reduce((sum, seat) => sum + scoreAt.get(seat.position)!, 0) / mine.length : null,
    outcome,
    teammates,
    opponents,
  };
}

export type LeagueTally = { games: number; wins: number; losses: number; time_limits: number };

/**
 * Count league results. A win is a destroyed enemy fort. A match that reaches the time limit scores 0
 * for both sides and is not a win, whatever a leaderboard that counts ties for first may report.
 */
export function tallyLeagueOutcomes(outcomes: (LeagueOutcome | null)[]): LeagueTally {
  const count = (wanted: LeagueOutcome) => outcomes.filter((outcome) => outcome === wanted).length;
  const tally = { wins: count("won"), losses: count("lost"), time_limits: count("time_limit") };
  return { games: tally.wins + tally.losses + tally.time_limits, ...tally };
}

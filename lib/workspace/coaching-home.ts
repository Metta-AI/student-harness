export type ReviewReplay = {
  id: string; label: string; kind: "league" | "practice"; outcome: "won" | "lost" | "time_limit" | null;
  createdAt: string; opponents: string; episodeId?: string | null;
};

/** Review suggestions are based on recorded outcomes, not inferred gameplay events. */
export function reviewSuggestions(replays: ReviewReplay[]) {
  const newest = [...replays].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const selected: ReviewReplay[] = [];
  for (const outcome of ["lost", "time_limit", "won"] as const) {
    const replay = newest.find(item => item.outcome === outcome);
    if (replay) selected.push(replay);
  }
  for (const replay of newest) if (selected.length < 3 && !selected.some(item => item.id === replay.id)) selected.push(replay);
  return selected.map(replay => ({ ...replay,
    title: replay.outcome === "lost" ? "Find the turning point" : replay.outcome === "time_limit" ? "What kept us from finishing?" : replay.outcome === "won" ? "Find a decision worth repeating" : "Give Preston a fresh pair of eyes",
    question: replay.outcome === "lost" ? "Where would you have made a different decision? Mark the moment and explain why."
      : replay.outcome === "time_limit" ? "Did we miss a chance to make progress? Point out one opportunity in the replay."
      : replay.outcome === "won" ? "Which decision helped us win? Show Preston what to preserve."
      : "Watch for a decision you would change, then leave a coaching note.",
  }));
}

export function performanceAssessment(rank: number | undefined, players: number, record: {games:number;wins:number;losses:number;time_limits:number;window_hours:number;complete:boolean} | null) {
  const standing = rank ? `You’re #${rank} among ${players} ranked players.` : "Your player has no published rank yet.";
  if (!record) return `${standing} Results for the selected policy are not available yet.`;
  if (!record.games) return `${standing} We need completed games for this policy before assessing its results.`;
  const results = `${record.wins} wins, ${record.losses} losses, and ${record.time_limits} time limits in ${record.games} episodes over ${record.window_hours} hours${record.complete ? "." : " (partial sample)."}`;
  const focus = record.time_limits > record.games / 2 ? "Start by reviewing a time-limit replay for missed chances to finish."
    : record.losses ? "Compare a loss with a win and mark one decision you would change." : "Review a win and identify the decisions you want to preserve.";
  return `${standing} ${results} ${focus}`;
}

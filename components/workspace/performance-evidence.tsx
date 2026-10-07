"use client";
import { useId } from "react";
import { Activity } from "lucide-react";
import type { LeagueStanding } from "../../lib/softmax";
import { PerformanceLeaderboard } from "./performance-overview";
export type PerformanceVersion = { id: string; revision: number; summary: string; hostedMean: number | null; completedGames: number; scored: number; policyVersionId: string | null };
export type PerformanceRound = { id: string; created_at: string; outcome: "won" | "lost" | "time_limit" | null; score: number | null; opponents: { policy: string; player?: string | null }[]; round: { number: number } };
const outcomeLabel = { won: "Win", lost: "Loss", time_limit: "Time limit" };
export function PerformanceEvidence({ standings, ownPlayerIds, activePlayerId, rounds, last = 10, opponent = "", loading = false, error, onRound }: {
  standings: LeagueStanding[]; ownPlayerIds: string[]; activePlayerId?: string | null;
  rounds: PerformanceRound[]; last?: number; opponent?: string; loading?: boolean; error?: string; onRound?: (id: string) => void;
}) {
  const chartId = useId();
  const finished = [...new Map(rounds.map(r => [r.id, r])).values()]
    .filter(r => r.outcome && (!opponent || r.opponents.some(o => `${o.player ?? ""} ${o.policy}`.toLowerCase().includes(opponent.toLowerCase()))))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, last);
  const chronological = [...finished].reverse();
  let wins = 0;
  const points = chronological.map((r, i) => {
    if (r.outcome === "won") wins++;
    return { round: r, rate: wins / (i + 1) * 100, x: chronological.length === 1 ? 340 : 50 + i / (chronological.length - 1) * 590, y: 140 - wins / (i + 1) * 115 };
  });
  return <div className="performance-evidence-grid">
    <PerformanceLeaderboard standings={standings} ownPlayerIds={ownPlayerIds} activePlayerId={activePlayerId} loading={loading} />
    <section className="performance-form" aria-label="Recent outcome trend">
      <div className="performance-section-heading"><div><span className="performance-eyebrow">MATCH BY MATCH</span><h3>Recent outcomes</h3></div><Activity size={20} aria-hidden="true" /></div>
      {finished.length ? <>
        <div className="performance-form-score"><strong>{Math.round(wins / finished.length * 100)}<small>%</small></strong><div>Win rate<small>{wins} wins in {finished.length} completed episodes{opponent ? ` · ${opponent}` : ""}</small></div></div>
        <svg className="performance-form-chart" viewBox="0 0 670 180" role="img" aria-labelledby={chartId}>
          <title id={chartId}>Cumulative win rate across {finished.length} recent episodes, oldest to newest. Latest: {Math.round(wins / finished.length * 100)} percent. Time limits count as non-wins.</title>
          {[0, 50, 100].map(rate => <g key={rate}><line x1="50" x2="640" y1={140 - rate * 1.15} y2={140 - rate * 1.15} stroke="#dfe5d6" strokeDasharray="3 5" /><text x="40" y={144 - rate * 1.15} textAnchor="end">{rate}%</text></g>)}
          <polyline points={points.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#426a49" strokeWidth="3" strokeLinejoin="round" />
          {points.map(p => <circle key={p.round.id} cx={p.x} cy={p.y} r="5" fill={p.round.outcome === "won" ? "#426a49" : p.round.outcome === "lost" ? "#b96d55" : "#ad8b3b"} stroke="#fffdf4" strokeWidth="2"><title>Round {p.round.round.number}: {outcomeLabel[p.round.outcome!]} · {Math.round(p.rate)}% cumulative win rate</title></circle>)}
          <text x="50" y="169">Oldest</text><text x="640" y="169" textAnchor="end">Latest</text>
        </svg>
        <p className="performance-chart-caption">Cumulative win rate in this selection · time limits count as non-wins</p>
        <div className="performance-form-strip" aria-label="Recent results, oldest to newest">{chronological.map(r => <button key={r.id} className={`performance-result ${r.outcome}`} onClick={() => onRound?.(r.id)} disabled={!onRound} aria-label={`Round ${r.round.number}: ${outcomeLabel[r.outcome!]}${onRound ? ". Open replay" : ""}`} title={`Round ${r.round.number}: ${outcomeLabel[r.outcome!]}`}>{r.outcome === "won" ? "W" : r.outcome === "lost" ? "L" : "T"}</button>)}</div>
        <div className="performance-outcome-key"><span><i className="won" /> Win</span><span><i className="lost" /> Loss</span><span><i className="time_limit" /> Time limit</span></div>
        <details className="performance-match-details"><summary>Explore {finished.length} recent episodes</summary><div className="workspace-table-scroll"><table className="workspace-table"><thead><tr><th>Played</th><th>Opponent</th><th>Result</th><th>Score</th></tr></thead><tbody>{finished.map(r => <tr key={r.id}><td><button className="text-button" onClick={() => onRound?.(r.id)} disabled={!onRound}>{new Date(r.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ↗</button></td><td>{r.opponents.map(o => o.player ?? o.policy).join(", ") || "—"}</td><td>{outcomeLabel[r.outcome!]}</td><td>{r.score?.toFixed(1) ?? "—"}</td></tr>)}</tbody></table></div></details>
      </> : <div className="performance-empty"><Activity size={28} aria-hidden="true" /><strong>{error ? "Results are taking a breather" : loading ? "Gathering your matches…" : opponent ? "No matches against this opponent" : "Your story is still unfolding"}</strong><p>{error ? "Recent episodes could not load. Use Refresh to retry." : loading ? "Loading results…" : "No completed league episodes in this selection."}</p></div>}
    </section>
  </div>;
}

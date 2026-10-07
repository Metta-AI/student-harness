"use client";

import { useId, useState } from "react";
import { Crown, Flag, Sparkles, Trophy } from "lucide-react";

export type PerformanceStanding = {
  player_id: string; player_name?: string | null; policy_label?: string | null;
  rank?: number | null; score: number; score_label?: string; score_value_type?: string;
  rounds_played: number; settling?: boolean;
};

export function formatPerformanceScore(score: number, type?: string) {
  return type === "percent" ? `${(score * 100).toFixed(1)}%` : score.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function PerformanceOverview({ standings, activePlayerId, loading = false, leagueName, record }: {
  standings: PerformanceStanding[]; activePlayerId?: string | null; loading?: boolean; leagueName: string;
  record?: { games: number; wins: number; losses: number; time_limits: number; complete: boolean; window_hours: number } | null;
}) {
  const active = standings.find(p => p.player_id === activePlayerId);
  const ranked = standings.filter(p => p.rank != null && p.rank > 0);
  const aheadOf = active?.rank ? ranked.filter(p => p.rank! > active.rank!).length : 0;
  const rank = active?.rank && active.rank > 0 ? active.rank : null;
  const title = loading ? "Finding your place…" : rank === 1 ? "Leading the pack." : rank && rank <= 3 ? "On the podium." : rank ? "In the arena." : "Your next chapter starts here.";
  return <section className="performance-overview" aria-label="League summary" aria-busy={loading}>
    <div className="performance-banner">
      <div><span className="performance-eyebrow"><Sparkles size={13} aria-hidden="true" /> {leagueName}</span><h3>{title}</h3><p>{active ? <>{active.player_name ?? active.player_id}<span> · {active.policy_label ?? "Current league entry"}</span></> : loading ? "Loading official standings" : "No ranked entry for this selection yet."}</p></div>
      <div className="performance-emblem" aria-hidden="true"><Trophy size={36} strokeWidth={1.5} /><span>LEAGUE PLAY</span></div>
    </div>
    <div className="performance-stats">
      <article className="performance-stat performance-stat-rank"><span><Trophy size={15} aria-hidden="true" /> League rank</span><strong>{rank ? `#${rank}` : "—"}</strong><small>{rank ? `Among ${ranked.length} ranked players${ranked.some(p => p.rank! > ranked.length) ? " shown" : ""}` : loading ? "Loading…" : "Not ranked"}</small><div className="performance-rank-track" aria-hidden="true"><i style={{ width: `${rank ? (ranked.length > 1 ? aheadOf / (ranked.length - 1) : 1) * 100 : 0}%` }} /></div><small>{rank ? `${aheadOf} ${aheadOf === 1 ? "player" : "players"} behind you` : "A place on the board awaits"}</small></article>
      <article className="performance-stat"><span><Sparkles size={15} aria-hidden="true" /> {active?.score_label ?? standings[0]?.score_label ?? "League score"}</span><strong>{active ? formatPerformanceScore(active.score, active.score_value_type) : "—"}</strong><small>Official competition score</small><span className="performance-pill">{active?.settling ? "Rating settling" : active ? "Current standing" : "Awaiting a ranking"}</span></article>
      <article className="performance-stat"><span><Flag size={15} aria-hidden="true" /> {record !== undefined ? `Policy wins · ${record?.window_hours ?? 72}h` : "Rounds played"}</span><strong>{record !== undefined ? record?.games ? `${Math.round(record.wins / record.games * 100)}%` : "—" : active?.rounds_played.toLocaleString() ?? "—"}</strong><small>{record !== undefined ? record ? `${record.wins} wins · ${record.losses} losses · ${record.time_limits} time limits` : "No policy results available yet" : "With this player in this division"}</small><span className="performance-pill">{record !== undefined ? record ? `${record.games} episodes${record.complete ? "" : " · partial sample"}` : "Awaiting results" : `${standings.length} players in the field`}</span></article>
    </div>
  </section>;
}

export function PerformanceLeaderboard({ standings, ownPlayerIds, activePlayerId, loading = false }: {
  standings: PerformanceStanding[]; ownPlayerIds: string[]; activePlayerId?: string | null; loading?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const chartId = useId();
  const sorted = [...standings].sort((a, b) => (a.rank || Infinity) - (b.rank || Infinity));
  const activeIndex = sorted.findIndex(p => p.player_id === activePlayerId);
  const visible = showAll ? sorted : sorted.filter((p, i) => i < 3 || ownPlayerIds.includes(p.player_id) || (activeIndex >= 0 && Math.abs(i - activeIndex) <= 1));
  const metric = sorted[0]?.score_label ?? "Score";
  const low = Math.min(...sorted.map(p => p.score));
  const high = Math.max(...sorted.map(p => p.score));
  const padding = high === low ? Math.max(Math.abs(high) * .1, 1) : (high - low) * .15;
  const min = low - padding, max = high + padding;
  const x = (i: number) => sorted.length === 1 ? 330 : 55 + i / (sorted.length - 1) * 585;
  const y = (score: number) => 145 - (score - min) / (max - min) * 120;
  const selected = sorted.find(p => p.player_id === hovered) ?? sorted[activeIndex] ?? sorted[0];
  return <section className="performance-board" aria-label="Leaderboard">
    <div className="performance-section-heading"><div><span className="performance-eyebrow">THE BIG PICTURE</span><h3>You and the field</h3></div><span className="performance-chart-key"><i /> Your player</span></div>
    {sorted.length ? <>
      <div className="performance-chart-readout" aria-live="polite"><strong>{selected?.player_name ?? selected?.player_id}</strong><span>{selected?.rank ? `#${selected.rank} · ` : ""}{selected ? formatPerformanceScore(selected.score, selected.score_value_type) : "—"} {metric}</span></div>
      <svg className="performance-field-chart" viewBox="0 0 670 180" role="group" aria-label={`${metric} across the current leaderboard. Each dot is a player, ordered by official rank.`}>
        <defs><linearGradient id={chartId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#7b9962" stopOpacity=".22" /><stop offset="100%" stopColor="#7b9962" stopOpacity="0" /></linearGradient></defs>
        {[0, .5, 1].map(t => <g key={t}><line x1="55" x2="640" y1={25 + t * 120} y2={25 + t * 120} stroke="#dfe5d6" strokeDasharray="3 5" /><text x="46" y={29 + t * 120} textAnchor="end">{formatPerformanceScore(max - t * (max - min), sorted[0].score_value_type)}</text></g>)}
        {sorted.length > 1 ? <><path d={`M55,145 ${sorted.map((p, i) => `L${x(i)},${y(p.score)}`).join(" ")} L640,145 Z`} fill={`url(#${chartId})`} /><polyline points={sorted.map((p, i) => `${x(i)},${y(p.score)}`).join(" ")} fill="none" stroke="#9aaa87" strokeWidth="2" /></> : null}
        {sorted.map((p, i) => <g key={p.player_id}>
          {p.player_id === activePlayerId ? <line x1={x(i)} x2={x(i)} y1={y(p.score)} y2="145" stroke="#426a49" strokeDasharray="4 4" /> : null}
          <circle cx={x(i)} cy={y(p.score)} r={p.player_id === activePlayerId ? 8 : 4} fill={p.player_id === activePlayerId ? "#315b40" : "#a6b493"} stroke="#fffdf4" strokeWidth="2" />
          <circle className="performance-chart-point" cx={x(i)} cy={y(p.score)} r="12" fill="transparent" tabIndex={0} role="img" aria-label={`${p.player_name ?? p.player_id}, ${p.rank ? `rank ${p.rank}, ` : ""}${formatPerformanceScore(p.score, p.score_value_type)} ${metric}${p.player_id === activePlayerId ? ", your selected player" : ""}`} onClick={() => setHovered(p.player_id)} onMouseEnter={() => setHovered(p.player_id)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(p.player_id)} onBlur={() => setHovered(null)}><title>{p.player_name ?? p.player_id}: {formatPerformanceScore(p.score, p.score_value_type)} {metric}</title></circle>
        </g>)}
        <text x="55" y="172">{sorted[0].rank ? `#${sorted[0].rank}` : "First player"}</text><text x="640" y="172" textAnchor="end">{sorted.at(-1)?.rank ? `#${sorted.at(-1)!.rank}` : "Last player"}</text><text x="345" y="172" textAnchor="middle">Leaderboard position</text>
      </svg>
      <p className="performance-chart-caption">Current {metric.toLowerCase()} by player · hover or focus a dot to explore</p>
    </> : <div className="performance-empty"><Trophy size={28} aria-hidden="true" /><strong>{loading ? "Finding the field…" : "The leaderboard is warming up"}</strong><p>{loading ? "Loading official league results." : "Ranked players will appear here when standings are published."}</p></div>}
    <div className="performance-section-heading performance-table-heading"><h4>Leaderboard</h4>{sorted.length > visible.length || showAll ? <button className="text-button" onClick={() => setShowAll(v => !v)} aria-expanded={showAll}>{showAll ? "Leaders + near you" : `All ${sorted.length} players`} <span aria-hidden="true">↗</span></button> : <span>Current standings</span>}</div>
    <div className="workspace-table-scroll"><table className="workspace-table performance-leaderboard"><thead><tr><th>Rank</th><th>Player / current policy</th><th>{metric}</th><th>Rounds</th></tr></thead><tbody>{visible.map(p => <tr key={p.player_id} className={p.player_id === activePlayerId ? "our-policy" : ""}><td><span className={`performance-place ${p.rank === 1 ? "first" : ""}`}>{p.rank === 1 ? <Crown size={13} aria-hidden="true" /> : null}{p.rank ? `#${p.rank}` : "—"}</span></td><td><strong>{p.player_name ?? p.player_id}</strong>{ownPlayerIds.includes(p.player_id) ? <span className="performance-you">{p.player_id === activePlayerId ? "YOU" : "YOURS"}</span> : null}<small className="league-policy-label">{p.policy_label ?? "Policy not reported"}</small></td><td>{formatPerformanceScore(p.score, p.score_value_type)}{p.settling ? <small> · settling</small> : null}</td><td>{p.rounds_played.toLocaleString()}</td></tr>)}</tbody></table></div>
  </section>;
}

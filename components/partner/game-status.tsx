"use client";
import type { LeagueOutcome } from "../../lib/league-episodes";

type Record = { games: number; wins: number; losses: number; time_limits: number; window_hours: number; complete: boolean };
type Recent = { id: string; outcome: LeagueOutcome | null; round: { number: number } };
const outcomeLabel = { won: "Win", lost: "Loss", time_limit: "Time limit" };

export function GameStatus({ record, standing, recent, policy, entered, loaded, error, paused, onMatches, onRound, disabled }: {
  record: Record | null; standing?: { rank: number; score: number }; recent: Recent[];
  policy: string | null; entered: boolean; loaded: boolean; error: boolean; paused: boolean | null;
  onMatches: () => void; onRound: (id: string) => void; disabled: boolean;
}) {
  const rate = record?.games ? Math.round(record.wins / record.games * 100) : null;
  const wins = record?.games ? record.wins / record.games * 100 : 0;
  const losses = record?.games ? record.losses / record.games * 100 : 0;
  const latest = recent.filter(r => r.outcome).slice(0, 6).reverse();
  return <aside className="game-scorecard" aria-label="Game performance">
    <div className="scorecard-live"><i className={paused === null ? "unknown" : paused ? "paused" : ""} />{paused === null ? "Connecting" : paused ? "Rounds paused" : "Rounds live"}</div>
    <button type="button" className="scorecard-ring-button" disabled={disabled} onClick={onMatches} aria-label={rate === null ? "Open league results" : `Open league results: ${rate}% wins in ${record!.games} games`}>
      <div className="scorecard-ring" style={{ background: rate === null ? "#e7e6d8" : `conic-gradient(#76956b 0% ${wins}%, #c59074 ${wins}% ${wins + losses}%, #dcd9c6 ${wins + losses}% 100%)` }}><div><strong>{rate === null ? "—" : `${rate}%`}</strong><span>{record && !record.complete ? "sample win rate" : "win rate"}</span></div></div>
    </button>
    <p className="scorecard-sample">{error ? "Updates unavailable" : !loaded ? "Loading results…" : !policy ? "No uploaded policy yet" : !entered && !record?.games ? "Not entered in the league" : record?.games ? `${record.games} games · ${record.window_hours}h${record.complete ? "" : " · partial sample"}` : "No recorded games yet"}</p>
    <dl className="scorecard-record"><div><dt><i className="win" />Wins</dt><dd>{record ? record.wins : "—"}</dd></div><div><dt><i className="loss" />Losses</dt><dd>{record ? record.losses : "—"}</dd></div><div><dt><i className="limit" />Time limits</dt><dd>{record ? record.time_limits : "—"}</dd></div></dl>
    <button type="button" className="scorecard-rank" disabled={disabled} onClick={onMatches}><span>League rank</span><strong>{standing ? `#${standing.rank}` : "—"}<small>↗</small></strong></button>
    <div className="scorecard-recent"><h3>Recent episodes</h3><div>{latest.length ? latest.map(round => <button type="button" key={round.id} disabled={disabled} className={round.outcome!} title={`Round ${round.round.number} · ${outcomeLabel[round.outcome!]}`} aria-label={`Open round ${round.round.number}: ${outcomeLabel[round.outcome!]}`} onClick={() => onRound(round.id)}>{round.outcome === "won" ? "W" : round.outcome === "lost" ? "L" : "–"}</button>) : <span>{error ? "Recent episodes unavailable" : record?.games ? "Loading recent episodes…" : "Waiting for a first result"}</span>}</div>{latest.length ? <p>Older → newer</p> : null}</div>
    <p className="scorecard-policy">{policy ?? "Your policy starts here"}</p>
    <button type="button" className="scorecard-details" disabled={disabled} onClick={onMatches}>Explore results <span>↗</span></button>
  </aside>;
}

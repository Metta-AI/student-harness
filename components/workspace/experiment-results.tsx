"use client";

export type ExperimentResult = {
  xpRequestId: string; title: string; status: string; created_at: string;
  revision: number | null; completedGames: number; score: number | null; replayReady: boolean;
};

export function ExperimentResults({ experiments, loading, error, onInspect, onLab }: {
  experiments: ExperimentResult[]; loading: boolean; error: string;
  onInspect: (id: string) => void; onLab: () => void;
}) {
  return <section className="shared-experiments" aria-label="Experiment results">
    <header><div><span className="eyebrow">TRY, LEARN, IMPROVE</span><h2>Experiments</h2><p>What we tested and how your policy performed.</p></div><button className="text-button" onClick={onLab}>Explore research in Lab ↗</button></header>
    {loading ? <p role="status">Loading test results…</p> : !experiments.length ? <div className="experiment-results-empty"><h3>{error ? "Results are unavailable right now" : "Every good idea starts with a test"}</h3><p>{error ? "Retry loading the workspace to see your saved results." : "Ask Preston to test an idea. Completed games and their evidence will appear here."}</p></div> :
      <ul className="experiment-result-list">{experiments.map(experiment => <li key={experiment.xpRequestId}>
        <button className="experiment-result-card" onClick={() => onInspect(experiment.xpRequestId)}>
          <div><span className="experiment-result-status">{experiment.status.replaceAll("_", " ")}</span><h3>{experiment.title || "Hosted test"}</h3><p>{experiment.revision ? `Policy r${experiment.revision} · ` : ""}{new Date(experiment.created_at).toLocaleDateString()}</p></div>
          <dl><div><dt>Mean score</dt><dd>{experiment.score === null ? "—" : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(experiment.score)}</dd></div><div><dt>Games completed</dt><dd>{experiment.completedGames}</dd></div></dl>
          <span className="experiment-result-open">{experiment.replayReady ? "Results & replays" : "View test"} ↗</span>
        </button>
      </li>)}</ul>}
  </section>;
}

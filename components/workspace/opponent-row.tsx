"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, NotebookText } from "lucide-react";
import type { OpponentNotebook, OpponentProfile, OpponentResearchStatus } from "../../lib/opponents/model";
import { OpponentModel } from "./opponent-model";
import { pollWhileVisible } from "../../lib/browser-poll";

export function OpponentRow({ profile, researchStatus, base, tick, collectedAt, live, researchButton, onProfile, onOpenTask }: {
  profile: OpponentProfile; researchStatus?: OpponentResearchStatus; base: string; tick: number; collectedAt?: string; live: boolean;
  researchButton: ReactNode; onProfile: () => void; onOpenTask?: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [book, setBook] = useState<OpponentNotebook | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [showAllNotes, setShowAllNotes] = useState(false);
  const panelId = useId();
  const buttonId = useId();
  const name = profile.playerName ?? profile.policyLabel;

  useEffect(() => {
    if (!expanded) return;
    setError("");
    return pollWhileVisible(async signal => {
      const response = await fetch(`${base}&policy=${encodeURIComponent(profile.policyId)}`, { signal });
      if (!response.ok) throw Error("Could not load this opponent’s analysis.");
      const result: OpponentNotebook = await response.json();
      if (!signal.aborted) { setBook(result); setError(""); }
    }, cause => setError(cause.message));
  }, [expanded, base, profile.policyId, tick, retry]);

  const model = book?.models?.[0];
  const notes = book?.notes ?? [];
  const hasAnalysis = !!model || notes.length > 0;
  const savedAnalysis = hasAnalysis || !!researchStatus?.hasNotes || !!researchStatus?.hasModel;
  const activeTasks = book?.tasks?.filter(task => task.status === "queued" || task.status === "running") ?? [];

  return <>
    <tr className={`opponent-summary-row${expanded ? " is-expanded" : ""}`} onClick={event => {
      if ((event.target as HTMLElement).closest("button, a, input, select, textarea")) return;
      setExpanded(value => !value);
    }}>
      <td><button id={buttonId} className="opponent-row-toggle" aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded(value => !value)}>
        {expanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
        <span>{name}</span>
      </button><small className="opponent-row-policy">{profile.policyLabel}{live ? "" : " · last collected profile"}</small></td>
      <td>{profile.rank === null ? "—" : `#${profile.rank}`}</td>
      <td>{profile.rating === null ? "—" : `${profile.rating.toFixed(2)} ${profile.ratingLabel ?? ""}`}</td>
      <td>{profile.episodes}</td>
      <td><div className="opponent-row-research"><span className={savedAnalysis ? "opponent-analysis-badge" : "opponent-research-status"}>{savedAnalysis ? <><NotebookText size={12} aria-hidden="true" /> Saved analysis</> : activeTasks.length ? "Analysis in progress" : collectedAt ? `Collected ${new Date(collectedAt).toLocaleDateString()}` : "Not collected"}</span>{researchButton}</div></td>
    </tr>
    <tr id={panelId} className="opponent-analysis-row" hidden={!expanded}>
      <td colSpan={5}>
        {expanded ? <section className="opponent-inline-analysis" aria-labelledby={buttonId}>
          <header><div><span className="opponent-analysis-eyebrow">OPPONENT NOTEBOOK</span><h3>Saved analysis</h3><p>{profile.policyLabel}</p></div><button className="text-button" onClick={onProfile}>View full profile ↗</button></header>
          {error ? <p className="opponent-analysis-error" role="status">{error}{book ? " Showing previously loaded records." : ""} <button className="text-button" onClick={() => setRetry(value => value + 1)}>Retry analysis</button></p> : null}
          {!book && !error ? <p className="opponent-analysis-loading" role="status">Loading saved analysis…</p> : null}
          {book ? <>
            {model ? <div className="opponent-analysis-summary"><small>Observational model · {model.actor === "preston" ? "Preston" : "You"} · {new Date(model.created_at).toLocaleString()}</small><p>{model.document.summary}</p><details><summary>Explore semantic model & evidence</summary><OpponentModel models={book.models} snapshots={book.snapshots} /></details></div> : null}
            {notes.length ? <div className="opponent-inline-notes"><h4>Observations & hypotheses <span>{notes.length}</span></h4>{(showAllNotes ? notes : notes.slice(0, 3)).map(note => <article key={note.id}><small><span className={`opponent-note-kind ${note.kind}`}>{note.kind}</span> · {note.actor === "preston" ? "Preston" : "You"} · {new Date(note.created_at).toLocaleString()}</small><p>{note.text}</p><div className="opponent-note-links">{note.evidence.map((evidence, index) => <a key={index} href={evidence.url} target="_blank" rel="noreferrer">{evidence.label} ↗</a>)}</div></article>)}{notes.length > 3 ? <button className="text-button" onClick={() => setShowAllNotes(value => !value)} aria-expanded={showAllNotes}>{showAllNotes ? "Show fewer notes" : `Show all ${notes.length} notes`}</button> : null}</div> : null}
            {!hasAnalysis ? <div className="opponent-analysis-empty"><NotebookText size={23} aria-hidden="true" /><div><strong>{activeTasks.length ? "Analysis is in progress" : "No saved analysis yet"}</strong><p>{activeTasks.length ? "Saved findings will appear here as the research session progresses." : book.snapshots.length ? "Evidence has been collected. Choose Analyze to turn it into observations and hypotheses." : "Choose Analyze to research this policy and save findings here."}</p></div></div> : null}
            {book.tasks?.length ? <div className="opponent-inline-sessions"><button className="text-button" disabled={!onOpenTask} onClick={() => onOpenTask?.(book.tasks![0].id)}>Inspect research in Lab ↗</button></div> : null}
          </> : null}
        </section> : null}
      </td>
    </tr>
  </>;
}

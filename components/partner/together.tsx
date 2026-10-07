"use client";

import { useEffect, useState } from "react";
import { agreement, type Claim, type ClaimInput, type Stance } from "../../lib/partner/model";
import { SelectField } from "@/components/ui/select-field";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  refreshKey: number;
  onDiscuss: (text: string) => void;
  onEvidence: (evidence: ClaimInput["evidence"][number]) => void;
  onPolicy: () => void; onMatches: () => void;
  revision: number | null;
  experiments: { xpRequestId: string; title: string; status: string }[];
};
const stanceLabel = { open: "Open question", agree: "Agree", disagree: "Disagree" };
const agreementLabel = { shared: "Shared position", disputed: "Different views", open: "Open question" };

export function Together({ refreshKey, onDiscuss, onEvidence, onPolicy, onMatches, revision, experiments }: Props) {
  const [state, setState] = useState<{ available: boolean; claims: Claim[] } | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/partner", { signal: controller.signal }).then(async r => {
      const data = await r.json(); if (!r.ok) throw new Error(data.error); return data;
    }).then(data => { setState(data); setError(""); }).catch(e => { if (e.name !== "AbortError") setError(e.message); });
    return () => controller.abort();
  }, [refreshKey, reload]);
  const claims = state?.claims ?? [];
  const shown = claims.filter(c => filter === "all" || (filter === "disputed" ? agreement(c) === "disputed" : c.kind === filter));
  const claim = shown.find(c => c.id === selected) ?? shown[0];
  function saved(c: Claim) {
    setState(previous => ({ available: true, claims: [c, ...(previous?.claims ?? []).filter(x => x.id !== c.id)] }));
    setSelected(c.id); setCreating(false); setFilter("all");
  }
  return <div className="together-view">
    <div className="shared-heading"><div><h2>Our shared understanding</h2><p>Agreement is a position. Evidence tells us what holds up.</p></div>
      <button className="secondary" disabled={!state?.available || !!error} onClick={() => setCreating(v => !v)}>{creating ? "Cancel" : "+ Add a hypothesis or lesson"}</button></div>
    {error ? <p className="error" role="alert">{error} <button className="text-button" onClick={() => setReload(n => n + 1)}>Retry</button></p> : null}
    {state && !state.available ? <p className="partner-storage-note">Saved policy hypotheses are available to explore. Shared responses and working lessons need the partner storage update before they can be saved.</p> : null}
    {creating ? <ClaimForm experiments={experiments} onSaved={saved} /> : null}
    <div className="shared-filters" role="group" aria-label="Filter shared work">{[["all", "All"], ["hypothesis", "Policy hypotheses"], ["lesson", "How we work"], ["disputed", "Different views"]].map(([key, label]) =>
      <button data-present-action="click" key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}{key === "disputed" ? ` · ${claims.filter(c => agreement(c) === "disputed").length}` : ""}</button>)}</div>
    {!state && !error ? <p role="status">Loading what we’re learning together…</p> : !shown.length ? <div className="shared-empty"><div className="present-eye" aria-hidden="true"><span /></div><h3>{filter === "disputed" ? "Room for different views" : "Start with something you noticed"}</h3>
      <p>{filter === "disputed" ? "Disagreements stay visible until each of us changes our own position." : "A moment in a replay, an idea for your hero, or a lesson about how we should collaborate."}</p>
      <button className="secondary" onClick={() => onDiscuss("Let's decide what to learn next about our GoTA policy. Read our shared work and current policy, then help me form one actionable hypothesis with evidence and a way to test it.")}>Think it through with Preston ↗</button></div> :
      <div className="shared-work"><nav className="claim-list" aria-label="Shared claims">{shown.map(c => <button data-present-action="click" key={c.id} className={claim?.id === c.id ? "selected" : ""} onClick={() => setSelected(c.id)}>
        <span className="claim-kind">{c.kind === "lesson" ? "How we work" : "Policy hypothesis"}{c.revision ? ` · r${c.revision}` : ""}</span><strong>{c.statement}</strong>
        <span className={`claim-agreement ${agreement(c)}`}>{agreementLabel[agreement(c)]}</span></button>)}</nav>
        {claim ? <ClaimDetail key={`${claim.id}:${claim.version}`} claim={claim} available={!!state?.available && !error} onSaved={saved} onEvidence={onEvidence} onDiscuss={onDiscuss} experiments={experiments} /> : null}</div>}
  </div>;
}

function ClaimDetail({ claim, available, onSaved, onDiscuss, onEvidence, experiments }: {
  claim: Claim; available: boolean; onSaved: (c: Claim) => void; onDiscuss: Props["onDiscuss"]; onEvidence: Props["onEvidence"]; experiments: Props["experiments"];
}) {
  const [stance, setStance] = useState<Stance>(claim.positions.human);
  const [note, setNote] = useState("");
  const [game, setGame] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/partner", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: claim.id, version: claim.version, stance, note,
        ...(game ? { evidence: { kind: "experiment", ref: game, detail: note } } : {}),
      }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error); onSaved(data.claim);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save your response"); } finally { setBusy(false); }
  }
  return <article className="claim-detail">
    <span className="eyebrow">Proposed by {claim.author === "human" ? "you" : "Preston"} · {new Date(claim.createdAt).toLocaleDateString()}</span><h3>{claim.statement}</h3>
    <div className="claim-positions"><div><span>You</span><b>{stanceLabel[claim.positions.human]}</b></div><div><span>Preston</span><b>{stanceLabel[claim.positions.present]}</b></div></div>
    <div className="claim-flow" aria-label="Hypothesis: situation, action, expected outcome">
      <div className="claim-flow-node"><span>When we see</span><p>{claim.situation}</p></div><span className="claim-flow-arrow" aria-hidden="true">↓</span>
      <div className="claim-flow-node action"><span>Try this</span><p>{claim.action}</p></div><span className="claim-flow-arrow" aria-hidden="true">↓</span>
      <div className="claim-flow-node outcome"><span>We expect</span><p>{claim.expected}</p></div>
      <div className="claim-flow-return"><span aria-hidden="true">↶</span><div><b>Rethink the idea if…</b><p>{claim.falsifier}</p></div></div>
    </div>
    <div className="claim-evidence"><h4>Evidence & references <span>{claim.evidence.length}</span></h4>
      <p>References give context; they do not by themselves confirm the claim.</p>
      {claim.evidence.length ? claim.evidence.map((e, i) => <div key={i}><span>{e.kind === "revision" ? `Policy r${e.ref}` : e.kind === "experiment" ? "Hosted test" : "Recorded observation"}</span><p>{e.detail}</p>{e.kind !== "observation" ? <button type="button" className="text-button" onClick={() => onEvidence(e)}>Inspect {e.kind === "revision" ? "policy" : "test"} ↗</button> : null}</div>) : <p>No evidence attached yet. This is a proposal to investigate.</p>}
    </div>
    <button type="button" className="partner-next" onClick={() => onDiscuss(`Let's examine shared claim ${claim.id}: ${claim.statement}. Call shared_work to read its current positions and evidence. Preserve any disagreement. Help me choose the next concrete test or observation using its situation, expected outcome and falsifier. For a working lesson, explain how we can test whether it changes our collaboration.`)}>Decide our next step with Preston ↗</button>
    <form className="claim-response" onSubmit={save}><h4>Your position</h4><p>Only you can change your position here. Preston records its own response.</p>
      <label>Position<SelectField value={stance} onValueChange={v => setStance(v as Stance)} disabled={!available || busy} options={Object.entries(stanceLabel).map(([value, label]) => ({ value, label }))} /></label>
      <label>Reason or observation<Textarea className="text-xs" required minLength={5} maxLength={1500} value={note} onChange={e => setNote(e.target.value)} disabled={!available || busy} placeholder="What supports your view? Include a replay time if useful." /></label>
      <label>Link a hosted test (optional)<SelectField value={game} onValueChange={setGame} disabled={!available || busy} options={[{ value: "", label: "No test linked" }, ...experiments.map(e => ({ value: e.xpRequestId, label: `${e.title} · ${e.status}` }))]} /></label>
      <button className="secondary" disabled={!available || busy || note.trim().length < 5}>{busy ? "Saving…" : "Save my position"}</button>{error ? <p className="error" role="alert">{error}</p> : null}</form>
    {claim.history.length ? <details className="claim-history"><summary data-present-action="click">How our views changed · {claim.history.length}</summary>{[...claim.history].reverse().map((h, i) => <div key={i}><b>{h.actor === "human" ? "You" : "Preston"} · {stanceLabel[h.stance]}</b><time>{new Date(h.at).toLocaleString()}</time><p>{h.note}</p></div>)}</details> : null}
    {claim.kind === "lesson" ? <p className="lesson-status">{agreement(claim) === "shared" ? "We will recall this working lesson on future chat turns. We can still challenge it." : "This lesson stays open for discussion. It becomes a working agreement when we both agree."}</p> : null}
  </article>;
}

function ClaimForm({ onSaved, experiments }: { onSaved: (c: Claim) => void; experiments: Props["experiments"] }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setError("");
    const observation = String(form.get("observation") ?? "").trim(); const game = String(form.get("game") ?? "");
    const input = Object.fromEntries(["kind", "statement", "situation", "action", "expected", "falsifier"].map(k => [k, form.get(k)]));
    try {
      const r = await fetch("/api/partner", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input, evidence: observation ? [{ kind: game ? "experiment" : "observation", ref: game, detail: observation }] : [] }) });
      const data = await r.json(); if (!r.ok) throw new Error(data.error); onSaved(data.claim);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save"); } finally { setBusy(false); }
  }
  return <form className="claim-form" onSubmit={submit}><fieldset disabled={busy}><legend>Something to develop together</legend>
    <label>Kind<SelectField name="kind" defaultValue="hypothesis" options={[{ value: "hypothesis", label: "A hypothesis about our policy" }, { value: "lesson", label: "A lesson about how we work" }]} /></label>
    <label>Our claim<Textarea className="text-xs" name="statement" required minLength={8} maxLength={600} placeholder="Checking whether the situation occurred will help us judge a policy change." /></label>
    <div className="claim-form-grid">{[["situation", "When does it apply?", "When reviewing a hosted test…"], ["action", "What should change?", "Check for the intended situation before judging the result…"], ["expected", "What should we observe?", "We distinguish an untested idea from a failed one…"], ["falsifier", "What would change our minds?", "The check misses relevant situations or does not improve our evaluation…"]].map(([name, label, placeholder]) => <label key={name}>{label}<Textarea className="text-xs" name={name} required minLength={5} maxLength={800} placeholder={placeholder} /></label>)}</div>
    <label>Evidence or observation (optional)<Textarea className="text-xs" name="observation" maxLength={1500} placeholder="What prompted this? Include a replay moment or a correction you made." /></label>
    <label>Related hosted test (optional)<SelectField name="game" options={[{ value: "", label: "No test linked" }, ...experiments.map(e => ({ value: e.xpRequestId, label: e.title }))]} /></label>
    <button className="secondary">{busy ? "Saving…" : "Save for us to explore"}</button>{error ? <p className="error" role="alert">{error}</p> : null}</fieldset></form>;
}

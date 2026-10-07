"use client";

import { useCallback, useEffect, useState } from "react";
import type { FundedCycle, ResearchEvent, ResearchPlan, ResearchEvaluation } from "../../lib/research/model";
import { replayGrounding } from "../../lib/research/grounding";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { Textarea } from "@/components/ui/textarea";

type Version = { id: string; revision_number: number; summary: string };
type State = { available: boolean; cycles: FundedCycle[]; events: ResearchEvent[]; plans: ResearchPlan[]; versions: Version[];
  evaluations: ResearchEvaluation[]; experiments: { xp_request_id: string; policy_version_id: string; title: string; status: string; summary: unknown }[];
  usage: { cycle_id: string; model_calls: number; cost_reports: number; reported_cost_usd: number }[]; historyTruncated?: boolean };

export function ResearchWorkbench({ onDiscuss, onTask, onVersion }: {
  onDiscuss: (text: string) => void; onTask: (id: string) => void; onVersion?: (revision: number) => void;
}) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(replayGrounding.cycleId ?? "");
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState(false);
  const [candidate, setCandidate] = useState("");
  const refresh = useCallback(async () => {
    const response = await fetch("/api/research"); const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Research could not be loaded");
    setState(data);
  }, []);
  useEffect(() => {
    let mounted = true;
    const update = () => { if (mounted) void refresh().catch(e => { if (mounted) setError(e.message); }); };
    update(); const timer = setInterval(update, 10000); window.addEventListener("research-updated", update);
    return () => { mounted = false; clearInterval(timer); window.removeEventListener("research-updated", update); };
  }, [refresh]);
  const cycle = state?.cycles.find(c => c.id === selected) ?? state?.cycles.find(c => c.state !== "closed") ?? state?.cycles[0];
  useEffect(() => { replayGrounding.cycleId = cycle?.id ?? null; }, [cycle?.id]);
  const write = async (action: string, input: Record<string, unknown>) => {
    setPending(true); setError("");
    try {
      const response = await fetch("/api/research", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, cycleId: cycle?.id, requestKey: crypto.randomUUID(), ...input }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || "Update failed");
      if (result.cycle) { setSelected(result.cycle.id); setCreating(false); }
      await refresh();
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : "Update failed"); return false; }
    finally { setPending(false); }
  };
  const version = (id: string) => state?.versions.find(v => v.id === id);
  if (!state) return <section className="research-workbench" aria-label="Research cycle"><p role="status">{error || "Loading research…"}</p></section>;
  if (!state.available) return <section className="research-workbench" aria-label="Research cycle"><p>Research cycles are ready in this build. Apply the research database migrations to start one.</p></section>;
  const plans = (state.plans ?? []).filter(p => p.cycle_id === cycle?.id);
  const history = state.events.filter(e => e.cycle_id === cycle?.id || e.kind === "model.changed").slice(-30).reverse();
  const usage = (state.usage ?? []).filter(u => u.cycle_id === cycle?.id);
  const cost = usage.reduce((n, u) => n + Number(u.reported_cost_usd), 0);
  const partial = usage.some(u => u.cost_reports < u.model_calls);
  const candidateId = (candidate !== cycle?.active_version_id && state.versions.some(v => v.id === candidate) ? candidate : "") || state.versions.find(v => v.id !== cycle?.active_version_id)?.id || "";
  const completed = (state.experiments ?? []).filter(e => e.status === "completed" && e.summary);
  const evaluations = (state.evaluations ?? []).filter(e => e.cycle_id === cycle?.id);
  return <section className="research-workbench" aria-label="Research cycle">
    <div className="research-heading"><label>Research cycle <SelectField aria-label="Research cycle" value={cycle?.id ?? ""} onValueChange={id => { setSelected(id); setCreating(false); setCandidate(""); }}
      options={!state.cycles.length ? [{ value: "", label: "No cycles yet" }] : state.cycles.map(c => ({ value: c.id, label: c.question }))} /></label><button type="button" onClick={() => setCreating(v => !v)}>New cycle</button></div>
    {error ? <p className="research-error" role="alert">{error}</p> : null}
    {creating || !cycle ? <form className="research-form" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void write("create", Object.fromEntries(f)); }}>
      <label>What are we investigating?<Input className="text-xs" name="question" minLength={8} maxLength={1000} required placeholder="Why does our hero retreat before help arrives?" /></label>
      <label>What would count as evidence?<Textarea className="text-xs" name="criteria" minLength={8} maxLength={2000} required placeholder="Compare retreat decisions in the same situation; watch for extra deaths." /></label>
      <label>Starting policy<SelectField name="baselineId" required defaultValue={state.versions[0]?.id} options={state.versions.map(v => ({ value: v.id, label: `r${v.revision_number} · ${v.summary}` }))} /></label>
      <button disabled={pending || !state.versions.length} type="submit">Create research cycle</button>{!state.versions.length ? <p>Save a starter policy before creating a cycle.</p> : null}
    </form> : null}
    {cycle && !creating ? <>
      <div className="research-current"><span className="notebook-label">{cycle.state}{cycle.expires_at && Date.parse(cycle.expires_at) <= Date.now() ? " · allowance expired" : ""}</span><h2>{cycle.question}</h2><p>{cycle.criteria}</p>
        <div className="research-lineage"><button onClick={() => onVersion?.(version(cycle.baseline_id)?.revision_number ?? 1)}>Baseline r{version(cycle.baseline_id)?.revision_number}</button><span>→</span><button onClick={() => onVersion?.(version(cycle.active_version_id)?.revision_number ?? 1)}>Active r{version(cycle.active_version_id)?.revision_number}</button><small>New candidates do not replace the active policy.</small></div>
      </div>
      <div className="research-budget" aria-label="Research allowance"><div><strong>{Math.max(0, cycle.call_limit - cycle.calls_allocated)}</strong><span>model calls available</span></div><div><strong>{Math.max(0, cycle.game_limit - cycle.games_allocated)}</strong><span>hosted games available</span></div><div><strong>${cost.toFixed(2)}</strong><span>reported model cost{partial ? " · partial" : ""}</span></div></div>
      <p className="research-caption">{cycle.autonomy ? "Preston may run proposed experiments between visits." : "Experiments start when you choose Run."} Conversation costs are separate. Infrastructure and hosted-game dollar costs are not included.</p>
      <div className="research-actions"><button disabled={pending || cycle.state === "closed"} onClick={() => void write(cycle.state === "paused" ? "resume" : "pause", {})}>{cycle.state === "paused" ? "Resume research" : "Pause research"}</button>
        <button onClick={() => onDiscuss(`Read research cycle ${cycle.id} using research_partner. Review our current positions, evidence and allowance. Propose the most useful next experiment with a falsifier and explain why it is worth the calls and hosted game. If an observation is missing, ask one focused question.`)}>Discuss next experiment</button>
        <button disabled={pending || cycle.state === "closed"} onClick={() => void write("close", {})}>Close cycle</button></div>
      {cycle.state !== "closed" ? <details className="research-detail"><summary>Allowance and authority</summary><form className="research-form" key={cycle.id + cycle.call_limit} onSubmit={e => {
        e.preventDefault(); const f = new FormData(e.currentTarget); void write("grant", { modelCalls: Number(f.get("calls")), hostedGames: Number(f.get("games")), costReviewUsd: Number(f.get("cost")),
          expiresAt: new Date(Date.now() + Number(f.get("days")) * 86400000).toISOString(), autonomy: f.get("autonomy") === "on" });
      }}><div className="research-form-grid"><label>Total model calls<Input className="text-xs" name="calls" type="number" min={Math.max(6,cycle.calls_allocated)} max={2000} defaultValue={cycle.call_limit || 48} required /></label><label>Total hosted games<Input className="text-xs" name="games" type="number" min={Math.max(1,cycle.games_allocated)} max={20} defaultValue={cycle.game_limit || 2} required /></label><label>Review reported spend at $<Input className="text-xs" name="cost" type="number" min="0.01" step="0.01" max={100} defaultValue={cycle.cost_review_usd} required /></label><label>Expires in days<Input className="text-xs" name="days" type="number" min={1} max={29} defaultValue={7} required /></label></div>
        <label className="research-checkbox"><Checkbox name="autonomy" defaultChecked={cycle.autonomy} />Allow Preston to run the proposed queue while I’m away</label>
        <p>These totals include consumed and reserved capacity. USD triggers a review after reported spend reaches the threshold; it is not a hard billing cap. No league entry or automatic policy promotion.</p><button type="submit" disabled={pending}>Grant this allowance</button></form>
        {state.cycles.filter(c => c.id !== cycle.id).map(c => <button key={c.id} disabled={pending} onClick={() => void write("carryover", { fromCycleId: c.id })}>Carry unused allowance from “{c.question}”</button>)}
      </details> : null}
      <div className="research-plans"><h3>Experiments</h3>{cycle.state !== "closed" ? <button disabled={pending} onClick={() => void write("propose", { mode: "baseline", objective: "Observe the unchanged active policy", criteria: `Observe the unchanged active policy: ${cycle.criteria}`, rationale: "Collect evidence for the selected active version before comparing a candidate.", maxCalls: 6, priority: 100, evidence: [{kind:"revision",id:cycle.active_version_id}] })}>Queue an unchanged baseline test</button> : null}{!plans.length ? <p>No experiments proposed. Discuss an observation with Preston or add a test below.</p> : plans.map(p => <article key={p.id}><div><strong>{p.objective}</strong><span>{p.status} · up to {p.max_calls} model calls · 1 hosted game</span><p>{p.rationale}</p></div>{p.task_id ? <button onClick={() => onTask(p.task_id!)}>Inspect work ↗</button> : p.status === "proposed" ? <div className="research-actions"><button disabled={pending || cycle.state !== "active"} onClick={() => void write("start", { planId: p.id })}>Run</button><button disabled={pending} onClick={() => void write("decline", { planId: p.id })}>Decline</button></div> : null}</article>)}</div>
      {cycle.state !== "closed" ? <details className="research-detail"><summary>Propose an experiment</summary><form className="research-form" onSubmit={async e => {
        e.preventDefault(); const form = e.currentTarget; const f = new FormData(form);
        if (await write("propose", { objective: f.get("objective"), criteria: f.get("criteria"), rationale: f.get("rationale"), maxCalls: Number(f.get("calls")), evidence: [{ kind: "revision", id: cycle.active_version_id }], priority: 0 })) form.reset();
      }}><label>Change to test<Input className="text-xs" name="objective" minLength={12} maxLength={2000} required /></label><label>Expected result and what would disprove it<Textarea className="text-xs" name="criteria" minLength={12} maxLength={2000} required /></label><label>Why spend the allowance on this?<Textarea className="text-xs" name="rationale" minLength={12} maxLength={2000} required /></label><label>Maximum model calls<Input className="text-xs" type="number" name="calls" min={6} max={100} defaultValue={24} required /></label><p>Linked to active revision r{version(cycle.active_version_id)?.revision_number}.</p><button disabled={pending}>Add proposal</button></form></details> : null}
      <details className="research-detail"><summary>Compare evidence and select a policy</summary><p>Review behavior against the exact versions below. Hosted self-play alone does not establish a competitive improvement.</p>
        <form key={cycle.active_version_id} className="research-form" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void write("evaluate", { ...Object.fromEntries(f), candidateId }); }}>
          <label>Candidate<SelectField aria-label="Candidate" value={candidateId} onValueChange={setCandidate} required options={state.versions.filter(v => v.id !== cycle.active_version_id).map(v => ({ value: v.id, label: `r${v.revision_number} · ${v.summary}` }))} /></label>
          <label>Active policy evidence<SelectField name="baselineXp" required placeholder="Choose a completed test" options={completed.filter(e => e.policy_version_id === cycle.active_version_id).map(e => ({ value: e.xp_request_id, label: e.title }))} /></label>
          <label>Candidate evidence<SelectField name="candidateXp" key={candidateId} required placeholder="Choose a completed test" options={completed.filter(e => e.policy_version_id === candidateId).map(e => ({ value: e.xp_request_id, label: e.title }))} /></label>
          <label>Behavioral finding<SelectField name="finding" defaultValue="inconclusive" options={[{ value: "inconclusive", label: "Inconclusive" }, { value: "supported", label: "Expected behavior supported" }, { value: "contradicted", label: "Expected behavior contradicted" }]} /></label>
          <label>What did the evidence show?<Textarea className="text-xs" name="explanation" minLength={12} maxLength={3000} required /></label><button disabled={pending || !candidateId}>Record review</button>
        </form>
        {evaluations.map(e => <article className="research-review" key={e.id}><strong>r{version(e.candidate_id)?.revision_number}: {e.finding}</strong><p>{e.explanation}</p>{e.finding === "supported" && e.baseline_id === cycle.active_version_id ? <button disabled={pending} onClick={() => void write("select", { versionId: e.candidate_id, evaluationId: e.id, reason: e.explanation })}>Use this reviewed candidate</button> : null}</article>)}
        {cycle.active_version_id !== cycle.baseline_id ? <button disabled={pending} onClick={() => void write("select", { versionId: cycle.baseline_id, reason: "Return to this cycle’s starting policy" })}>Roll back to cycle baseline</button> : null}
      </details>
      <details className="research-detail"><summary>Evidence, positions and decisions</summary>
        <form className="research-form" onSubmit={async e => { e.preventDefault(); const form=e.currentTarget; const f=new FormData(form); if(await write("note", {kind:f.get("kind"),text:f.get("text"),...(f.get("supersedes")?{supersedes:f.get("supersedes")} : {}),...(Number(f.get("expires"))>0?{expiresAt:new Date(Date.now()+Number(f.get("expires"))*86400000).toISOString()}:{}),evidence:[{kind:"revision",id:cycle.active_version_id}]}))form.reset(); }}><label>Record a contribution<SelectField name="kind" defaultValue="observation" options={[{ value: "observation", label: "Observation" }, { value: "position", label: "My position" }, { value: "instruction", label: "Standing instruction" }, { value: "commitment", label: "Commitment" }, { value: "vocabulary", label: "Shared vocabulary" }, { value: "repair", label: "Correction or repair" }]} /></label><label>What should Preston attend to?<Textarea className="text-xs" name="text" minLength={3} maxLength={3000} required /></label><label>Expires in days (optional)<Input className="text-xs" name="expires" type="number" min={1} max={365} /></label><label>Correct one of my earlier statements<SelectField name="supersedes" options={[{ value: "", label: "New statement" }, ...state.events.filter(e=>e.cycle_id===cycle.id&&e.actor==="human"&&typeof e.payload.text==="string").map(e=>({ value: e.id, label: String(e.payload.text).slice(0,90) }))]} /></label><button disabled={pending}>Add to the record</button></form>
        <ol className="research-history">{history.map(e => <li key={e.id}><small>{e.actor} · {e.kind.replaceAll(".", " ")} · {new Date(e.created_at).toLocaleString()}</small><p>{String(e.payload.text ?? e.payload.question ?? e.payload.objective ?? e.payload.reason ?? e.payload.note ?? e.payload.rationale ?? "")}</p>
          {e.kind === "moment" && e.payload.anchor ? <a href={`https://softmax.com/observatory/v2/episode-requests/${encodeURIComponent(String((e.payload.anchor as Record<string, unknown>).episodeId))}/watch`} target="_blank" rel="noreferrer">Replay · tick {String((e.payload.anchor as Record<string, unknown>).tick)} ↗</a> : null}
          {e.evidence.map((ref,i) => ref.kind === "revision" ? <button key={i} onClick={() => onVersion?.(version(ref.id)?.revision_number ?? 1)}>Inspect r{version(ref.id)?.revision_number}</button> : <span key={i} className="research-evidence-ref">{ref.kind}: {ref.id}</span>)}
          <details><summary>Receipt</summary><pre>{JSON.stringify(e.payload,null,2)}</pre></details></li>)}</ol>
        <p>Corrections are added to the record; previous statements remain. Showing the latest 30 events{state.historyTruncated ? " from a partial history window" : ""}.</p>
      </details>
    </> : null}
  </section>;
}

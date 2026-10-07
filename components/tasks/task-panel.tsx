"use client";
import { useRef, useState } from "react";
import type { Task } from "../../lib/tasks/model";
import { taskStatuses as statuses, taskPhases as phases, workerStatus, type TaskFeed } from "./use-task-feed";
import {useSessionHistory} from "./use-session-history";
import {SessionPayload} from "./session-payload";
import {SessionOutcome,hasSessionOutput} from './session-outcome';
import {SessionTranscript} from "./session-transcript";
import {CampaignPanel} from './campaign-panel';
import {CampaignCreator} from './campaign-creator';
import {modelLabels} from "../../lib/model-selection";
import {reasoningLabels} from "../../lib/reasoning";
import {AuditEvidence} from './audit-evidence';
import { Textarea } from "@/components/ui/textarea";
import {taskActivity} from '../../lib/tasks/activity';

export function TaskPanel({ feed, selectedId, creating, onSelect, onNew, onCloseNew, onDiscuss }: {
  feed: TaskFeed; selectedId: string | null; creating: boolean; onSelect: (id: string) => void;
  onNew: () => void; onCloseNew: () => void; onDiscuss: (text: string) => void;
}) {
  const history = useSessionHistory(creating?null:selectedId);
  const {loaded,error:loadError,refresh}=feed;
  const tasks=history.detail?[history.detail.task]:feed.tasks;
  const workers=history.detail?.workers??feed.workers;
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [creationMode,setCreationMode]=useState<"campaign"|"session">("campaign");
  const [objective, setObjective] = useState("");
  const [criteria, setCriteria] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const requestKey = useRef<string | null>(null);
  async function create(event: React.FormEvent) {
    event.preventDefault(); if(busy)return; setBusy(true); setError("");
    requestKey.current ??= crypto.randomUUID();
    try {
      const response = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, signal:AbortSignal.timeout(20000), body: JSON.stringify({ kind:"research", context:{mode:"auto"}, objective, acceptanceCriteria: criteria, requestKey: requestKey.current, maxModelCalls:100, maxCostUsd:25 }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      feed.upsert(body.task); requestKey.current = null; setObjective(""); setCriteria(""); onCloseNew(); onSelect(body.task.id); void refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not start session. Try again; a retry will reuse the same session."); }
    finally { setBusy(false); }
  }
  async function control(task: Task, action: "pause" | "resume" | "cancel" | "steer") {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId: task.id, action, note: notes[task.id] ?? "" }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      if(body.task)feed.upsert(body.task); history.retry(); void refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not update task"); }
    finally { setBusy(false); }
  }
  return <section className={`tasks-view ${creating?"session-create":"session-detail-view"}`} aria-label="Game work">
    {creating || !selectedId ? <div className="tasks-heading"><h1>{creating ? creationMode==="campaign"?"New campaign":"New session" : "Sessions"}</h1>{creating ? <button className="text-button" onClick={onCloseNew}>Cancel</button> : <button className="secondary" onClick={onNew}>+ New session</button>}</div> : null}
    {loadError && !history.detail && !creating ? <p className="tasks-error" role="alert">{loaded ? "Could not refresh. Showing the last recorded state. " : ""}{loadError} <button className="text-button" onClick={() => void refresh()}>Retry</button></p> : null}
    {error ? <p className="tasks-error" role="alert">{error} <button type="button" className="text-button" onClick={() => { setError(""); void refresh(); }}>Retry loading</button></p> : null}
    {creating?<div className="creation-mode" role="group" aria-label="Work scope"><button type="button" aria-pressed={creationMode==='campaign'} onClick={()=>setCreationMode('campaign')}>Campaign</button><button type="button" aria-pressed={creationMode==='session'} onClick={()=>setCreationMode('session')}>One-off session</button></div>:null}
    {creating&&creationMode==='campaign'?<CampaignCreator onCreated={id=>{onCloseNew();onSelect(id);void refresh();}}/>:null}
    {creating && creationMode==='session' ? <form className="task-form" onSubmit={create}>
      <label htmlFor="task-objective">What should Preston work on?</label>
      <Textarea className="text-xs" id="task-objective" required minLength={12} maxLength={2000} value={objective} onChange={event => { setObjective(event.target.value); requestKey.current = null; }} autoFocus placeholder="Find ways to improve our policy’s average score." />
      <label htmlFor="task-criteria">What would count as done?</label>
      <Textarea className="text-xs" id="task-criteria" required minLength={12} maxLength={2000} value={criteria} onChange={event => { setCriteria(event.target.value); requestKey.current = null; }} placeholder="For example, compare against the current policy and explain what improved." />
      <div className="task-form-actions"><a href="/settings" className="muted">Research usage & spending settings ↗</a><button type="submit" className="starter-cta" disabled={busy} aria-busy={busy}>{busy?"Starting…":"Start session"}</button></div>
    </form> : null}
    {!loaded && !loadError ? <p role="status">Loading sessions…</p> : null}
    {loaded && !history.loading && !history.detail && selectedId && !tasks.some(t => t.id === selectedId) ? <p role="status">{history.error||"This session is no longer available."}</p> : null}
    <div className="task-list">{(creating ? [] : tasks.filter(task => task.id === selectedId)).map(task => {
      const research = task.kind === "research";
      const progress = task.checkpoint.research_progress as {summary?:string;nextStep?:string;evidence?:string[]}|undefined;
      const showOutcome = task.status === 'completed' && hasSessionOutput(task.result);
      const finished = ["completed", "failed", "canceled"].includes(task.status);
      const activity=taskActivity(task,history.entries.some(e=>e.sessionId===task.session_id&&e.terminal));
      const stage = ["propose", "select"].includes(task.phase) ? 0 : ["save", "upload", "request_game"].includes(task.phase) ? 1 : 2;
      return <article className="task-card session-record" key={task.id}>
        <div className="task-card-heading"><h1>{task.context?.title??task.objective.split("\n")[0]}</h1><span className={`task-status ${task.status}`}>{task.status==="needs_input"&&task.checkpoint.daily_budget_day?"Daily budget reached":activity.label}</span><button className="text-button" onClick={onNew}>+ New session</button></div>
        <div className="session-permalink"><a href={`/sessions/${task.id}`}>Permanent link ↗</a>{(showOutcome || (task.result as {summary?:string}|null)?.summary || task.reason)?<a href={`#session-outcome-${task.id}`}>Outcome ↓</a>:null}<span>{task.model_calls} model calls</span>{task.games_requested?<span>{task.games_requested} hosted games</span>:null}<span>Updated {new Date(task.updated_at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</span></div>
        {task.model_selection?<small className="muted">{modelLabels[task.model_selection.model]} · {reasoningLabels[task.model_selection.effort].label} effort</small>:null}
        {showOutcome?<SessionOutcome taskId={task.id} result={task.result}/>:<div className={`session-current-state ${activity.tone}`} role={activity.tone==='attention'?'alert':'status'}>
          <strong>{activity.label}</strong><span>{activity.summary}{activity.retryAt?` Next attempt ${new Date(activity.retryAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}.`:''}</span>
          {task.status==='needs_input'?<button className="secondary" disabled={busy||task.model_calls>=task.max_model_calls} onClick={()=>void control(task,'resume')}>Resume</button>:null}
        </div>}
        {typeof task.checkpoint.campaign_id==='string'?<CampaignPanel id={task.checkpoint.campaign_id}/>:null}
        {typeof task.checkpoint.vm_name==='string'?<p className="muted">Dedicated VM · <code>{task.checkpoint.vm_name}</code></p>:null}
        {task.context?.campaignId?<p className="muted">Part of an autoresearch campaign · {task.context.role??'evaluation'}</p>:null}
        <SessionTranscript outcomeAtTop={showOutcome} task={task} entries={history.entries} history={history.detail?.history??[]} loading={history.loading} error={history.error} onRetry={history.retry}/>
        {task.context?.mode==='audit'?<><AuditEvidence artifacts={history.detail?.artifacts??[]}/><details><summary>Audit jobs & VM logs</summary><SessionPayload output={task.result??task.checkpoint}/></details><small className="muted">VM compute is billed separately; its cost is not yet available in reported usage.</small></>:null}
        <details className="session-details"><summary>Details & workers</summary>
        <p className="task-criteria">{task.acceptance_criteria}</p>
        {!research?<ol className="experiment-flow" aria-label="Experiment progress">{["Form an idea", "Try a change", "Read the evidence"].map((label, i) => <li key={label} className={i < stage || task.status === "completed" ? "done" : i === stage ? "current" : ""} aria-current={i === stage && task.status !== "completed" ? "step" : undefined}><span>{i < stage || task.status === "completed" ? "✓" : i + 1}</span><strong>{label}</strong></li>)}</ol>:null}
        <p className="experiment-phase">{research?(task.status==="completed"?"Research complete":progress?.summary??(task.status==="queued"?"Queued — Preston will start shortly.":"Planning the work…")):phases[task.phase]}{task.reason ? ` · ${task.reason}` : ""}</p>
        <details className="session-usage"><summary>Usage & costs</summary><div className="task-meter"><span>{task.model_calls}/{task.max_model_calls} model calls</span><span>{task.games_requested}/{task.max_games} hosted games</span><span>{task.cost_reports ? `$${Number(task.reported_cost_usd).toFixed(3)} reported model cost (may be partial)` : "Model cost unavailable from provider"}</span></div></details>
        {research?<><details><summary>Objective & context</summary><p className="session-objective">{task.objective}</p></details>{!finished&&progress?.nextStep?<p><strong>Next:</strong> {progress.nextStep}</p>:null}{progress?.evidence?.length?<details><summary>Collected evidence</summary><ul>{progress.evidence.map((e,i)=><li key={i}>{e}</li>)}</ul></details>:null}</>:null}
        <h4 className="worker-heading">Workers</h4><ul className="task-workers">{workers.filter(worker => worker.task_id === task.id && worker.worker_key!=="research-progress").map(worker => <li key={worker.worker_key}><span>{worker.role}</span><b>{workerStatus(worker, task)}</b>{worker.output ? <details><summary>View result</summary><SessionPayload output={worker.output}/></details> : null}</li>)}</ul>
        </details>
        {!finished ? <label className="task-note">Direction or new evidence<Textarea className="text-xs" rows={2} maxLength={2000} value={notes[task.id] ?? ""} onChange={event => setNotes({ ...notes, [task.id]: event.target.value })} placeholder="Add evidence or redirect the work…" /></label> : null}
        <div className="task-controls">
          {!finished&&notes[task.id]?.trim()?<button className="secondary" disabled={busy} onClick={()=>void control(task,"steer")}>Update direction</button>:null}
          {!finished && task.status !== "paused" && task.status !== "needs_input" ? <button className="secondary" disabled={busy} onClick={() => void control(task, "pause")}>Pause</button> : null}
          {task.status === "paused" ? <button className="secondary" disabled={busy || task.model_calls >= task.max_model_calls} onClick={() => void control(task, "resume")}>Resume</button> : null}
          {!finished ? <button className="text-button" disabled={busy} onClick={() => void control(task, "cancel")}>Cancel session</button> : null}
          <button className="text-button" onClick={() => onDiscuss(`Discuss persistent task ${task.id}. Call task_status to read its objective, worker results, status and evidence. Explain the next useful step.`)}>Discuss in chat ↗</button>
        </div>
        {task.status === "paused" || task.status === "canceled" ? <p className="muted">No further work will be started. An operation already in progress may finish and be recorded.</p> : null}
      </article>;
    })}</div>
  </section>;
}

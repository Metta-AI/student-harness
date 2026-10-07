"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TaskFeed } from "../tasks/use-task-feed";
import type { FundedCycle, ResearchPlan, ResearchEvaluation, ResearchEvent } from "../../lib/research/model";
import type { ResearchSettings } from "../../lib/research/autonomy-model";
import { Input } from "@/components/ui/input";
type Research = { available: boolean; cycles: FundedCycle[]; plans: ResearchPlan[]; evaluations: ResearchEvaluation[]; events: ResearchEvent[]; versions: {id:string;revision_number:number}[]; experiments: {xp_request_id:string;policy_version_id:string;title:string;status:string}[] };
export function ExperimentTable({ feed, cycleId, onTask, onVersion, onDiscuss, onExperiment, onInspect }: { feed: TaskFeed; cycleId?: string; onTask: (id:string)=>void; onVersion:(revision:number)=>void; onDiscuss:(text:string)=>void; onExperiment:(id:string)=>void; onInspect:(id:string)=>void }) {
  const [creating,setCreating]=useState(false);
  const [data,setData]=useState<Research|null>(null),[settings,setSettings]=useState<ResearchSettings|null>(null),[error,setError]=useState(""),[pending,setPending]=useState(false),[selected,setSelected]=useState(cycleId??"");
  useEffect(()=>{if(cycleId)setSelected(cycleId);},[cycleId]);
  const requestSequence=useRef(0);
  const refresh=useCallback(async()=>{
    const request=++requestSequence.current;
    const [r,a]=await Promise.all([fetch('/api/research'),fetch('/api/research/autonomy')]);
    if(!r.ok||!a.ok)throw Error("Research could not be loaded.");const research=await r.json();const autonomy=await a.json();if(request!==requestSequence.current)return;setData(research);setSettings(autonomy.settings);setError("");
  },[]);
  useEffect(()=>{let live=true;const update=()=>{if(live)void refresh().catch(e=>{if(live)setError(e.message);});};update();const timer=setInterval(update,10000);return()=>{live=false;requestSequence.current++;clearInterval(timer);};},[refresh]);
  async function write(input:Record<string,unknown>){setPending(true);try{const r=await fetch('/api/research/autonomy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});if(!r.ok)throw Error("Could not update research.");await refresh();return true;}catch(e){setError((e as Error).message);return false;}finally{setPending(false);}}
  const revision=(id:string)=>data?.versions.find(v=>v.id===id)?.revision_number;
  const chosenPlan=data?.plans.find(p=>p.id===selected);
  const chosen=data?.cycles.find(c=>c.id===(chosenPlan?.cycle_id??selected));
  const rows: {id:string; title:string; context?:string; policy?:string; status:string; result?:string; xp?:string; cycle?:string; task?:string}[] = [];
  const linkedTasks = new Set(data?.plans.map(p=>p.task_id));
  const linkedGames = new Set(feed.tasks.map(t=>t.checkpoint.xp_request_id));
  for (const plan of data?.plans ?? []) {
    const task = feed.tasks.find(t=>t.id===plan.task_id);
    const cycle = data?.cycles.find(c=>c.id===plan.cycle_id);
    const evaluation = data?.evaluations.find(e=>e.cycle_id===plan.cycle_id && e.candidate_id===task?.checkpoint.version_id);
    rows.push({id:plan.id,title:plan.objective,context:cycle?.question,policy:task?.base_version_id ?? cycle?.baseline_id,
      status:task?.status ?? plan.status, result:evaluation?.finding, xp:evaluation?.candidate_xp ?? (typeof task?.checkpoint.xp_request_id==='string'?task.checkpoint.xp_request_id:undefined),cycle:plan.cycle_id,task:plan.task_id ?? undefined});
  }
  for (const task of feed.tasks.filter(t=>t.kind!=="research"&&!linkedTasks.has(t.id))) {
    rows.push({id:task.id,title:task.objective,policy:task.base_version_id??undefined,status:task.status,task:task.id,
      xp:typeof task.checkpoint.xp_request_id==='string'?task.checkpoint.xp_request_id:undefined});
  }
  for (const run of data?.experiments ?? []) {
    if (!linkedGames.has(run.xp_request_id) && !rows.some(r=>r.xp===run.xp_request_id)) rows.push({id:run.xp_request_id,title:run.title,policy:run.policy_version_id,status:run.status,xp:run.xp_request_id});
  }
  for (const cycle of data?.cycles ?? []) {
    if (cycle.state!=='closed' && !data?.plans.some(p=>p.cycle_id===cycle.id) && !feed.tasks.some(t=>t.cycle_id===cycle.id)) {
      rows.push({id:cycle.id,title:cycle.question,policy:cycle.baseline_id,status:cycle.state==='paused'?'paused':'exploring',cycle:cycle.id});
    }
  }
  const statusLabel=(status:string)=>status.replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
  return <section className="experiment-workspace" aria-label="Experiments">
    <div className="experiment-toolbar"><h2>Experiments <span>{rows.length}</span></h2><div><span className="research-running-label">{settings?.enabled ? 'Research on' : settings ? 'Research paused' : 'No active research'}</span><button className="secondary" aria-expanded={creating} onClick={()=>setCreating(!creating)}>{creating?'Cancel':'New experiment'}</button></div></div>
    {creating ? <div className="experiment-create">
    <form className="research-direction" onSubmit={async e=>{e.preventDefault();const form=e.currentTarget;const direction=String(new FormData(form).get('direction'));if(await write({action:'investigate',direction,requestKey:crypto.randomUUID()})){form.reset();setCreating(false);}}}><label htmlFor="research-direction">Give Preston a direction</label><div><Input className="text-xs" id="research-direction" name="direction" minLength={8} maxLength={2000} placeholder="Investigate why we lose early fights…" required/><button disabled={pending}>Investigate</button></div></form>
    {!settings?<p className="evidence-caption">Workspace limits: 120 model calls and 4 hosted games over 7 days.</p>:null}
    </div>:null}
    {settings ? <details className="research-operating-settings"><summary>Research settings · {settings.calls_allocated}/{settings.call_limit} model calls · {settings.games_allocated}/{settings.game_limit} hosted games</summary><p>Consumed and reserved capacity across investigations. Ends {new Date(settings.expires_at).toLocaleString()}.</p><button className="secondary" disabled={pending} onClick={()=>void write({action:'settings',enabled:!settings.enabled,modelCalls:settings.call_limit,hostedGames:settings.game_limit,expiresAt:settings.expires_at,interests:settings.interests})}>{settings.enabled?'Pause research':'Resume research'}</button><form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void write({action:'settings',enabled:settings.enabled,modelCalls:Number(f.get('calls')),hostedGames:Number(f.get('games')),expiresAt:new Date(Date.now()+Number(f.get('days'))*86400000).toISOString(),interests:String(f.get('interests'))});}}><label>Model calls<Input className="text-xs" name="calls" type="number" min={settings.calls_allocated} max={2000} defaultValue={settings.call_limit}/></label><label>Hosted games<Input className="text-xs" name="games" type="number" min={settings.games_allocated} max={100} defaultValue={settings.game_limit}/></label><label>Continue for days<Input className="text-xs" name="days" type="number" min={1} max={29} defaultValue={7}/></label><label>Research interests<Input className="text-xs" name="interests" maxLength={2000} defaultValue={settings.interests}/></label><button disabled={pending}>Save settings</button></form></details> : null}
    {error ? <p role="status">{error} <button className="text-button" onClick={()=>void refresh().catch(e=>setError(e.message))}>Retry</button></p> : null}
    <div className="workspace-table-scroll"><table className="workspace-table experiment-table" aria-label="Experiments"><thead><tr><th>Experiment</th><th>Baseline / policy</th><th>Status</th><th>Evidence</th></tr></thead><tbody>
      {rows.map(row=><tr key={row.id} className={(row.id===selected||row.cycle===selected)?'selected':''}>
        <td><button className="text-button experiment-title" onClick={()=>{if(row.cycle)setSelected(row.id);else if(row.task)onTask(row.task);else if(row.xp)onInspect(row.xp);}}>{row.title}</button>{row.context?<small>{row.context}</small>:null}</td>
        <td>{row.policy && revision(row.policy)?<button className="text-button" onClick={()=>onVersion(revision(row.policy!)!)}>r{revision(row.policy)} ↗</button>:<span className="muted">—</span>}</td>
        <td><span className={`experiment-status ${row.status}`}>{statusLabel(row.status)}</span></td>
        <td>{row.xp?<button className="text-button" onClick={()=>onExperiment(row.xp!)}>{row.result?statusLabel(row.result):'Episodes'} ↗</button>:<span className="muted">—</span>}</td>
      </tr>)}
      {!rows.length?<tr><td colSpan={4} className="experiment-empty">{!data?'Loading experiments…':!data.available?'Research is unavailable in this workspace.':'No experiments yet.'}</td></tr>:null}
    </tbody></table></div>
    {chosen ? <article className="investigation-detail"><div className="workspace-section-heading"><h3>{chosenPlan?.objective??chosen.question}</h3><button className="text-button" onClick={()=>setSelected('')}>Close</button></div><p>{chosen.criteria}</p><button className="text-button" onClick={()=>{const n=revision(chosen.baseline_id);if(n)onVersion(n);}}>Baseline r{revision(chosen.baseline_id)} ↗</button><span> · </span><button className="text-button" onClick={()=>{const n=revision(chosen.active_version_id);if(n)onVersion(n);}}>Selected r{revision(chosen.active_version_id)} ↗</button>
      {data?.plans.filter(p=>chosenPlan?p.id===chosenPlan.id:p.cycle_id===chosen.id).map(p=><div className="experiment-detail" key={p.id}><strong>{p.objective}</strong><p>{p.rationale}</p><p><b>Test:</b> {p.criteria}</p><details><summary>Evidence and execution settings</summary><p>Up to {p.max_calls} model calls · {statusLabel(p.status)}</p><pre className="experiment-plan-evidence">{JSON.stringify(p.evidence,null,2)}</pre></details>{p.task_id?<button className="secondary" onClick={()=>onTask(p.task_id!)}>Workers and progress ↗</button>:<span>{p.status}</span>}</div>)}
      {data?.evaluations.filter(e=>e.cycle_id===chosen.id).map(e=><div className="experiment-detail" key={e.id}><strong>{e.finding} · candidate r{revision(e.candidate_id)}</strong><p>{e.explanation}</p><button className="text-button" onClick={()=>onExperiment(e.baseline_xp)}>Baseline result ↗</button><button className="text-button" onClick={()=>onExperiment(e.candidate_xp)}>Candidate result ↗</button></div>)}
      <button className="text-button" onClick={()=>onDiscuss(`Let's discuss investigation ${chosen.id}: ${chosen.question}. Show its evidence in your pane, explain the current conclusion and investigate the next useful question.`)}>Discuss this investigation ↗</button></article>:null}
  </section>;
}

'use client';
import {useEffect,useState} from 'react';
import {SessionPayload} from './session-payload';
import {chatModels,modelLabels,type ModelSelection} from '../../lib/model-selection';
import {reasoningEfforts,reasoningLabels} from '../../lib/reasoning';
import {taskActivity} from '../../lib/tasks/activity';

export function CampaignPanel({id}:{id:string}){
 const [data,setData]=useState<any>(null),[error,setError]=useState(''),[artifacts,setArtifacts]=useState<any[]>([]),[opened,setOpened]=useState<any>(null),[showArtifacts,setShowArtifacts]=useState(false),[query,setQuery]=useState('');
 const [savingModel,setSavingModel]=useState(false);
 useEffect(()=>{let active=true;const abort=new AbortController();
  const load=async()=>{try{const response=await fetch(`/api/campaigns/${id}`,{signal:AbortSignal.any([abort.signal,AbortSignal.timeout(8000)])});if(!response.ok)throw Error('Campaign could not refresh');const value=await response.json();if(active){setData(value);setError('');}}catch(e){if(active)setError(e instanceof Error?e.message:'Could not refresh');}};
  void load();const interval=setInterval(load,10000);return()=>{active=false;abort.abort();clearInterval(interval);};
 },[id]);
 async function searchArtifacts(){const r=await fetch(`/api/research/artifacts?q=${encodeURIComponent(query)}`);if(r.ok)setArtifacts(await r.json());}
 async function loadArtifacts(){setShowArtifacts(!showArtifacts);if(!showArtifacts)await searchArtifacts();}
 async function openArtifact(id:string){const r=await fetch(`/api/research/artifacts?id=${id}`);if(r.ok)setOpened(await r.json());}
 async function changeModel(selection:ModelSelection){
  setSavingModel(true);
  try{const r=await fetch(`/api/campaigns/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(selection)});if(!r.ok)throw Error('Could not update the campaign model');setData((d:any)=>({...d,campaign:{...d.campaign,model_selection:selection}}));setError('');}
  catch(e){setError(e instanceof Error?e.message:'Could not update the campaign model');}finally{setSavingModel(false);}
 }
 if(!data)return <p className="muted">{error||'Loading research progress…'}</p>;
 const {campaign,studies,sessions,deployments}=data;
 const currentTasks=new Set([...(campaign.checkpoint.researchTasks??[]),campaign.checkpoint.builderId,
  ...studies.filter((s:any)=>s.cycle===campaign.cycle).map((s:any)=>s.task_id)]);
 const attention=sessions.filter((s:any)=>currentTasks.has(s.id)&&(['failed','needs_input'].includes(s.status)||s.retryAt));
 const calls=sessions.reduce((sum:number,s:any)=>sum+s.model_calls,0),spend=sessions.reduce((sum:number,s:any)=>sum+Number(s.reported_cost_usd??0),0);
 return <section className="campaign-panel" aria-label="Autoresearch campaign">
  <div className="campaign-summary"><strong>Cycle {campaign.cycle+1}</strong><span>{campaign.phase.replaceAll('-',' ')}</span><span>{campaign.protocol.screenPairs} screening pairs · {campaign.protocol.confirmationPairs} confirmation pairs</span><span>{campaign.protocol.promote?'Automatic verified deployment':'Report only'}</span></div>
  <small>{calls} model calls across sessions · {spend>0?`$${spend.toFixed(3)} reported model spend (partial)`:calls?'Model spend not reported by provider':'No model usage yet'}</small>
  {data.hostedUsage?.requests>0?<small>${Number(data.hostedUsage.reportedUsd).toFixed(2)} reported hosted spend · {data.hostedUsage.costReports}/{data.hostedUsage.requests} game costs reported</small>:null}
  {campaign.protocol.fixtureMode==='fresh-seeds'?<small>Fresh seeds · recorded league lineups · paired baseline/candidate games</small>:null}
  {campaign.model_selection?<div className="campaign-summary"><small>Future sessions</small><select aria-label="Campaign model" value={campaign.model_selection.model} disabled={savingModel||!['active','paused'].includes(campaign.state)} onChange={e=>void changeModel({...campaign.model_selection,model:e.target.value as ModelSelection['model']})}>{chatModels.map(m=><option key={m} value={m}>{modelLabels[m]}</option>)}</select><select aria-label="Campaign reasoning effort" value={campaign.model_selection.effort} disabled={savingModel||!['active','paused'].includes(campaign.state)} onChange={e=>void changeModel({...campaign.model_selection,effort:e.target.value as ModelSelection['effort']})}>{reasoningEfforts.map(e=><option key={e} value={e}>{reasoningLabels[e].label}</option>)}</select></div>:null}
  <p className="campaign-progress">{campaign.checkpoint.message}</p>
  {attention.length?<aside className="campaign-attention" aria-label="Session issues"><strong>{attention.filter((s:any)=>['failed','needs_input'].includes(s.status)).length?"Sessions to review":"Recovering sessions"}</strong>{attention.map((s:any)=><a key={s.id} href={`/sessions/${s.id}`}>{s.context?.title??s.objective} · {s.retryAt?'Retrying automatically':s.status==='failed'?'Failed':'Needs attention'} ↗</a>)}</aside>:null}
  {error?<small>{error}</small>:null}
  {studies.length?<div className="campaign-table-wrap"><table><thead><tr><th>Study</th><th>Status</th><th>Wins</th><th>Utility change</th><th>Decision</th></tr></thead><tbody>{studies.map((s:any)=><tr key={s.id}><td><a href={`/sessions/${s.task_id}`}>{s.cohort} · {s.cycle+1} ↗</a></td><td>{s.state==='running'&&s.cohort==='confirmation'&&s.cycle===campaign.cycle&&['freeze','screen'].includes(campaign.phase)?'Reserved':s.state}<div><small>{sessions.find((session:any)=>session.id===s.task_id)?.progress}</small></div></td><td>{s.result?.baselineWins!==undefined?`${s.result.baselineWins} → ${s.result.candidateWins}`:'—'}</td><td>{s.result?.utilityDelta!==undefined?<>{(s.result.utilityDelta*100).toFixed(2)} pp <small>({s.result.interval.map((n:number)=>(n*100).toFixed(2)).join(' to ')})</small></>:'—'}</td><td>{s.result?.passed===undefined?'—':s.result.passed?'Gate passed':'Not promoted'}</td></tr>)}</tbody></table></div>:null}
  {data.attempts?.length?<details><summary>Game attempts <span>latest {data.attempts.length}</span></summary><div className="campaign-table-wrap"><table><thead><tr><th>Arm</th><th>Attempt</th><th>Status</th><th>Episode</th><th>Detail</th></tr></thead><tbody>{data.attempts.map((a:any)=><tr key={a.id}><td>{a.arm}</td><td>{a.attempt+1}</td><td>{a.state==='requested'?(a.host_status??'requested'):a.state}</td><td>{a.episode_id?<a href={`https://softmax.com/observatory/v2?tab=coworlds&detail=${encodeURIComponent(`episode:${a.episode_id}`)}`} target="_blank" rel="noreferrer">{a.episode_id.slice(0,17)} ↗</a>:'—'}</td><td>{a.error??'—'}</td></tr>)}</tbody></table></div></details>:null}
  {sessions.length?<details open><summary>Sessions <span>{sessions.length}</span></summary><ul className="campaign-sessions">{sessions.map((s:any)=><li key={s.id}><a href={`/sessions/${s.id}`}>{s.context?.title??s.objective}</a><span>{taskActivity({...s,checkpoint:{provider_retry_at:s.retryAt}}).label}</span></li>)}</ul></details>:null}
  {deployments.length?<details open><summary>Deployments</summary><ul className="campaign-sessions">{deployments.map((d:any)=><li key={d.id}><span>{d.player_id} · {d.state}</span><small>Rollback: {d.incumbent_id}</small></li>)}</ul></details>:null}
  <button className="text-button" onClick={()=>void loadArtifacts()}>{showArtifacts?'Hide':'Browse'} shared research</button>
  {showArtifacts?<form className="campaign-search" onSubmit={e=>{e.preventDefault();void searchArtifacts();}}><input aria-label="Search shared research" placeholder="Search findings, failures and evidence…" value={query} onChange={e=>setQuery(e.target.value)}/><button type="submit" className="text-button">Search</button></form>:null}
  {showArtifacts?<ul className="campaign-sessions campaign-artifact-list">{artifacts.map(a=><li key={a.id}><button className="text-button" onClick={()=>void openArtifact(a.id)}>{a.title}</button><small>{a.historical?'Historical · ':''}{a.kind}</small></li>)}</ul>:null}
  {opened?<details open className="campaign-artifact"><summary>{opened.title}</summary><SessionPayload output={opened.content}/></details>:null}
  <details><summary>Activity</summary><ul className="campaign-sessions">{data.events.map((e:any)=><li key={e.id}><span>{e.payload.message??e.kind}</span><time>{new Date(e.created_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time></li>)}</ul></details>
 </section>;
}

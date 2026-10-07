"use client";
import { useEffect, useState } from "react";
import type { ExperimentDetail as Detail } from "../../lib/workspace/experiment-detail";
import { WikiFields } from "./policy-wiki";

const label=(s:string)=>s.replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
const number=(n:number)=>new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(n);
export function ExperimentDetail({id,onBack,onVersion,onDiscuss,onReplay}:{id:string;onBack:()=>void;onVersion:(revision:number)=>void;onDiscuss?:(text:string)=>void;onReplay:(episodeId:string,runId:string)=>void}) {
  const [data,setData]=useState<Detail|null>(null),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();setData(null);setError('');
    async function load(){
      try {const r=await fetch(`/api/experiments?id=${encodeURIComponent(id)}`,{signal:controller.signal,cache:'no-store'});
        if(!r.ok)throw Error(r.status===404?'This experiment is not available in your workspace.':'Experiment details could not be loaded.');
        const result=await r.json();if(!controller.signal.aborted){setData(result);setError('');}
      }catch(e){if(!controller.signal.aborted)setError((e as Error).message);}
    }
    void load();const timer=setInterval(()=>void load(),15000);
    return()=>{controller.abort();clearInterval(timer);};
  },[id,refresh]);
  return <section className="experiment-record" aria-label="Experiment details">
    <div className="experiment-record-nav"><button className="text-button" onClick={onBack}>← Experiments</button><div><a className="text-button" href={`/?view=experiments&experiment=${encodeURIComponent(id)}`}>Page link ↗</a><button className="text-button" onClick={()=>setRefresh(n=>n+1)}>Refresh</button></div></div>
    {error?<p role="status">{error} <button className="text-button" onClick={()=>setRefresh(n=>n+1)}>Retry</button></p>:null}
    {!data&&!error?<p role="status">Loading experiment…</p>:null}
    {data?<>
      <header className="experiment-record-heading"><div><h2>{data.title}</h2><p>Hosted test · {data.policy?`r${data.policy.revision}`:'Unlinked policy'} · {new Date(data.createdAt).toLocaleString()}</p></div><span className={`experiment-status ${data.status}`}>{label(data.status)}</span></header>
      <div className="experiment-metrics"><div><small>Completed episodes</small><strong>{data.counts.completed} / {data.counts.total}</strong></div><div><small>Mean policy score</small><strong>{data.meanScore===null?'—':number(data.meanScore)}</strong></div><div><small>Scored seats</small><strong>{data.counts.scoredSeats}</strong></div><div><small>Failed episodes</small><strong>{data.counts.failed}</strong></div></div>
      <p className="evidence-caption">Scores from this hosted test, not league performance. Completing a test does not establish that its hypothesis is correct.</p>
      <div className="experiment-record-grid"><section><h3>Hypothesis</h3><p>{data.hypothesis||'No experiment-specific hypothesis was recorded.'}</p>{data.policy?.researchPlan?<details><summary>Policy revision’s research plan</summary><WikiFields value={data.policy.researchPlan}/></details>:null}</section><section><h3>Policy tested</h3>{data.policy?<><button className="text-button" onClick={()=>onVersion(data.policy!.revision)}>Revision {data.policy.revision} ↗</button><p>{data.policy.summary}</p>{data.policy.label?<code>{data.policy.label}</code>:null}</>:<p>No saved revision is linked to this test.</p>}{data.completedAt?<p className="evidence-caption">Finished {new Date(data.completedAt).toLocaleString()}</p>:null}</section></div>
      <section><div className="workspace-section-heading"><h3>Episodes</h3><small>{data.episodes.length} recorded</small></div><div className="workspace-table-scroll"><table className="workspace-table" aria-label="Experiment episodes"><thead><tr><th>Episode</th><th>Status</th><th>Policy scores</th><th>Replay</th></tr></thead><tbody>{data.episodes.map((e,i)=><tr key={e.id}><td><details><summary>Episode {(e.job_index??i)+1}</summary><code>{e.id}</code>{e.participant_scores.length?<p>{e.participant_scores.map(s=>`Seat ${s.position}: ${number(s.score)}`).join(' · ')}</p>:null}{e.completed_at?<p>{new Date(e.completed_at).toLocaleString()}</p>:null}</details></td><td>{label(e.status)}{e.error?<p className="experiment-episode-error">{e.error}</p>:null}</td><td>{e.our_scores.length?e.our_scores.map(number).join(', '):'—'}</td><td>{e.replay_url?<><button className="text-button" onClick={()=>onReplay(e.id,data.id)}>Open replay ↗</button><a className="experiment-observatory-link" href={`https://softmax.com/observatory/v2/episode-requests/${encodeURIComponent(e.id)}/watch`} target="_blank" rel="noreferrer">Observatory ↗</a></>:<span className="muted">{e.status==='completed'?'Not available':e.status==='failed'?'No replay':'Pending'}</span>}</td></tr>)}{!data.episodes.length?<tr><td colSpan={4}>No episode records yet.</td></tr>:null}</tbody></table></div></section>
      <details className="experiment-record-raw"><summary>Recorded results and verification</summary><WikiFields value={{summary:data.summary,revisionVerification:data.policy?.receipts??null,revisionEvidence:data.policy?.evidence??[],requestId:data.id,revisionId:data.policy?.revisionId??null,parentRevision:data.policy?.parent??null}}/></details>
      <footer className="experiment-record-footer">{onDiscuss?<button className="secondary" onClick={()=>onDiscuss(`Review hosted experiment ${data.id}: ${data.title}. Read its recorded hypothesis, episode results and policy revision. Explain what the evidence supports, what remains unknown, and the next useful test.`)}>Discuss with Preston ↗</button>:null}<small>Workspace records loaded {new Date(data.loadedAt).toLocaleTimeString()}</small></footer>
    </>:null}
  </section>;
}

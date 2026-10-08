"use client";
import { defaultLeagueId } from "../../lib/league-catalog";
import { useEffect, useState } from "react";
import type { LeagueStanding } from "../../lib/softmax";
import type { PolicyRevision } from "../../lib/semantic-ir";
import type { WorkspaceView } from "../../lib/workspace/presentation";
import { useCompanion } from "../partner/companion";
import { StrategyOverview } from "./strategy-overview";
import { PerformanceEvidence, type PerformanceVersion, type PerformanceRound } from "./performance-evidence";
import { GeneratedView } from "./generated-view";
import { Opponents } from "./opponents";
import { ExperimentResults, type ExperimentResult } from "./experiment-results";
import { ExperimentDetail } from "./experiment-detail";
import { BasicCode } from "../basic-code";
import { WikiFields } from "./policy-wiki";
import { policyWikiEntries, wikiPageLabels } from "../../lib/workspace/policy-wiki";
import { Checkbox } from "@/components/ui/checkbox";
type PracticeEpisode = { id: string; run_title: string | null; job_index: number | null; status: string; scores: {policy_version_id:string;score:number}[] };
type Data = {
  episodes: PracticeEpisode[];
  revision: PolicyRevision | null; versions: PerformanceVersion[]; entered: string[];
  standings: LeagueStanding[]; ownPlayerIds: string[]; activePlayerId?: string;
  rounds: PerformanceRound[]; experiments: ExperimentResult[]; at: string; note: string;
};
export function PresentationPane({ onOpen, view, embedded=false, leagueId=defaultLeagueId, onAsk }: { embedded?:boolean; leagueId?:string; onAsk?:(prompt:string)=>void; onOpen:(view:WorkspaceView)=>void; view:WorkspaceView }) {
  const { presentation: p } = useCompanion();
  const [data,setData]=useState<Data|null>(null),[error,setError]=useState(""),[refresh,setRefresh]=useState(0);
  useEffect(()=>{
    if(!view||view.view==='lab'||view.view==='custom'||view.view==='opponents'||view.experimentId)return;const abort=new AbortController();setData(null);setError("");
    const get=async(path:string)=>{const r=await fetch(path,{signal:abort.signal,cache:'no-store'});if(!r.ok)throw Error("Evidence could not be loaded.");return r.json();};
    void (async()=>{
      const w=await get('/api/workspace');let revision:PolicyRevision|null=w.latest;
      if (!revision && !view.revision && ['strategy','development'].includes(view.view)) revision=await get("/api/starter-policy");
      if(view.revision)revision=(await get(`/api/workspace?revision=${view.revision}`)).revision;
      const result:Data={revision,versions:w.versions,standings:[],ownPlayerIds:[],entered:[],rounds:[],episodes:[],experiments:w.experiments??[],at:new Date().toISOString(),note:''};
      if(view.view==='performance'||view.view==='episodes'){
        try{const stats=await get('/api/policy-stats');result.standings=stats.standings??[];result.entered=stats.entered;result.ownPlayerIds=(stats.entries??[]).map((e:{playerId:string})=>e.playerId);
          const selected=view.revision?w.versions.find((v:PerformanceVersion)=>v.revision===view.revision):[...w.versions].reverse().find((v:PerformanceVersion)=>stats.entered.includes(v.policyVersionId))??[...w.versions].reverse().find((v:PerformanceVersion)=>v.policyVersionId);
          const policyId=selected?.policyVersionId??stats.entered[0];
          result.activePlayerId=stats.policies.find((p:{policy_version_id:string})=>p.policy_version_id===policyId)?.player_id??stats.entries?.find((e:{policyVersionId:string})=>e.policyVersionId===policyId)?.playerId;
          if(policyId)result.rounds=(await get(`/api/league-episodes?policyVersionId=${encodeURIComponent(policyId)}`)).episodes;
          result.note=selected?`League sample for r${selected.revision} · latest loaded rounds`:'No uploaded policy selected';
        }catch(e){if(abort.signal.aborted)throw e;result.note='League evidence unavailable. Saved version results remain available.';}
      }
      if(view.view==='episodes')result.episodes=(await get('/api/arena')).episodes.filter((e:PracticeEpisode)=>!view.revision||e.scores.some(s=>s.policy_version_id===result.versions.find(v=>v.revision===view.revision)?.policyVersionId));
      if(!abort.signal.aborted)setData(result);
    })().catch(e=>{if(!abort.signal.aborted)setError(e.message);});
    return()=>abort.abort();
  },[view,refresh]);
  return <section className="preston-presentation presentation-tab-panel" aria-label="Preston presentation">
    <div className="presentation-content" data-highlight={view.highlight}>
      {!view?<p>Select a view from chat, or ask Preston to show the evidence.</p>:<><p className="presentation-reason">{view.reason}</p>{view.view==='lab'?<p>Sessions, workers, and research controls live in Preston’s Lab.</p>:view.view==='custom'&&view.artifactId?<GeneratedView id={view.artifactId} leagueId={leagueId} onAsk={onAsk}/>:view.view==='opponents'?<Opponents initialPolicyId={view.opponentPolicyId}/>:view.view==='experiments'&&view.experimentId?<ExperimentDetail id={view.experimentId} onBack={()=>onOpen({...view,experimentId:undefined})} onVersion={revision=>onOpen({...view,view:'development',wikiPage:'evidence',revision,experimentId:undefined})} onReplay={episodeId=>window.open(`https://softmax.com/observatory/v2/episode-requests/${encodeURIComponent(episodeId)}/watch`,'_blank','noopener,noreferrer')}/>:error?<p role="status">{error} <button onClick={()=>setRefresh(n=>n+1)}>Retry</button></p>:!data?<p role="status">Loading evidence…</p>:<>
      <div className="presentation-freshness">Loaded {new Date(data.at).toLocaleTimeString()} <button className="text-button" onClick={()=>setRefresh(n=>n+1)}>Refresh</button></div>
      {view.view==='performance'?<><p className="evidence-caption">{data.note}</p><PerformanceEvidence standings={data.standings} ownPlayerIds={data.ownPlayerIds} activePlayerId={data.activePlayerId} rounds={data.rounds} last={view.last} opponent={view.opponent} onRound={id=>window.open(`https://softmax.com/observatory/v2/episode-requests/${encodeURIComponent(id)}/watch`,"_blank","noopener,noreferrer")}/></>:null}
      {view.view==='episodes'?<><h3>Episodes</h3><p className="evidence-caption">{data.note}</p><div className="workspace-table-scroll"><table className="workspace-table" aria-label="Presented episodes"><thead><tr><th>Episode</th><th>Kind</th><th>Result</th></tr></thead><tbody>
        {data.rounds.slice(0,view.last).map(r=><tr key={r.id}><td><a href={`https://softmax.com/observatory/v2/episode-requests/${encodeURIComponent(r.id)}/watch`} target="_blank" rel="noreferrer">Round #{r.round.number} ↗</a></td><td>League</td><td>{r.outcome?.replaceAll('_',' ')??'Pending'}</td></tr>)}
        {data.episodes.slice(0,view.last).map(e=><tr key={e.id}><td><a href={`https://softmax.com/observatory/v2/episode-requests/${encodeURIComponent(e.id)}/watch`} target="_blank" rel="noreferrer">{e.run_title??'Hosted game'} · #{(e.job_index??0)+1} ↗</a></td><td>Practice</td><td>{e.status}</td></tr>)}
        {!data.rounds.length&&!data.episodes.length?<tr><td colSpan={3}>No episodes yet.</td></tr>:null}
      </tbody></table></div></>:null}
      {view.view==='strategy'?(data.revision?<StrategyOverview revision={data.revision} branchId={view.branchId} onSource={branchId=>onOpen({...view,view:'development',branchId})}/>:<p>No saved strategy yet.</p>):null}
      {view.view==='development'?(data.revision?<WikiPresentation revision={data.revision} view={view} onOpen={onOpen}/>:<p>No saved policy records yet.</p>):null}
      {view.view==='experiments'?<ExperimentResults experiments={data.experiments} loading={false} error="" onInspect={experimentId=>onOpen({...view,experimentId})} onLab={()=>onOpen({...view,view:'lab'})}/>:null}
      </>}{!embedded?<div className="presentation-actions">{view.view!=="custom"?<button className="secondary" onClick={()=>onOpen(view)}>{view.view==='lab'?'Open Lab ↗':'Open in workspace ↗'}</button>:null}<label><Checkbox checked={p.follow} onCheckedChange={checked=>p.setFollow(checked===true)}/>Follow Preston</label></div>:null}</>}
    </div>
  </section>;
}

function WikiPresentation({revision,view,onOpen}:{revision:PolicyRevision;view:WorkspaceView;onOpen:(view:WorkspaceView)=>void}) {
  const page=view.wikiPage??(view.branchId?'source':'overview');
  const entries=policyWikiEntries(revision),entry=entries.find(e=>e.key===view.entityId);
  return <div className="wiki-article"><h3>{wikiPageLabels[page]} · {revision.ir.update.revision?`r${revision.ir.update.revision}`:'starter'}</h3>
    {page==='source'?<BasicCode source={revision.source} onSelectOffset={()=>{}}/>:
     page==='ontology'?entry?<><h4>{entry.id}</h4><WikiFields value={entry.fields}/></>:<><p>{entries.length} objects in this revision.</p><div className="wiki-reference-list">{entries.map(e=><button className="text-button" key={e.key} onClick={()=>onOpen({...view,wikiPage:'ontology',entityId:e.key})}>{e.kind} · {e.id} — {e.summary} ↗</button>)}</div></>:
     page==='beliefs'?<><h4>Revision beliefs</h4><WikiFields value={revision.ir.belief.claims}/><p>Open the wiki for current shared beliefs, disagreements and lessons.</p></>:
     page==='evidence'?<WikiFields value={{receipts:revision.receipts,research_plan:revision.ir.update.research_plan,evidence:revision.ir.update.evidence}}/>:
     page==='reference'?<WikiFields value={{authority:revision.ir.situation.authority,unknowns:revision.ir.situation.unknowns}}/>:
     page==='versions'?<WikiFields value={revision.ir.update}/>:
     <><p>{revision.ir.update.change}</p><div className="wiki-reference-list">{Object.entries(wikiPageLabels).filter(([key])=>key!=='overview').map(([key,label])=><button key={key} className="text-button" onClick={()=>onOpen({...view,wikiPage:key as NonNullable<WorkspaceView['wikiPage']>})}>{label} ↗</button>)}</div></>}
  </div>;
}

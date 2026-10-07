import { db } from '../db';
import { checked,artifact,readArtifact } from './store';
import { sourceForHash,episodeArtifact } from './provider';
import { requestReplayAudit,readReplayAudit } from './worker';
import { releaseFingerprint,sha } from './model';

export async function markObserved(studentId:string,leagueId:string,episodeId:string,reason:string,seed?:number){
 const reserved=checked(await db().from('research_fixtures').select('id,research_studies!inner(state,cohort)').eq('student_id',studentId).eq('league_id',leagueId).eq('episode_id',episodeId).in('research_studies.state',['running','auditing']));
 if(reserved?.length)throw Error('This episode is reserved for a frozen study; research cannot inspect its outcomes');
 checked(await db().from('research_exclusions').upsert({student_id:studentId,league_id:leagueId,episode_id:episodeId,seed_key:seed===undefined?null:String(seed),reason},{onConflict:'student_id,league_id,episode_id',ignoreDuplicates:seed===undefined}));
}
export async function inspectReplay(studentId:string,token:string,leagueId:string,episodeId:string,slot:number,campaignId?:string,taskId?:string){
 await markObserved(studentId,leagueId,episodeId,'Replay inspection');
 // A researcher polling the same queued audit needs its status, not another
 // replay download. Completed receipts still take the refresh path on later
 // inspections, allowing decoder/source upgrades without stale cached evidence.
 const previous=checked(await db().from('research_artifacts').select('content')
  .eq('student_id',studentId).eq('league_id',leagueId).eq('kind','replay-evidence')
  .eq('content->>episodeId',episodeId).eq('content->>slot',String(slot))
  .order('created_at',{ascending:false}).limit(1).maybeSingle())?.content as any;
 if(previous?.release&&previous.audit?.jobId&&['queued','running','waiting'].includes(previous.audit.status)){
  const audit=await readReplayAudit(previous.release,previous.audit.jobId,episodeId,{studentId,campaignId,taskId});
  if(audit){
   if(audit.status==='completed'&&(audit.result?.release!==previous.release.fingerprint||audit.result?.replayHash!==previous.replayHash))throw Error('Replay audit receipt identity mismatch');
   const content={...previous,audit,subjectVmReexecuted:audit.status==='completed'&&!!audit.result?.vm};
   return saveReplayEvidence(studentId,leagueId,content,campaignId,taskId);
  }
 }
 const [spec,results,status,replay]=await Promise.all([episodeArtifact(token,episodeId,'spec'),episodeArtifact(token,episodeId,'results'),episodeArtifact(token,episodeId,'player-status'),episodeArtifact(token,episodeId,'replay')]);
 await markObserved(studentId,leagueId,episodeId,'Replay inspection',results.seed);
 const sourceHash=spec.players?.[slot]?.content_hash;
 if(!/^[a-f0-9]{64}$/.test(sourceHash))throw Error('Replay player source identity is unavailable');
 const source=await sourceForHash(token,spec.coworld_id,sourceHash,studentId).catch(()=>undefined);
 const release={coworldId:spec.coworld_id,sourceUrl:spec.manifest.game.runnable.source_url,fingerprint:releaseFingerprint(spec.manifest)};
 const audit=await requestReplayAudit({episodeId,release,replay,source,slot,scope:{studentId,campaignId,taskId}});
 const content={episodeId,slot,release,sourceHash,replayHash:sha(replay),results,status,audit,subjectVmReexecuted:audit.status==='completed'&&!!audit.result?.vm};
 return saveReplayEvidence(studentId,leagueId,content,campaignId,taskId);
}
async function saveReplayEvidence(studentId:string,leagueId:string,content:any,campaignId?:string,taskId?:string){
 const {episodeId,slot,release,audit}=content;
 const artifactId=await artifact(studentId,leagueId,'replay-evidence',`Replay ${episodeId} · seat ${slot}`,content,{campaignId,taskId,provenance:{episodeId,slot,release}});
 return {artifactId,...content,note:audit.status==='completed'?(content.subjectVmReexecuted?'Native replay and subject VM evidence; local mechanisms are not competitive treatment effects.':'Native replay evidence; subject VM was not re-executed.'):'Structured results only until audit completes. Do not claim replay behavior was observed.'};
}
export async function publishClaim(studentId:string,leagueId:string,input:{title:string;claim:string;kind:'observation'|'hypothesis'|'counterexample';evidenceIds:string[];episodeId?:string;tickStart?:number;tickEnd?:number;actor?:string;action?:string;falsifier:string},campaignId?:string,taskId?:string){
 const evidence=await Promise.all(input.evidenceIds.map(id=>readArtifact(studentId,id)));
 if(!evidence.length||evidence.some(e=>!e||e.league_id!==leagueId))throw Error('Claims require accessible evidence in this league');
 if(input.kind==='observation'&&(!input.episodeId||input.tickStart===undefined||!input.action))throw Error('Behavior observations require episode, tick and action');
 if(input.tickEnd!==undefined&&input.tickStart!==undefined&&input.tickEnd<input.tickStart)throw Error('Invalid tick range');
 if(input.kind==='observation'&&!evidence.some(e=>e.content?.episodeId===input.episodeId&&e.content?.audit?.status==='completed'))throw Error('Behavior observations require completed replay evidence');
 return artifact(studentId,leagueId,'claim',input.title,input,{campaignId,taskId,provenance:{evidenceIds:input.evidenceIds}});
}

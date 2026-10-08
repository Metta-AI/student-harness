import {studyHumanSummary} from '../tasks/communication';
import {mapConcurrent} from './batch';
import {attemptBatch,transportCooldownUntil} from './attempt-queue';
import { db,studentToken } from '../db';
import { rpc } from '../tasks/store';
import { checked,claimStudy,saveStudy,artifact,campaignById } from './store';
import { gameRequest,hashObject,summarize,type Study,type Fixture,type OutcomeSummary } from './model';
import { apiJSON,currentRelease,episodeArtifact,verifyAudit } from './provider';
import { requestReplayAudit,readReplayAudit,auditWorkerReady } from './worker';

type Attempt={id:string;fixture_id:string;arm:'baseline'|'candidate';attempt:number;request_key:string;request:any;xp_id:string|null;episode_id:string|null;state:string;receipt:any;result:OutcomeSummary|null;next_at:string;created_at:string;updated_at:string};
// Full outcomes retain native replay timelines for inspection. Polling only needs
// scores: loading every receipt repeatedly grows into tens of MB and DB timeouts.
const attemptColumns='id,fixture_id,arm,attempt,request_key,request,xp_id,episode_id,state,receipt,next_at,created_at,updated_at,result:outcome_summary';
async function readAttempts(studyId:string):Promise<Attempt[]>{
 const rows=checked(await db().from('research_attempts').select(attemptColumns).eq('study_id',studyId));
 if(!rows)throw Error('Study attempts unavailable');
 return rows as Attempt[];
}
function unscoredTransportFailure(episode:any):boolean{
 const empty=(scores:unknown)=>scores==null||Array.isArray(scores)&&scores.length===0;
 return ['failed','error','canceled','cancelled'].includes(episode?.status)&&episode.error_type==='artifact_transport_error'
  &&empty(episode.scores)&&empty(episode.participant_scores)&&episode.failed_policy_index==null&&episode.failed_agent_index==null
  &&!episode.failed_policy_version_id&&!episode.failed_agent_id;
}
async function write(s:Study,a:Attempt,patch:Record<string,unknown>){await rpc('campaign_attempt_write',{p_study:s.id,p_token:s.lease_token,p_id:a.id,p_patch:patch});}
async function active(s:Study){
 const c=await campaignById(s.campaign_id,s.student_id);
 const lease=checked(await db().from('research_studies').select('id').eq('id',s.id).eq('lease_token',s.lease_token).gt('lease_until',new Date().toISOString()).maybeSingle());
 return c?.state==='active'&&!!lease;
}
function attemptRow(s:Study,fixture:{id:string;fixture:Fixture},arm:'baseline'|'candidate',attempt:number){
 const version=arm==='baseline'?s.protocol.baseline.versionId:s.protocol.candidate.versionId!;
 const request=gameRequest(s.id,fixture.id,fixture.fixture,arm,version,attempt);
 return {study_id:s.id,fixture_id:fixture.id,arm,attempt,request_key:request.idempotency_key,request,next_at:new Date(Date.now()+(attempt?30000*2**attempt:0)).toISOString()};
}
export async function createAttempt(s:Study,fixture:{id:string;fixture:Fixture},arm:'baseline'|'candidate',attempt:number){
 checked(await db().from('research_attempts').upsert(attemptRow(s,fixture,arm,attempt),{onConflict:'request_key',ignoreDuplicates:true}));
}
/** A bounded poll. No process, browser, voice connection, or model turn waits for games. */
export async function processStudy(id:string){
 const s=await claimStudy(id);if(!s)return;
 // Leave half the three-minute lease for in-flight I/O and checkpoint writes.
 // Unstarted attempts stay queued; the next poll resumes their exact inputs.
 const workUntil=Date.now()+90_000;
 try{
  if(hashObject(s.protocol)!==s.protocol_hash)throw Error('Frozen study protocol hash mismatch');
  const token=await studentToken(s.student_id);
  const campaign=await campaignById(s.campaign_id,s.student_id);if(!campaign)throw Error('Campaign not found');
  let running=campaign.state==='active';
  let invalidReason=(s.result as unknown as {invalidReason?:string}|null)?.invalidReason;
  const fixtures=checked(await db().from('research_fixtures').select('id,fixture').eq('study_id',id)) as {id:string;fixture:Fixture}[];
  if(fixtures.length!==s.protocol.pairs)throw Error('Frozen fixture count mismatch');
  let attempts=await readAttempts(id);
  const failedAttempt=attempts.find(a=>a.state==='invalid'||(a.state==='infra_failed'&&a.attempt>=2));
  if(failedAttempt&&!invalidReason)invalidReason=`Attempt ${failedAttempt.id} could not establish a valid comparison`;
  if(running&&!(await auditWorkerReady(s.protocol.release,{studentId:s.student_id,campaignId:s.campaign_id,taskId:s.task_id})))running=false;
  if(running){
   const release=await currentRelease(token,campaign.league_id);
   if(release.fingerprint!==s.protocol.release.fingerprint){invalidReason='Canonical game release changed';running=false;}
   if(running&&!invalidReason){
    const existing=new Set(attempts.map(a=>a.request_key));
    const missing=fixtures.flatMap(f=>['baseline','candidate'].map(arm=>attemptRow(s,f,arm as Attempt['arm'],0))).filter(a=>!existing.has(a.request_key));
    if(missing.length){
     checked(await db().from('research_attempts').upsert(missing,{onConflict:'request_key',ignoreDuplicates:true}));
     attempts=await readAttempts(id);
    }
   }
  }
  if(invalidReason)running=false;
  if(invalidReason)await db().from('research_studies').update({result:{...s.result,invalidReason}}).eq('id',s.id).eq('lease_token',s.lease_token); 
  // Recover the gap between recording a terminal infrastructure failure and queuing its retry.
  if(running)for(const a of attempts.filter(a=>a.state==='infra_failed'&&a.attempt<2)){
   if(!attempts.some(b=>b.fixture_id===a.fixture_id&&b.arm===a.arm&&b.attempt>a.attempt))await createAttempt(s,fixtures.find(f=>f.id===a.fixture_id)!,a.arm,a.attempt+1);
  }
  const cooldown=transportCooldownUntil(attempts);
  const batch=attemptBatch(attempts,campaign.protocol.concurrency,running&&!cooldown);
  const results=await mapConcurrent(batch,4,async a=>{
   if(Date.now()>=workUntil)return;
   let stage='Prepare attempt';
   try{
   const f=fixtures.find(f=>f.id===a.fixture_id)!;
   let savedAudit;
   if(a.state==='auditing'&&a.episode_id&&a.receipt?.auditJob){
    stage='Poll native replay audit';
    savedAudit=await readReplayAudit(s.protocol.release,a.receipt.auditJob,a.episode_id,{studentId:s.student_id,campaignId:s.campaign_id,taskId:s.task_id});
    if(savedAudit&&savedAudit.status!=='completed'){await write(s,a,{error:null});return;}
   }
   if(!a.xp_id){
    if(!await active(s))return;
    const allowed=await rpc<boolean>('research_daily_reserve',{p_student:s.student_id,p_key:`study:${a.request_key}`});
    if(!allowed){await write(s,a,{error:'Daily spending limit reached',next_at:new Date(Date.now()+300000).toISOString()});return;}
    await write(s,a,{state:'submitting'});
    if(!await active(s))return;
    stage='Submit hosted game';
    const xp=await apiJSON(token,'/v2/experience-requests',a.request);
    if(typeof xp.id!=='string')throw Error('Hosted request receipt missing ID');
    await write(s,a,{xp_id:xp.id,state:'requested',receipt:{created:xp}});return;
   }
   stage='Poll hosted request';
   const xp=await apiJSON(token,`/v2/experience-requests/${encodeURIComponent(a.xp_id)}`);
   const ep=xp.episodes?.[0];
   if(!ep){if(['failed','canceled','cancelled'].includes(xp.status))await write(s,a,{state:'invalid',receipt:{...a.receipt,terminal:xp},error:'Hosted request ended without an episode'});return;}
   const episodeId=ep.episode_request_id??ep.id;
   stage='Poll hosted episode';
   const live=await apiJSON(token,`/v2/episode-requests/${encodeURIComponent(episodeId)}`);
   a.receipt={...a.receipt,episode:live};
   await write(s,a,{episode_id:episodeId,receipt:a.receipt,state:a.state==='auditing'?'auditing':'requested'});
   if(['failed','error','canceled','cancelled'].includes(live.status)){
    const infra=unscoredTransportFailure(live);
    await write(s,a,{state:infra?'infra_failed':'invalid',error:infra?'Artifact transport failed; exact-input retry':'Hosted policy/game failure',receipt:{...a.receipt,episode:live}});
    if(infra&&a.attempt<2&&running&&await active(s))await createAttempt(s,f,a.arm,a.attempt+1);
    return;
   }
   if(live.status!=='completed')return;
   if(hashObject(live.policy_version_ids)!==hashObject(a.request.roster.map((p:any)=>p.player.policy_ref)))throw Error('Hosted policy version roster mismatch');
   const source=a.arm==='baseline'?s.protocol.baseline:s.protocol.candidate;
   stage='Download game artifacts';
   const [spec,result,status,replay]=await Promise.all([episodeArtifact(token,episodeId,'spec'),episodeArtifact(token,episodeId,'results'),episodeArtifact(token,episodeId,'player-status'),episodeArtifact(token,episodeId,'replay')]);
   stage='Queue or read native replay audit';
   const native=savedAudit??await requestReplayAudit({episodeId,release:s.protocol.release,replay,source:source.source,slot:f.fixture.slot,scope:{studentId:s.student_id,campaignId:s.campaign_id,taskId:s.task_id}});
   if(native.status!=='completed'){await write(s,a,{state:'auditing',error:native.message??null,receipt:{...a.receipt,auditJob:native.jobId}});return;}
   stage='Verify replay evidence';
   const outcome=verifyAudit(f.fixture,source.sourceHash,episodeId,spec,result,status,replay,native.result);
   const evidenceId=await artifact(s.student_id,campaign.league_id,'episode-audit',`Audited ${a.arm} · ${episodeId}`,{spec,result,status,outcome},{campaignId:campaign.id,taskId:s.task_id,provenance:{studyId:s.id,fixtureId:f.id,attemptId:a.id}});
   await write(s,a,{state:'complete',result:outcome,error:null,receipt:{...a.receipt,evidenceId}});
   }catch(error){return {attempt:a,error:new Error(`${stage}: ${error instanceof Error?error.message:String(error)}`)};}
  });
  const failures=results.filter((r):r is NonNullable<typeof r>=>!!r);
  for(const failure of failures){
   const message=String(failure.error?.message??failure.error).slice(0,1000);
   const invalid=/mismatch|VM failed|Unknown GoTA|protocol|missing or mismatched/.test(message);
   await write(s,failure.attempt,{...(invalid?{state:'invalid'}:{}),error:message,next_at:new Date(Date.now()+60000).toISOString()});
  }
  attempts=await readAttempts(id);
  const completed=attempts.filter(a=>a.state==='complete');
  let invalid=!!invalidReason||attempts.some(a=>a.state==='invalid'||(a.state==='infra_failed'&&a.attempt>=2));
  const pairs:{baseline:OutcomeSummary;candidate:OutcomeSummary}[]=[];
  for(const f of fixtures){
   const base=completed.filter(a=>a.fixture_id===f.id&&a.arm==='baseline'),candidate=completed.filter(a=>a.fixture_id===f.id&&a.arm==='candidate');
   if(base.length>1||candidate.length>1)throw Error('Duplicate completed attempts require reconciliation');
   if(base.length&&candidate.length)pairs.push({baseline:base[0].result!,candidate:candidate[0].result!});
  }
  const outstanding=attempts.some(a=>(a.xp_id||a.state==='submitting')&&!['complete','invalid','infra_failed'].includes(a.state));
  let state='running',result=null;
  if(invalid&&!outstanding)state='invalid';
  else if(pairs.length===s.protocol.pairs&&!invalid){
   // Reconcile every failed attempt before deciding; never silently discard a late scored result.
   for(const a of attempts.filter(a=>a.state==='infra_failed')){
    const original=await apiJSON(token,`/v2/episode-requests/${encodeURIComponent(a.episode_id!)}`);
    if(!unscoredTransportFailure(original)){
     invalid=true;invalidReason=original.status==='completed'?'A previously failed attempt completed. Comparison invalidated; all attempt receipts are retained.':'A previously retryable attempt is no longer an unscored transport failure. Comparison invalidated; all attempt receipts are retained.';
     await write(s,a,{state:'invalid',receipt:{...a.receipt,lateReconciliation:original,...(original.status==='completed'?{lateCompletion:original}:{})},error:invalidReason});
    }
   }
   state=invalid?'invalid':'completed';result=invalid?null:summarize(pairs,s.protocol.pairs,s.protocol.gate);
  }
  else if(!running&&!outstanding&&campaign.state==='canceled')state='canceled';
  else if(attempts.some(a=>a.state==='auditing'))state='auditing';
  const retryAt=transportCooldownUntil(attempts);
  checked(await db().from('agent_tasks').update({status:state==='completed'?'completed':state==='invalid'?'failed':state==='canceled'?'canceled':campaign.state==='paused'?'paused':campaign.state==='canceled'?'canceled':'waiting',
   result:result?{humanSummary:studyHumanSummary(result,s.cohort),summary:`${s.cohort}: wins ${result.baselineWins} → ${result.candidateWins}; ${result.interpretation}`,studyId:id,...result}:null,
   checkpoint:{campaign_id:campaign.id,study_id:id,research_progress:{summary:`${pairs.length}/${s.protocol.pairs} pairs · ${completed.length} audited games · ${attempts.length} attempts${retryAt&&running&&!invalid?` · Host transport cooldown until ${new Date(retryAt).toISOString()}`:''}`}},
   reason:invalidReason??failures[0]?.error?.message??null,next_check_at:'2100-01-01T00:00:00Z',updated_at:new Date().toISOString()}).eq('id',s.task_id));
  await saveStudy(s,{state,...(result?{result}:invalidReason?{result:{invalidReason}}:{})},30);
 }catch(error){
  const message=String(error instanceof Error?error.message:error);
  const fatal=/Frozen (study protocol hash|fixture count) mismatch|Duplicate completed attempts/.test(message);
  await saveStudy(s,{...(fatal?{state:'invalid'}:{}),result:{...(await db().from('research_studies').select('result').eq('id',s.id).single()).data?.result,...(fatal?{invalidReason:message}:{}),error:message}},60);
 }
}

import { db } from '../db';
import { checked,recordEvent } from './store';
import { apiJSON,champions,currentRelease,uploadPolicy } from './provider';
import { sha,type Campaign,type Study,type Baseline } from './model';

export async function promoteStudy(c:Campaign,s:Study,token:string){
 if(s.cohort!=='confirmation'||s.state!=='completed'||!s.result?.passed)throw Error('Independent confirmation gate has not passed');
 if(!c.protocol.promote)return {status:'not_requested'};
 const source=s.protocol.candidate.source;
 if(sha(source)!==s.protocol.candidate.sourceHash)throw Error('Tested candidate hash mismatch');
 if((await currentRelease(token,c.league_id)).fingerprint!==s.protocol.release.fingerprint)throw Error('Release changed before promotion');
 const baselines=c.checkpoint.baselines as Baseline[];
 let allVerified=true;
 for(const baseline of baselines){
  const current=checked(await db().from('research_campaigns').select('state,lease_token,lease_until').eq('id',c.id).single());
  if(current?.state!=='active'||current.lease_token!==c.lease_token||Date.parse(current.lease_until)<=Date.now())throw Error('Promotion stopped');
  const existing=checked(await db().from('research_deployments').select('*').eq('study_id',s.id).eq('player_id',baseline.playerId).maybeSingle());
  let d=existing;
  if(!d){
   d=checked(await db().from('research_deployments').insert({student_id:c.student_id,campaign_id:c.id,study_id:s.id,player_id:baseline.playerId,incumbent_id:baseline.versionId,candidate_hash:s.protocol.candidate.sourceHash,
    receipt:{rollback:{league_id:c.league_id,player_id:baseline.playerId,policy_version_id:baseline.versionId,auto_champion:'always'},protocolHash:s.protocol_hash}}).select('*').single());
  }
  if(!d)throw Error('Deployment record missing');
  if(d.state==='verified'){
   const live=(await champions(token,c.league_id,[baseline.playerId]))[0];
   if(live.versionId!==d.candidate_version_id)throw Error('Incumbent changed after verified deployment');
   continue;
  }
  if(d.state==='conflict')throw Error('Another writer changed the champion; deployment has a conflict');
  const live=(await champions(token,c.league_id,[baseline.playerId]))[0];
  if(live.versionId!==baseline.versionId&&live.versionId!==d.candidate_version_id){
   checked(await db().from('research_deployments').update({state:'conflict',receipt:{...d.receipt,observed:live}}).eq('id',d.id));
   throw Error('Another writer changed the champion; deployment has a conflict');
  }
  if(!d.candidate_version_id){
   const uploaded=await uploadPolicy(token,c.student_id,source,s.protocol.candidate.summary,`preston-${c.id.slice(0,8)}-${c.cycle}`,baseline.playerId);
   const meta=await apiJSON(token,`/stats/policy-versions/${uploaded.id}`);
   if(meta.player_file_content_hash&&meta.player_file_content_hash!==d.candidate_hash)throw Error('Uploaded policy differs from tested source');
   d=checked(await db().from('research_deployments').update({candidate_version_id:uploaded.id,state:'uploaded',receipt:{...d.receipt,upload:uploaded}}).eq('id',d.id).select('*').single());
  }
  const candidateId=d.candidate_version_id;
  const members=await champions(token,c.league_id,[baseline.playerId]);
  if(members[0].versionId===candidateId){
   checked(await db().from('research_deployments').update({state:'verified',receipt:{...d.receipt,after:members[0]},updated_at:new Date().toISOString()}).eq('id',d.id));
   await recordEvent(c,`deployed:${s.id}:${baseline.playerId}`,'policy.deployed',{studyId:s.id,playerId:baseline.playerId,versionId:candidateId,rollbackVersionId:baseline.versionId});continue;
  }
  if(members[0].versionId!==baseline.versionId)throw Error('Incumbent changed during upload');
  // Reconcile uncertain POST outcomes before retrying a submission.
  const previous=await apiJSON(token,`/v2/league-submissions?league_id=${encodeURIComponent(c.league_id)}&policy_version_id=${encodeURIComponent(candidateId)}&mine=true&limit=100`);
  const entries=Array.isArray(previous)?previous:previous.entries;
  let submission=entries.find((e:any)=>e.policy_version?.id===candidateId&&e.player?.id===baseline.playerId);
  if(!submission&&!d.receipt.submission){
   const liveCampaign=checked(await db().from('research_campaigns').select('state,lease_token').eq('id',c.id).single());
   if(liveCampaign?.state!=='active'||liveCampaign.lease_token!==c.lease_token)throw Error('Promotion stopped');
   checked(await db().from('research_deployments').update({state:'submitted'}).eq('id',d.id));
   submission=await apiJSON(token,'/v2/league-submissions',{league_id:c.league_id,player_id:baseline.playerId,policy_version_id:candidateId,auto_champion:'always',notes:`Preston study ${s.id}: ${s.result.baselineWins} → ${s.result.candidateWins} wins; utility interval ${s.result.interval.join(', ')}. Exact audited source.`});
  }
  if(submission&&['failed','rejected','canceled','cancelled'].includes(submission.status)){
   checked(await db().from('research_deployments').update({state:'rejected',receipt:{...d.receipt,submission}}).eq('id',d.id));
   throw Error('League qualification rejected this deployment');
  }
  checked(await db().from('research_deployments').update({state:'verifying',receipt:{...d.receipt,submission:submission??d.receipt.submission,before:members[0]},updated_at:new Date().toISOString()}).eq('id',d.id));
  allVerified=false;
 }
 return {status:allVerified?'verified':'verifying'};
}

/** Read-only reconciliation continues after pause/cancel, without another upload or submit. */
export async function reconcileStoppedDeployments(c:Campaign,token:string){
 const rows=checked(await db().from('research_deployments').select('*').eq('campaign_id',c.id).in('state',['prepared','uploaded','submitted','verifying']))??[];
 for(const d of rows){
  if(c.state==='canceled'&&['prepared','uploaded'].includes(d.state)){
   checked(await db().from('research_deployments').update({state:'canceled',updated_at:new Date().toISOString()}).eq('id',d.id));continue;
  }
  if(!d.candidate_version_id)continue;
  const live=(await champions(token,c.league_id,[d.player_id]))[0];
  if(live.versionId===d.candidate_version_id){
   checked(await db().from('research_deployments').update({state:'verified',receipt:{...d.receipt,after:live},updated_at:new Date().toISOString()}).eq('id',d.id));
   await recordEvent(c,`deployed:${d.study_id}:${d.player_id}`,'policy.deployed',{studyId:d.study_id,playerId:d.player_id,versionId:d.candidate_version_id,rollbackVersionId:d.incumbent_id});
  }else if(live.versionId!==d.incumbent_id){
   checked(await db().from('research_deployments').update({state:'conflict',receipt:{...d.receipt,observed:live},updated_at:new Date().toISOString()}).eq('id',d.id));
  }else if(['submitted','verifying'].includes(d.state)){
   const response=await apiJSON(token,`/v2/league-submissions?league_id=${encodeURIComponent(c.league_id)}&policy_version_id=${encodeURIComponent(d.candidate_version_id)}&mine=true&limit=100`);
   const entry=(Array.isArray(response)?response:response.entries).find((e:any)=>e.policy_version?.id===d.candidate_version_id&&e.player?.id===d.player_id);
   if(entry&&['failed','rejected','canceled','cancelled'].includes(entry.status))checked(await db().from('research_deployments').update({state:'rejected',receipt:{...d.receipt,submission:entry},updated_at:new Date().toISOString()}).eq('id',d.id));
   // An uncertain external operation retains its receipt and writer lock until resolved.
  }
 }
}

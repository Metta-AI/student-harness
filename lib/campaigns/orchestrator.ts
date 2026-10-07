import {extendFixtures,freshSeedFixtures} from './fixtures';
import {observedSeed} from './exclusions';
import {fixtureHistory} from './fixture-history';
import {mapConcurrent} from './batch';
import {selectResearchOpponents,researchProgress} from './research-progress';
import {reusableOpponentResearch} from './research-reuse';
import {verifiedCandidate,InvalidCandidate} from './candidate';
import { db,studentToken } from '../db';
import { createTask,rpc,taskById } from '../tasks/store';
import { opponentRoster } from '../opponents/store';
import { artifact,checked,claimCampaign,saveCampaign,recordEvent } from './store';
import { fixtureInputs,leagueFixtureMetadata,resolveBaselines,uploadPolicy } from './provider';
import { hashObject,type Campaign,type Fixture,type Study,type StudyProtocol,type Baseline } from './model';
import { auditWorkerReady,validatePolicySource } from './worker';
import { processStudy } from './studies';
import { promoteStudy,reconcileStoppedDeployments } from './promotion';

async function child(c:Campaign,role:string,objective:string,extra:Record<string,string>={}){
 return createTask(c.student_id,{kind:'research',objective,acceptanceCriteria:role==='candidate'?'Return compatible source components grounded in recorded evidence, including failure cases.':'Save observed behavior, hypotheses, counterexamples and concrete candidate ideas with exact evidence references.',
  context:{mode:role==='candidate'?'candidate':'model',campaignId:c.id,role,leagueId:c.league_id,baselineHash:c.checkpoint.baselines?.[0]?.sourceHash,releaseFingerprint:c.checkpoint.release?.fingerprint,title:role==='candidate'?`Build candidate · cycle ${c.cycle+1}`:objective.slice(0,100),...extra},
  requestKey:`campaign:${c.id}:${c.cycle}:${role}:${extra.policyId??'all'}${extra.attempt?`:repair:${extra.attempt}`:''}`,maxModelCalls:100});
}
async function finishCycle(c:Campaign,message:string,details:unknown,delay:number){
 await artifact(c.student_id,c.league_id,'cycle-result',`Cycle ${c.cycle+1}: ${message}`,{cycle:c.cycle,cycleNumber:c.cycle+1,message,details},{campaignId:c.id,taskId:c.task_id});
 await recordEvent(c,`cycle:${c.cycle}:finished`,'cycle.finished',{message,details});
 return saveCampaign(c,{phase:'observe',checkpoint:{...c.checkpoint,lastResult:{summary:message,details},message}},delay);
}
export async function processCampaign(id:string){
 const c=await claimCampaign(id);if(!c)return;
 try{
  if(c.state!=='active'){await reconcileStoppedDeployments(c,await studentToken(c.student_id));return saveCampaign(c,{},300);}
  const token=await studentToken(c.student_id),cp=c.checkpoint;
  if(c.phase==='baseline'){
   const baseline=await resolveBaselines(token,c.league_id,c.player_ids,c.student_id);
   const baselineId=await artifact(c.student_id,c.league_id,'baseline',`Current champion · ${baseline.baselines[0].playerName}`,baseline,{campaignId:c.id,taskId:c.task_id,provenance:{checkedAt:new Date().toISOString()}});
   return saveCampaign(c,{phase:'research',player_ids:baseline.baselines.map(b=>b.playerId),checkpoint:{...cp,...baseline,baselineId,message:'Inspecting league opponents and replay evidence'}});
  }
  if(c.phase==='research'){
   if(cp.researchTasks&&cp.lastResult?.details?.studyId&&!cp.resultReview){
    const review=await child(c,'result-review','Review the previous completed matched study supplied in context. Inspect the exact baseline/candidate replay evidence for regressed and improved pairs, and cases where behavior changed without improving wins. Distinguish demonstrated effects from mechanism hypotheses. Save a reusable negative-result artifact, identify what to preserve or avoid, and recommend a different evidence-backed mechanism or justified repair. Do not reuse these fixtures as independent validation.');
    return saveCampaign(c,{checkpoint:{...cp,resultReview:review.id,researchTasks:[...cp.researchTasks,review.id],message:'Reviewing the previous experiment alongside fresh replay investigations'}});
   }
   if(!cp.researchTasks){
    const opponents=selectResearchOpponents((await opponentRoster(c.student_id,token,c.league_id)).profiles);
    const reused:string[]=[];
    const tasks=await Promise.all(opponents.map(async p=>{
     const previous=await reusableOpponentResearch(c,p.policyId);
     if(previous){reused.push(previous.id);return previous;}
     return child(c,'opponent',`Model ${p.policyLabel} from league replay evidence. Identify observable behaviors, weaknesses, counterexamples and actionable changes that could improve our team wins. Save semantic IR.`,{policyId:p.policyId});
    }));
    tasks.push(await child(c,'replay',`Investigate recent losses, draws and outlier resource/objective events for our current champion ${cp.baselines[0].versionId}. Find measurable mechanisms and counterexamples. Read shared research history before repeating an old idea.`,{policyId:cp.baselines[0].versionId}));
    if(reused.length)await recordEvent(c,`cycle:${c.cycle}:research-reused`,'research.reused',{taskIds:reused,baselineHash:cp.baselines[0].sourceHash,releaseFingerprint:cp.release.fingerprint});
    return saveCampaign(c,{checkpoint:{...cp,researchTasks:tasks.map(t=>t.id),reusedResearchTasks:reused,message:`${tasks.length-reused.length} new research sessions${reused.length?`; reusing ${reused.length} matching opponent models`:''}`}});
   }
   const tasks=await Promise.all((cp.researchTasks as string[]).map(id=>taskById(id,c.student_id)));
   if(tasks.some(t=>!t||['queued','running','waiting','paused'].includes(t.status)))return saveCampaign(c,{checkpoint:{...cp,message:researchProgress(tasks)}},30);
   const auditors=checked(await db().from('research_audit_sessions').select('id').eq('campaign_id',c.id))??[];
   const auditJobs=auditors.length?checked(await db().from('research_audit_jobs').select('state,job_id').in('audit_session_id',auditors.map(a=>a.id))):[];
   if(auditJobs?.some(j=>['queued','running','waiting'].includes(j.state)))return saveCampaign(c,{checkpoint:{...cp,message:'Replay auditor is checking evidence on its dedicated VM'}},30);
   // Publish peer findings before synthesis starts, so its initial context includes
   // the work it is supposed to reconcile, not only a generic artifact search.
   const evidenceIds:string[]=[];
   for(const t of tasks)if(t?.result)evidenceIds.push(await artifact(c.student_id,c.league_id,'session-result',t.objective,{taskId:t.id,status:t.status,result:t.result},{campaignId:c.id,taskId:t.id}));
   if(auditJobs?.some(j=>j.state==='completed')&&!cp.auditFollowup){
    const followup=await child(c,'audit-synthesis','Read the completed replay-evidence artifacts from our replay auditor. Reconcile the opponent models and earlier hypotheses against exact native evidence. Save actionable findings and counterexamples; distinguish local mechanisms from competitive effects.');
    return saveCampaign(c,{checkpoint:{...cp,evidenceIds,auditFollowup:true,researchTasks:[...cp.researchTasks,followup.id],message:'Interpreting audited replay evidence'}});
   }
   if(!evidenceIds.length)return finishCycle(c,'Research ended without usable evidence',tasks.map(t=>({id:t?.id,status:t?.status,reason:t?.reason})),300);
   return saveCampaign(c,{phase:'synthesize',checkpoint:{...cp,evidenceIds,message:'Combining completed investigations'}});
  }
  if(c.phase==='synthesize'){
   const builder=await child(c,'candidate',`${c.objective}\nSynthesize the completed opponent and replay investigations into compatible policy components. Team wins come first; preserve counterexamples. ${cp.direction??''}`);
   return saveCampaign(c,{phase:'candidate',checkpoint:{...cp,builderId:builder.id,message:'Building an isolated candidate from shared evidence'}});
  }
  if(c.phase==='candidate'){
   const builder=await taskById(cp.builderId,c.student_id);
   if(!builder||['queued','running','waiting','paused'].includes(builder.status))return saveCampaign(c,{},30);
   if(builder.status!=='completed')return finishCycle(c,'Candidate construction did not complete',{taskId:builder.id,reason:builder.reason},300);
   let candidate;
   try{
    candidate=await verifiedCandidate(c.student_id,c.league_id,cp.baselines[0],builder.result);
    const compilation=await validatePolicySource(cp.release,candidate.source,{studentId:c.student_id,campaignId:c.id,taskId:builder.id});
    await artifact(c.student_id,c.league_id,'policy-compilation',`Candidate compiler ${compilation.valid?'passed':'rejected'}`,compilation,{campaignId:c.id,taskId:builder.id});
    if(!compilation.valid)throw new InvalidCandidate(`Pinned GoTA compiler rejected candidate: ${compilation.error}. Reuse compatible existing scratch variables; preserve the exact host/global limits.`);
   }
   catch(error){
    if(!(error instanceof InvalidCandidate))throw error;
    const attempt=(cp.candidateRepairs??0)+1;
    await artifact(c.student_id,c.league_id,'candidate-rejection',`Candidate validation · attempt ${attempt}`,{taskId:builder.id,proposal:builder.result,error:error.message},{campaignId:c.id,taskId:builder.id});
    if(attempt>2)return finishCycle(c,'Candidate could not pass source/evidence validation',{taskId:builder.id,error:error.message},60);
    const repair=await child(c,'candidate',`Repair the previous candidate without inventing evidence or changing the research objective. Validation error: ${error.message}. Read the rejected proposal supplied in context. Return exact non-overlapping baseline spans and accessible artifact UUIDs.`,{attempt:String(attempt)});
    return saveCampaign(c,{checkpoint:{...cp,builderId:repair.id,candidateRepairs:attempt,rejectedCandidate:builder.result,validationError:error.message,message:'Repairing candidate source/evidence validation'}});
   }
   const old=checked(await db().from('research_artifacts').select('id').eq('student_id',c.student_id).eq('league_id',c.league_id).eq('kind','candidate').eq('content->>sourceHash',candidate.sourceHash).limit(1));
   if(old?.length)return finishCycle(c,'Candidate repeats previously tested source',{candidateHash:candidate.sourceHash},300);
   const candidateId=await artifact(c.student_id,c.league_id,'candidate',candidate.summary,candidate,{campaignId:c.id,taskId:builder.id});
   return saveCampaign(c,{phase:'select-fixtures',checkpoint:{...cp,candidate,candidateId,message:'Selecting fresh matched league configurations'}});
  }
  if(c.phase==='select-fixtures'){
   // Research may have discovered an episode through CLI metadata. Resolve its seed
   // before reserving confirmation, so another episode with the same seed is excluded.
   const unresolved=checked(await db().from('research_exclusions').select('episode_id').eq('student_id',c.student_id).eq('league_id',c.league_id).is('seed_key',null).limit(32));
   if(unresolved?.length){
    await mapConcurrent(unresolved,8,async e=>{
     const seed=await observedSeed(c.student_id,c.league_id,token,e.episode_id);
     checked(await db().from('research_exclusions').update({seed_key:String(seed)}).eq('student_id',c.student_id).eq('league_id',c.league_id).eq('episode_id',e.episode_id));
    });
    return saveCampaign(c,{checkpoint:{...cp,message:'Excluding previously inspected replay seeds before selecting new fixtures'}},1);
   }
   const [metadata,exclusions]=await Promise.all([leagueFixtureMetadata(token,c.league_id),fixtureHistory(c.student_id,c.league_id)]);
   const ids=new Set([...exclusions.map(e=>e.episode_id),...(cp.fixtures??[]).map((f:Fixture)=>f.episodeId),...(cp.skippedFixtureIds??[])]);
   const total=c.protocol.screenPairs+c.protocol.confirmationPairs;
   if(c.protocol.fixtureMode==='fresh-seeds'){
    // Select lineups from metadata alone, independent of recorded outcomes.
    const rosters=new Set<string>();
    const choices=metadata.filter(e=>{const key=hashObject(e.policy_version_ids);if(rosters.has(key))return false;rosters.add(key);return true;}).slice(0,12);
    const inputs=await mapConcurrent(choices,4,async e=>{
     try{return await fixtureInputs(token,e,cp.release);}
     catch(error){if(/different game release|requires open draft/.test(String(error)))return null;throw error;}
    });
    const templates=inputs.filter((f):f is Omit<Fixture,'slot'>=>!!f).slice(0,4);
    if(!templates.length)return saveCampaign(c,{checkpoint:{...cp,message:'Waiting for a league lineup on the pinned release'}},300);
    const fixtures=freshSeedFixtures(c.id,c.cycle,templates,cp.baselines[0],exclusions.map(e=>e.seed_key).filter((seed):seed is string=>seed!==null),total);
    await artifact(c.student_id,c.league_id,'fixture-plan',`Cycle ${c.cycle+1}: fresh-seed evaluation`,{
     mode:'fresh-seeds',generator:'preston-fresh-seeds-v1',templateEpisodeIds:templates.map(t=>t.episodeId),
     screenPairs:c.protocol.screenPairs,confirmationPairs:c.protocol.confirmationPairs,fixtureHash:hashObject(fixtures),
     interpretation:'Fresh random seeds using recorded league lineups/settings; these are not replays of historical league episodes. Both arms share each seed, lineup, seat and pinned release.',
    },{campaignId:c.id,taskId:c.task_id});
    return saveCampaign(c,{phase:'freeze',checkpoint:{...cp,fixtures,selection:[],observationHead:metadata[0]?.id,
     message:`Prepared ${total} fresh-seed pairs using ${templates.length} recorded league lineups`}},1);
   }
   const eligible=metadata.filter(e=>!ids.has(e.id));
   const remaining=total-(cp.fixtures?.length??0);
   if(eligible.length<remaining)return saveCampaign(c,{checkpoint:{...cp,message:`Waiting for ${remaining} more fresh fixtures; ${eligible.length} currently available`}},300);
   // Stable metadata order, selected before reading outcomes. Reserve both cohorts now.
   const selection=eligible;
   return saveCampaign(c,{phase:'freeze',checkpoint:{...cp,selection,observationHead:metadata[0]?.id,fixtureCursor:0,fixtures:cp.fixtures??[],excludedSeeds:exclusions.map(e=>e.seed_key).filter((seed):seed is string=>seed!==null),message:`Freezing ${total} fixtures for screening and independent confirmation`}});
  }
  if(c.phase==='freeze'){
   if(!await auditWorkerReady(cp.release,{studentId:c.student_id,campaignId:c.id,taskId:c.task_id}))return saveCampaign(c,{checkpoint:{...cp,message:'Replay auditor is preparing its dedicated VM; evaluation will begin when it is ready.'}},120);
   const fixtures=(cp.fixtures??[]) as Fixture[],selection=cp.selection as {id:string;policy_version_ids:string[]}[];
   const total=c.protocol.screenPairs+c.protocol.confirmationPairs;
   if(fixtures.length<total){
    const cursor=cp.fixtureCursor??0;
    if(cursor>=selection.length)return saveCampaign(c,{phase:'select-fixtures',checkpoint:{...cp,selection:[],skippedFixtureIds:[...(cp.skippedFixtureIds??[]),...selection.map(e=>e.id)],message:`Keeping ${fixtures.length}/${total} valid fixtures; finding additional fresh seeds`}},1);
    const batch=selection.slice(cursor,cursor+16);
    const inputs=await mapConcurrent(batch,4,async e=>{
     try{return await fixtureInputs(token,e,cp.release);}
     catch(error){
      if(!/different game release|requires open draft/.test(String(error)))throw error;
      return null; // Incompatible metadata stays in the scanned set; keep the valid fixtures.
     }
    });
    const next=extendFixtures(fixtures,inputs,cp.baselines[0],cp.excludedSeeds,total);
    return saveCampaign(c,{checkpoint:{...cp,fixtures:next,fixtureCursor:cursor+batch.length,message:`Frozen ${next.length}/${total} matched configurations`}},1);
   }
   if(!cp.candidate.versionId){
    const uploaded=await uploadPolicy(token,c.student_id,cp.candidate.source,cp.candidate.summary,`preston-${c.id.slice(0,8)}-${c.cycle}`,cp.baselines[0].playerId);
    return saveCampaign(c,{checkpoint:{...cp,candidate:{...cp.candidate,versionId:uploaded.id},message:'Candidate uploaded for private evaluation'}});
   }
   const studies=(['screen','confirmation'] as const).map(cohort=>{
    const subset=cohort==='screen'?fixtures.slice(0,c.protocol.screenPairs):fixtures.slice(c.protocol.screenPairs);
    const protocol:StudyProtocol={release:cp.release,baseline:cp.baselines[0],candidate:cp.candidate,cohort,pairs:subset.length,gate:cohort==='screen'?'directional':c.protocol.gate,metric:'team-match-utility',selectedEpisodeIds:subset.map(f=>f.episodeId),selectionMode:c.protocol.fixtureMode??'league',templateEpisodeIds:[...new Set(subset.flatMap(f=>f.templateEpisodeId?[f.templateEpisodeId]:[]))]};
    return {cohort,protocol,hash:hashObject(protocol),fixtures:subset};
   });
   await rpc('freeze_campaign_studies',{p_campaign:c.id,p_token:c.lease_token,p_studies:studies});
   return saveCampaign(c,{phase:'screen',checkpoint:{...cp,fixtures:undefined,selection:undefined,message:'Screening the frozen candidate against the current champion'}});
  }
  if(c.phase==='screen'||c.phase==='confirmation'){
   const s=checked(await db().from('research_studies').select('*').eq('campaign_id',c.id).eq('cycle',c.cycle).eq('cohort',c.phase).single()) as Study;
   if(['running','auditing'].includes(s.state))return saveCampaign(c,{checkpoint:{...cp,message:s.state==='auditing'?'Auditing replay, VM and reward evidence':`Running ${s.cohort} matched comparison`}},30);
   if(s.state!=='completed'||!s.result?.passed){
    const pending=checked(await db().from('research_studies').select('id,task_id').eq('campaign_id',c.id).eq('cycle',c.cycle).eq('cohort','confirmation').eq('state','running'));
    for(const p of pending??[]){checked(await db().from('research_studies').update({state:'canceled'}).eq('id',p.id));checked(await db().from('agent_tasks').update({status:'canceled',reason:'Screen did not pass; reserved fixtures remain excluded'}).eq('id',p.task_id));}
    return finishCycle(c,s.state==='completed'?'Candidate did not pass the declared gate':'Study could not establish a valid comparison',{studyId:s.id,result:s.result},60);
   }
   if(c.phase==='screen'){
    checked(await db().from('research_studies').update({next_at:new Date().toISOString()}).eq('campaign_id',c.id).eq('cycle',c.cycle).eq('cohort','confirmation'));
    return saveCampaign(c,{phase:'confirmation',checkpoint:{...cp,message:'Screen passed; confirming unchanged source on reserved fresh fixtures'}});
   }
   return saveCampaign(c,{phase:'promote',checkpoint:{...cp,confirmedStudyId:s.id,message:'Confirmation passed; verifying deployment conditions'}});
  }
  if(c.phase==='promote'){
   const s=checked(await db().from('research_studies').select('*').eq('id',cp.confirmedStudyId).eq('student_id',c.student_id).single()) as Study;
   const result=await promoteStudy(c,s,token);
   if(result.status==='verifying')return saveCampaign(c,{checkpoint:{...cp,message:'Waiting for active champion readback'}},30);
   return finishCycle(c,result.status==='verified'?'Tested policy deployed and verified':'Candidate confirmed; automatic promotion is disabled',{studyId:s.id,result:s.result,deployment:result},c.protocol.observeMinutes*60);
  }
  if(c.phase==='observe'){
   if(!c.protocol.continuous)return saveCampaign(c,{state:'completed',checkpoint:{...cp,message:'Research cycle complete'}});
   const experimentalEvidence=c.protocol.fixtureMode==='fresh-seeds'&&!!cp.lastResult?.details?.studyId;
   if(!experimentalEvidence){
    const fresh=await leagueFixtureMetadata(token,c.league_id);
    if(cp.observationHead&&fresh[0]?.id===cp.observationHead)return saveCampaign(c,{checkpoint:{...cp,message:'Waiting for new league episodes before the next investigation'}},c.protocol.observeMinutes*60);
   }
   return saveCampaign(c,{phase:'baseline',cycle:c.cycle+1,checkpoint:{lastResult:cp.lastResult,direction:cp.direction,message:experimentalEvidence?'Starting the next investigation from completed experiment evidence':'Starting the next investigation from fresh league evidence'}});
  }
 }catch(error){
  const message=error instanceof Error?error.message:String(error);
  if(c.phase==='promote'&&/conflict|Incumbent changed|qualification rejected|Release changed/.test(message))return finishCycle(c,'Deployment stopped; live champion will be rechecked',{reason:message},c.protocol.observeMinutes*60);
  await recordEvent(c,`error:${c.cycle}:${c.phase}:${hashObject(message)}`,'work.retrying',{phase:c.phase,message});
  await saveCampaign(c,{checkpoint:{...c.checkpoint,message,errors:(c.checkpoint.errors??0)+1}},60);
 }
}

export async function dispatchCampaigns(){
 const now=new Date().toISOString();
 const [campaigns,studies]=await Promise.all([db().from('research_campaigns').select('id').in('state',['active','paused','canceled']).lte('next_at',now).order('next_at').limit(4),db().from('research_studies').select('id').in('state',['running','auditing']).lte('next_at',now).order('next_at').limit(4)]);
 if(campaigns.error?.code==='PGRST205'||campaigns.error?.code==='42P01')return;
 const work=[...checked(campaigns)!.map(c=>()=>processCampaign(c.id)),...checked(studies)!.map(s=>()=>processStudy(s.id))];
 const results=await Promise.allSettled(work.map(run=>run()));
 results.forEach(r=>{if(r.status==='rejected')console.error('Campaign dispatch failed',r.reason instanceof Error?r.reason.message:String(r.reason));});
}

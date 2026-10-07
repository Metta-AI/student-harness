import {artifact,campaignById,checked,readArtifact} from './store';
import {db} from '../db';
import {verifiedCandidate} from './candidate';
import {episodeArtifact} from './provider';
import {markObserved} from './evidence';
import {hashObject,sha,type Baseline,type Release} from './model';
import {readReplayAudit,requestReplayAudit,validatePolicySource} from './worker';

/** Require a full baseline VM receipt, not a prior candidate probe or a summary.
 * These episodes are training evidence; they never become fresh confirmation. */
export function probeReplayInput(row:any,baseline:Baseline,release:Release){
 const c=row?.content;
 const native=row?.kind==='episode-audit'&&c?.outcome?.audit==='verified'?c.outcome.evidence?.native:
  row?.kind==='replay-evidence'&&c?.audit?.status==='completed'?c.audit.result:null;
 const episodeId=c?.episodeId??c?.outcome?.episodeId;
 const slot=native?.vm?.subject;
 if(!native||native.kind||native.release!==release.fingerprint||native.vm?.source_hash!==baseline.sourceHash
  ||native.simulation?.hash_mismatches!==0||native.vm.validated_hashes!==native.simulation.ticks
  ||!Number.isInteger(native.simulation.ticks)||native.simulation.ticks<=0
  ||!Number.isInteger(slot)||slot<0||slot>9||!/^ereq_[a-zA-Z0-9-]+$/.test(episodeId)
  ||!/^[a-f0-9]{64}$/.test(native.replayHash))throw Error('Probe requires a completed replay and exact baseline VM audit on the current release');
 return {episodeId,slot,replayHash:native.replayHash,seed:c.result?.seed??c.results?.seed};
}

export async function probeCandidate(studentId:string,token:string,campaignId:string,taskId:string,proposal:unknown,evidenceId:string){
 const c=await campaignById(campaignId,studentId);
 if(!c||c.state!=='active'||c.phase!=='candidate'||c.checkpoint.builderId!==taskId)throw Error('Only the active candidate builder can run a diagnostic before fixtures are frozen');
 const baseline=c.checkpoint.baselines[0] as Baseline,release=c.checkpoint.release as Release;
 const row=await readArtifact(studentId,evidenceId);
 if(!row||row.league_id!==c.league_id)throw Error('Baseline evidence not found in this league');
 if(row.provenance?.studyId){
  const study=checked(await db().from('research_studies').select('state').eq('id',row.provenance.studyId).eq('student_id',studentId).maybeSingle());
  if(study?.state!=='completed')throw Error('Probe cannot inspect an unfinished or invalid study');
 }
 const input=probeReplayInput(row,baseline,release);
 const candidate=await verifiedCandidate(studentId,c.league_id,baseline,proposal);
 await markObserved(studentId,c.league_id,input.episodeId,'Candidate prefix diagnostic',input.seed);
 const scope={studentId,campaignId,taskId},mode='candidate-prefix-probe' as const;
 const jobId=hashObject({release:release.fingerprint,replay:input.replayHash,source:candidate.sourceHash,slot:input.slot,mode});
 let diagnostic=await readReplayAudit(release,jobId,input.episodeId,scope);
 if(!diagnostic){
  const compilation=await validatePolicySource(release,candidate.source,scope);
  if(!compilation.valid)return {status:'compile_rejected',compilation};
  const replay=await episodeArtifact(token,input.episodeId,'replay') as Uint8Array;
  if(sha(replay)!==input.replayHash)throw Error('Recorded baseline replay identity changed');
  diagnostic=await requestReplayAudit({episodeId:input.episodeId,release,replay,source:candidate.source,slot:input.slot,scope,mode});
 }
 if(diagnostic.status==='completed'){
  const r=diagnostic.result;
  if(r?.kind!==mode||r.sourceHash!==candidate.sourceHash||r.release!==release.fingerprint||r.replayHash!==input.replayHash||r.probe?.subject!==input.slot)throw Error('Candidate diagnostic receipt identity mismatch');
 }
 const content={baselineEvidenceId:evidenceId,baselineVersionId:baseline.versionId,episodeId:input.episodeId,slot:input.slot,baselineHash:baseline.sourceHash,candidateHash:candidate.sourceHash,release,diagnostic,
  sourceAvailable:true,proposalSummary:candidate.summary,componentIds:candidate.components.map(component=>component.id),
  note:'Stops at the first world-state divergence from recorded play. This identifies a changed trajectory, not a win-rate effect or the exact changed BASIC branch. No divergence means no observed world-state change in this replay; internal decisions may still differ. Read this artifact with view=full for the exact probed source and component edits, including diagnostic instrumentation.'};
 const artifactId=await artifact(studentId,c.league_id,'candidate-probe',`Candidate diagnostic · ${input.episodeId}`,
  {...content,source:candidate.source,proposal:{summary:candidate.summary,components:candidate.components}},
  {campaignId,taskId,provenance:{baselineEvidenceId:evidenceId}});
 return {artifactId,...content};
}

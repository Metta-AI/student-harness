import {z} from 'zod';
import {db} from '../db';
import {checked} from './store';
import {hashObject,sha,type Campaign,type Study,type Baseline} from './model';

const digest=z.string().regex(/^[a-f0-9]{64}$/);
export const submissionReviewSchema=z.object({
 campaignId:z.uuid(),studyId:z.uuid(),leagueId:z.string(),candidateHash:digest,
 protocolHash:z.string(),releaseFingerprint:z.string(),generation:z.number().int().nonnegative(),
 players:z.array(z.object({playerId:z.string(),incumbentId:z.string()})).min(1).max(10),
 summary:z.string(),scopeHash:digest,
}).strict();
export type SubmissionReview=z.infer<typeof submissionReviewSchema>;

export function submissionReview(c:Campaign,s:Study,generation:number):SubmissionReview {
 if(s.student_id!==c.student_id||s.campaign_id!==c.id||s.cycle!==c.cycle||c.checkpoint.confirmedStudyId!==s.id)
  throw Error('Study does not match the current campaign');
 if(s.cohort!=='confirmation'||s.state!=='completed'||!s.result?.passed)throw Error('Independent confirmation gate has not passed');
 if(sha(s.protocol.candidate.source)!==s.protocol.candidate.sourceHash)throw Error('Tested candidate hash mismatch');
 const players=(c.checkpoint.baselines as Baseline[]).map(b=>({playerId:b.playerId,incumbentId:b.versionId})).sort((a,b)=>a.playerId.localeCompare(b.playerId));
 if(!players.length||new Set(players.map(p=>p.playerId)).size!==players.length)throw Error('Invalid deployment players');
 const review={campaignId:c.id,studyId:s.id,leagueId:c.league_id,candidateHash:s.protocol.candidate.sourceHash,
  protocolHash:s.protocol_hash,releaseFingerprint:s.protocol.release.fingerprint,generation,players,summary:s.protocol.candidate.summary};
 return submissionReviewSchema.parse({...review,scopeHash:hashObject({...review,protocol:s.protocol,result:s.result})});
}

async function generation(c:Campaign){
 const task=checked(await db().from('agent_tasks').select('generation').eq('id',c.task_id).eq('student_id',c.student_id).single());
 if(!task)throw Error('Campaign task unavailable');
 return task.generation as number;
}

export async function inspectSubmission(studentId:string,campaignId:string,studyId:string){
 const c=checked(await db().from('research_campaigns').select('*').eq('id',campaignId).eq('student_id',studentId).maybeSingle()) as Campaign|null;
 const s=checked(await db().from('research_studies').select('*').eq('id',studyId).eq('student_id',studentId).maybeSingle()) as Study|null;
 if(!c||!s)throw Error('Campaign study unavailable');
 if(c.state!=='active'||!['promote','awaiting_submission'].includes(c.phase)||!c.protocol.promote)throw Error('Campaign is not awaiting submission');
 return submissionReview(c,s,await generation(c));
}

/** Called only by the owner-approved Eve tool, never by a research worker. */
export async function approveSubmission(studentId:string,review:SubmissionReview,requestKey:string){
 const current=await inspectSubmission(studentId,review.campaignId,review.studyId);
 if(hashObject(current)!==hashObject(review))throw Error('Submission changed; inspect and review the current candidate again');
 const existing=checked(await db().from('research_submission_approvals').select('*').eq('student_id',studentId).eq('request_key',requestKey).maybeSingle());
 if(existing){if(existing.scope_hash!==review.scopeHash)throw Error('Approval request already belongs to another candidate');return existing;}
 const result=await db().from('research_submission_approvals').insert({student_id:studentId,campaign_id:review.campaignId,study_id:review.studyId,
  request_key:requestKey,scope_hash:review.scopeHash,task_generation:review.generation,review}).select('*').single();
 if(result.error?.code==='23505'){
  const saved=checked(await db().from('research_submission_approvals').select('*').eq('student_id',studentId).eq('request_key',requestKey).single());
  if(saved?.scope_hash!==review.scopeHash)throw Error('Approval request conflict');return saved;
 }
 return checked(result);
}

export async function submissionApproval(c:Campaign,s:Study){
 const review=submissionReview(c,s,await generation(c));
 const rows=checked(await db().from('research_submission_approvals').select('id').eq('student_id',c.student_id)
  .eq('campaign_id',c.id).eq('study_id',s.id).eq('scope_hash',review.scopeHash).eq('task_generation',review.generation)
  .gt('expires_at',new Date().toISOString()).order('created_at',{ascending:false}).limit(1));
 return rows?.length?review:null;
}

export async function admitSubmission(c:Campaign,s:Study,playerId:string,review:SubmissionReview){
 return checked(await db().rpc('campaign_submission_admit',{p_student:c.student_id,p_campaign:c.id,p_study:s.id,
  p_player:playerId,p_scope:review.scopeHash,p_lease:c.lease_token}))===true;
}

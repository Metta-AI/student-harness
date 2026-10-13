import {db,latestPolicyVersion,policyVersionBySoftmaxId,toRevision,markPolicyUploaded,insertExperiment} from '../db';
import {importPolicy,reconcileSource,numberCandidate} from '../semantic-ir';
import {policyExplanation} from '../policy-explorer-store';
import {generateCandidate} from './generate';
import {editRequestSchema,type SemanticEditRequest,type EditorCandidate} from '../workspace/semantic-editor';
import {requestEpisode,uploadPolicy,getExperience} from '../softmax';
import {requireStandaloneResearch} from '../research/store';
import {sourceDigest} from '../policy-source-model';
type Student={subjectId:string;token:string};
const table='semantic_editor_candidates';
const terminal=new Set(['completed','failed','cancelled','canceled','error']);
function checked<T>(r:{data:T;error:{message:string}|null}):T{if(r.error)throw Error(r.error.message);return r.data;}
export async function readCandidate(studentId:string,id:string):Promise<EditorCandidate>{const row=checked(await db().from(table).select('*').eq('student_id',studentId).eq('id',id).single());if(!row)throw Error('Candidate not found');return row;}
export async function listCandidates(studentId:string,policyId:string):Promise<EditorCandidate[]>{return checked(await db().from(table).select('*').eq('student_id',studentId).eq('policy_id',policyId).order('created_at',{ascending:false}).limit(12))??[];}
async function patch(studentId:string,id:string,values:Record<string,unknown>){checked(await db().from(table).update({...values,updated_at:new Date().toISOString()}).eq('student_id',studentId).eq('id',id));}
export async function createCandidate(student:Student,input:SemanticEditRequest){
 editRequestSchema.parse(input);
 const inserted=await db().from(table).insert({id:input.id,student_id:student.subjectId,policy_id:input.policyId,input}).select('*').single();
 if(inserted.error?.code==='23505'){const existing=await readCandidate(student.subjectId,input.id);if(Object.keys(input).some(key=>existing.input[key as keyof SemanticEditRequest]!==input[key as keyof SemanticEditRequest]))throw Error('Generation key already belongs to another edit');return existing;}
 checked(inserted);
 try{const base=await policyExplanation(student,input.policyId);if(base.hash!==input.sourceHash)throw Error('Policy source changed. Reload before generating.');
  if(!base.sections.some(s=>s.id===input.sectionId))throw Error('Rule no longer exists. Reload the policy.');
  const candidate=await generateCandidate(student.subjectId,base,input);await patch(student.subjectId,input.id,{candidate,state:'ready'});
 }catch(error){await patch(student.subjectId,input.id,{state:'generation_failed',error:error instanceof Error?error.message:'Generation failed'});}
 return readCandidate(student.subjectId,input.id);
}
export async function testCandidate(student:Student,id:string){
 const old=await readCandidate(student.subjectId,id);if(old.state!=='ready')return old;
 await requireStandaloneResearch(student.subjectId);
 const allowance=await db().rpc('research_daily_reserve',{p_student:student.subjectId,p_key:`semantic-editor-test:${id}`,p_hold:1});
 if(allowance.error||!allowance.data)throw Error('Hosted test could not reserve the configured daily allowance.');
 const claim=checked(await db().from(table).update({state:'preparing',updated_at:new Date().toISOString()}).eq('id',id).eq('student_id',student.subjectId).eq('state','ready').select('id').maybeSingle());
 if(!claim)return readCandidate(student.subjectId,id);
 try{
  const c=old.candidate;if(!c||sourceDigest(c.source)!==c.sourceHash)throw Error('Candidate source integrity check failed.');
  const local=await policyVersionBySoftmaxId(student.subjectId,old.policy_id);
  const parent=local&&local.source===c.base.source?toRevision(local):importPolicy(c.base.source,false);
  const raw=reconcileSource(parent,c.source,c.summary,c.semantic,[`semantic-editor:${id}`]);
  let versionId='';
  for(let attempt=0;attempt<3;attempt++){
   const latest=await latestPolicyVersion(student.subjectId);const revision=numberCandidate(raw,Math.max(raw.ir.update.revision,(latest?.revision_number??0)+1));
   const saved=await db().rpc('semantic_editor_save_version',{p_student:student.subjectId,p_id:id,p_revision:revision});
   if(saved.error?.code==='40001')continue;versionId=checked(saved) as string;break;
  }
  if(!versionId)throw Error('Another edit changed the revision sequence. Generate again from the saved candidate.');
  const uploaded=await uploadPolicy(student.token,student.subjectId,c.source,c.summary,`semantic-${id.slice(0,8)}`);
  await markPolicyUploaded(versionId,{policyVersionId:uploaded.id,label:`${uploaded.name}:v${uploaded.version}`});
  await patch(student.subjectId,id,{policy_version_id:uploaded.id,state:'requesting',deadline_at:new Date(Date.now()+30*60000).toISOString()});
  // Persist this key/state before submitting. Uncertain requests are never automatically resubmitted.
  const xp=await requestEpisode(student.token,uploaded.id,c.summary,`semantic-editor:${id}`);
  await patch(student.subjectId,id,{xp_id:xp.id,state:xp.status,checked_at:new Date().toISOString()});
  await insertExperiment({studentId:student.subjectId,policyVersionRowId:versionId,xpRequestId:xp.id,title:c.summary.slice(0,50),hypothesis:c.semantic.hypothesis,status:xp.status});
 }catch(error){await patch(student.subjectId,id,{state:'attention',error:`${error instanceof Error?error.message:'Test request failed'}. This candidate will not be submitted again automatically.`});}
 return readCandidate(student.subjectId,id);
}
export async function checkCandidate(student:Student,id:string){
 const row=await readCandidate(student.subjectId,id);
 if(!row.xp_id||terminal.has(row.state)&&row.result)return row;
 // Claim the read across tabs and replicas; upstream status checks are at least a minute apart.
 const cutoff=new Date(Date.now()-60000).toISOString();
 const claim=checked(await db().from(table).update({checked_at:new Date().toISOString()}).eq('student_id',student.subjectId).eq('id',id).lt('checked_at',cutoff).gt('deadline_at',new Date().toISOString()).select('id').maybeSingle());
 if(!claim)return row;
 try{const xp=await getExperience(student.token,row.xp_id);if(xp.requester_user_id!==student.subjectId)throw Error('XP owner mismatch');
  await patch(student.subjectId,id,{result:xp,state:xp.status,error:null});
  checked(await db().from('experiments').update({status:xp.status,completed_at:xp.completed_at}).eq('student_id',student.subjectId).eq('xp_request_id',row.xp_id));
 }catch{await patch(student.subjectId,id,{checked_at:new Date(Date.now()+60000).toISOString(),error:'Could not refresh hosted results. The saved XP request has not been resubmitted.'});}
 return readCandidate(student.subjectId,id);
}

import {db,studentToken} from '../db';
import {rpc} from '../tasks/store';

const terminal=new Set(['completed','failed','error','canceled','cancelled']);
type RecordValue=Record<string,any>;
export type CollectionAttempt={id:string;xp_id:string|null;episode_id:string|null;receipt:RecordValue|null};
type Observation={status:'pending'|'waiting_receipt'|'collected';terminal?:string;receipt?:RecordValue};
function checkedStatus(value:unknown,id:string):RecordValue{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid hosted status');
 const row=value as RecordValue;
 if(row.id!==id||typeof row.status!=='string')throw Error('Hosted receipt identity mismatch');
 return row;
}
/** Inspect only saved identities. This function has no submission, audit or model capability. */
export async function collectCanceledAttempt(attempt:CollectionAttempt,read:(path:string)=>Promise<unknown>):Promise<Observation>{
 let xp:RecordValue|undefined,episode:RecordValue|undefined;
 const cached=attempt.receipt?.episode;
 if(cached?.id===attempt.episode_id&&terminal.has(cached.status)){
  return {status:'collected',terminal:cached.status,receipt:{source:'hosted-status',audited:false,cached:true,episode:cached}};
 }
 if(!attempt.xp_id&&!attempt.episode_id)return {status:'waiting_receipt'};
 let episodeId=attempt.episode_id;
 if(!episodeId){
  if(!/^xreq_[a-zA-Z0-9-]+$/.test(attempt.xp_id!))throw Error('Invalid saved request ID');
  xp=checkedStatus(await read(`/v2/experience-requests/${encodeURIComponent(attempt.xp_id!)}`),attempt.xp_id!);
  if(!Array.isArray(xp.episodes)||xp.episodes.length>1)throw Error('Expected the saved single-game request');
  if(!xp.episodes.length){
   return terminal.has(xp.status)?{status:'collected',terminal:xp.status,receipt:{source:'hosted-status',audited:false,request:xp,episodeUnavailable:true}}:{status:'pending'};
  }
  episodeId=xp.episodes[0].episode_request_id??xp.episodes[0].id;
 }
 if(typeof episodeId!=='string'||!/^ereq_[a-zA-Z0-9-]+$/.test(episodeId))throw Error('Invalid saved episode ID');
 episode=checkedStatus(await read(`/v2/episode-requests/${encodeURIComponent(episodeId)}`),episodeId);
 const receipt={source:'hosted-status',audited:false,...(xp?{request:xp}:{}),episode};
 return terminal.has(episode.status)?{status:'collected',terminal:episode.status,receipt}:{status:'pending',receipt};
}

// Fixed origin, GET only, no redirects, bounded timeout/body. There is no generic
// provider POST fallback when a submission response is missing.
export async function readCollectionStatus(token:string,path:string,signal:AbortSignal):Promise<unknown>{
 if(!/^\/v2\/(experience-requests\/xreq_|episode-requests\/ereq_)[a-zA-Z0-9-]+$/.test(path))throw Error('Invalid result lookup');
 const response=await fetch(`https://softmax.com/api/observatory${path}`,{method:'GET',redirect:'error',headers:{Authorization:`Bearer ${token}`,'User-Agent':'softmax-student-harness/result-collection'},signal,cache:'no-store'});
 if(!response.ok)throw Error(`Hosted result lookup failed (${response.status})`);
 const reader=response.body?.getReader();if(!reader)throw Error('Hosted result body unavailable');
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>450000)throw Error('Hosted status exceeds collection limit');chunks.push(value);}}
 finally{await reader.cancel();reader.releaseLock();}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

type Claim={attempt_id:string;student_id:string;study_id:string;lease_token:string};
/** Bounded, read-only evidence collection continues through research holds. */
export async function dispatchCanceledStudyResults(){
 const claims=await rpc<Claim[]>('campaign_claim_result_collections');
 const deadline=Date.now()+45000;let lastRead=0,failed=0;
 for(const claim of claims){
  let result:Observation={status:'pending'},error:string|null=null;
  try{
   if(Date.now()>=deadline)throw Error('Collection pass deadline');
   const {data:attempt,error:lookupError}=await db().from('research_attempts').select('id,study_id,xp_id,episode_id,receipt').eq('id',claim.attempt_id).eq('study_id',claim.study_id).abortSignal(AbortSignal.timeout(5000)).single();
   if(lookupError||!attempt)throw Error('Saved request unavailable');
   let token:string|undefined;
   result=await collectCanceledAttempt(attempt,async path=>{
    token??=await studentToken(claim.student_id);
    const wait=Math.max(0,lastRead+2010-Date.now());if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
    if(Date.now()+5000>deadline)throw Error('Collection pass deadline');
    if(!await rpc<boolean>('campaign_collection_read_allowed',{p_attempt:claim.attempt_id,p_token:claim.lease_token}))throw Error('Collection read lease unavailable');
    try{return await readCollectionStatus(token,path,AbortSignal.timeout(5000));}finally{lastRead=Date.now();}
   });
  }catch{error='Saved result could not be observed. Collection will retry within its deadline.';failed++;}
  // Failure never becomes a fabricated terminal game or an authorization to retry it.
  await rpc('campaign_finish_result_collection',{p_attempt:claim.attempt_id,p_token:claim.lease_token,p_status:result.status,p_terminal:result.terminal??null,p_receipt:result.receipt??null,p_error:error});
 }
 if(failed)throw Error(`${failed} canceled-study observations remain pending`);
}

import {db} from './db';
import {artifact} from './campaigns/store';
import {defaultLeagueId} from './league-catalog';
import {sourceDigest} from './policy-source-model';
export async function savedUploadedSource(studentId:string,policyId:string){
 const {data,error}=await db().from('research_artifacts').select('content').eq('student_id',studentId).eq('league_id',defaultLeagueId).eq('kind','uploaded-policy-source').eq('content->>policyId',policyId).limit(1).maybeSingle();
 if(error)throw Error('Saved uploaded source could not load.');
 const c=data?.content;return typeof c?.source==='string'&&sourceDigest(c.source)===c.sourceHash?c.source as string:null;
}
/** Call only after upload completion or matching the hosted source hash, never from an unverified browser claim. */
export async function saveUploadedSource(studentId:string,policyId:string,source:string){
 await artifact(studentId,defaultLeagueId,'uploaded-policy-source','Exact uploaded policy source',{policyId,sourceHash:sourceDigest(source),source});
}

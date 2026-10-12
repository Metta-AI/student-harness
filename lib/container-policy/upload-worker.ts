import {setTimeout as delay} from 'node:timers/promises';
import {z} from 'zod';
import {db} from '../db';
import {advanceContainerUpload} from './upload';
import {containerArtifactStorageConfiguration} from './storage-config';

const PAGE_SIZE=16,CONCURRENCY=2;
const states=new Set(['queued','uploading','image_ready','registering','uncertain']);
export type ContainerUploadCandidate={id:string;student_id:string;state:string;next_at:string;lease_until:string|null;deadline_at:string;version_receipt:{policyVersionId?:string}|null};
/** Discover one due page only. Unknown registration outcomes remain visible in the
 * journal but have no automatic readback target and cannot consume this queue. */
export async function dueContainerUploads(now:string,signal:AbortSignal):Promise<ContainerUploadCandidate[]>{
 const lease=`or(lease_until.is.null,lease_until.lte.${now})`;
 const result=await db().from('container_policy_uploads').select('id,student_id,state,next_at,lease_until,deadline_at,version_receipt')
  .lte('next_at',now).or(`and(state.in.(queued,uploading,image_ready,registering),${lease}),and(state.eq.uncertain,version_receipt->>policyVersionId.not.is.null,deadline_at.gt.${now},${lease})`)
  .order('next_at').order('id').limit(PAGE_SIZE).abortSignal(AbortSignal.any([signal,AbortSignal.timeout(10000)]));
 if(result.error)throw Error('Container upload discovery unavailable');
 return result.data as ContainerUploadCandidate[];
}
export type ContainerUploadWorkerReport={event:'container_upload_pass';examined:number;uploads:number;errors:number};
export type ContainerUploadWorkerPorts={
 candidates:typeof dueContainerUploads;
 advance:(studentId:string,id:string,signal:AbortSignal)=>Promise<{state:string}>;
 now:()=>number;
 wait:(ms:number,signal:AbortSignal)=>Promise<void>;
 report:(value:ContainerUploadWorkerReport)=>void;
};
const defaults:ContainerUploadWorkerPorts={candidates:dueContainerUploads,advance:advanceContainerUpload,now:Date.now,wait:async(ms,signal)=>{await delay(ms,undefined,{signal});},report:value=>console.log(JSON.stringify(value))};

export async function runContainerUploadPass(signal:AbortSignal,ports:ContainerUploadWorkerPorts=defaults):Promise<ContainerUploadWorkerReport>{
 const summary:ContainerUploadWorkerReport={event:'container_upload_pass',examined:0,uploads:0,errors:0};
 signal.throwIfAborted();const now=ports.now();
 const rows=(await ports.candidates(new Date(now).toISOString(),signal)).slice(0,PAGE_SIZE);summary.examined=rows.length;
 const seen=new Set<string>();
 const eligible=rows.filter(row=>{
  if(!row||!z.uuid().safeParse(row.id).success||typeof row.student_id!=='string'||!row.student_id||row.student_id.length>512||!states.has(row.state)||seen.has(row.id))return false;
  if(!Number.isFinite(Date.parse(row.next_at))||Date.parse(row.next_at)>now||!Number.isFinite(Date.parse(row.deadline_at)))return false;
  if(row.lease_until!==null&&(!Number.isFinite(Date.parse(row.lease_until))||Date.parse(row.lease_until)>now))return false;
  if(row.state==='uncertain'&&(!z.uuid().safeParse(row.version_receipt?.policyVersionId).success||Date.parse(row.deadline_at)<=now))return false;
  seen.add(row.id);return true;
 }).sort((a,b)=>Date.parse(a.next_at)-Date.parse(b.next_at)||a.id.localeCompare(b.id));
 let cursor=0;
 await Promise.all(Array.from({length:Math.min(CONCURRENCY,eligible.length)},async()=>{
  while(cursor<eligible.length&&!signal.aborted){
   const row=eligible[cursor++];summary.uploads++;
   try{const result=await ports.advance(row.student_id,row.id,signal);if(result.state==='waiting')summary.errors++;}
   catch{if(!signal.aborted)summary.errors++;}
  }
 }));
 return summary;
}
/** Explicit scheduler only; importing this file does not discover or mutate rows.
 * SQL claims own exclusion/cadence across replicas. Each completed pass waits at
 * least a minute; failures back off to fifteen minutes. Shutdown drains effects. */
export async function runContainerUploadWorker({signal,deadlineAt,ports=defaults}:{signal:AbortSignal;deadlineAt:number;ports?:ContainerUploadWorkerPorts}){
 if(!Number.isFinite(deadlineAt)||deadlineAt<=ports.now())throw Error('Container upload worker deadline must be in the future');
 const lifetime=AbortSignal.any([signal,AbortSignal.timeout(Math.min(2_147_483_647,Math.ceil(deadlineAt-ports.now())))]);let failures=0;
 while(!lifetime.aborted&&ports.now()<deadlineAt){
  let report:ContainerUploadWorkerReport;
  try{report=await runContainerUploadPass(lifetime,ports);}
  catch{report={event:'container_upload_pass',examined:0,uploads:0,errors:lifetime.aborted?0:1};}
  ports.report(report);failures=report.errors?failures+1:0;
  if(lifetime.aborted||ports.now()>=deadlineAt)break;
  const rest=Math.min(900000,60000*2**Math.min(failures?failures-1:0,4));
  // Reaching the deadline ends the worker; a short final wait never starts a pass.
  try{await ports.wait(Math.min(rest,deadlineAt-ports.now()),lifetime);}catch{if(!lifetime.aborted)throw Error('Container upload worker wait failed');}
 }
}
/** Validate explicit deployment settings without reading secrets from another app
 * or touching Storage. The private bucket is checked again during restoration. */
export function validateContainerUploadWorkerEnvironment(env:NodeJS.ProcessEnv){
 containerArtifactStorageConfiguration(env);
}

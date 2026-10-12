import {setTimeout as delay} from 'node:timers/promises';
import {z} from 'zod';
import {db} from '../db';
import {advanceContainerPractice} from './practice';

const PAGE_SIZE=16,CONCURRENCY=2;
const candidateSchema=z.object({id:z.uuid(),student_id:z.string().min(1).max(512),state:z.enum(['queued','submitting','running','uncertain','completed','failed','canceled','expired']),next_at:z.string().nullable(),lease_until:z.string().nullable(),reconcile_until:z.string(),xp_request_id:z.string().nullable(),result:z.object({terminal:z.boolean()}).passthrough().nullable()});
export type ContainerPracticeCandidate=z.infer<typeof candidateSchema>;
/** Only due saved operations, never historical XP lists. SQL claims also enforce
 * cadence across workers. Terminal receipts are cached; stopped known requests
 * remain eligible for bounded remote cleanup. */
export async function dueContainerPractices(now:string,signal:AbortSignal):Promise<ContainerPracticeCandidate[]>{
 const result=await db().from('container_policy_practices').select('id,student_id,state,next_at,lease_until,reconcile_until,xp_request_id,result')
  .lte('next_at',now).or(`lease_until.is.null,lease_until.lte.${now}`)
  .or('result.is.null,result->>terminal.eq.false').not('state','in','(completed,failed)')
  .order('next_at').order('id').limit(PAGE_SIZE).abortSignal(AbortSignal.any([signal,AbortSignal.timeout(10000)]));
 if(result.error)throw Error('Container practice discovery unavailable');
 return result.data as ContainerPracticeCandidate[];
}
export type ContainerPracticeWorkerReport={event:'container_practice_pass';examined:number;practices:number;errors:number};
export type ContainerPracticeWorkerPorts={candidates:typeof dueContainerPractices;advance:(student:string,id:string,signal:AbortSignal)=>Promise<{state:string}>;now:()=>number;wait:(ms:number,signal:AbortSignal)=>Promise<void>;report:(value:ContainerPracticeWorkerReport)=>void};
const defaults:ContainerPracticeWorkerPorts={candidates:dueContainerPractices,advance:advanceContainerPractice,now:Date.now,wait:async(ms,signal)=>{await delay(ms,undefined,{signal});},report:value=>console.log(JSON.stringify(value))};
export async function runContainerPracticePass(signal:AbortSignal,ports:ContainerPracticeWorkerPorts=defaults){
 signal.throwIfAborted();const now=ports.now(),report:ContainerPracticeWorkerReport={event:'container_practice_pass',examined:0,practices:0,errors:0};
 const candidates=(await ports.candidates(new Date(now).toISOString(),signal)).slice(0,PAGE_SIZE);report.examined=candidates.length;
 const seen=new Set<string>(),rows=candidates.flatMap(value=>{
  const parsed=candidateSchema.safeParse(value);if(!parsed.success)return [];
  const row=parsed.data;
  if(seen.has(row.id)||row.result?.terminal||['completed','failed'].includes(row.state)||!row.next_at||!Number.isFinite(Date.parse(row.next_at))||Date.parse(row.next_at)>now||!Number.isFinite(Date.parse(row.reconcile_until)))return [];
  if(row.lease_until!==null&&(!Number.isFinite(Date.parse(row.lease_until))||Date.parse(row.lease_until)>now))return [];
  // Expired due rows still receive one SQL claim to close their local journal.
  // The controller/SQL forbid a new remote request after the original grant ends.
  seen.add(row.id);return [row];
 });let cursor=0;
 await Promise.all(Array.from({length:Math.min(CONCURRENCY,rows.length)},async()=>{
  while(cursor<rows.length&&!signal.aborted){const row=rows[cursor++];report.practices++;try{const result=await ports.advance(row.student_id,row.id,signal);if(['waiting','uncertain'].includes(result.state))report.errors++;}catch{if(!signal.aborted)report.errors++;}}
 }));return report;
}
export async function runContainerPracticeWorker({signal,deadlineAt,ports=defaults}:{signal:AbortSignal;deadlineAt:number;ports?:ContainerPracticeWorkerPorts}){
 if(!Number.isFinite(deadlineAt)||deadlineAt<=ports.now())throw Error('Container practice worker deadline must be in the future');
 const lifetime=AbortSignal.any([signal,AbortSignal.timeout(Math.min(2147483647,Math.ceil(deadlineAt-ports.now())))]);let failures=0;
 while(!lifetime.aborted&&ports.now()<deadlineAt){
  let report:ContainerPracticeWorkerReport;
  try{report=await runContainerPracticePass(lifetime,ports);}catch{report={event:'container_practice_pass',examined:0,practices:0,errors:lifetime.aborted?0:1};}
  ports.report(report);failures=report.errors?failures+1:0;
  if(lifetime.aborted||ports.now()>=deadlineAt)break;
  const rest=Math.min(900000,60000*2**Math.min(Math.max(0,failures-1),4));
  try{await ports.wait(Math.min(rest,deadlineAt-ports.now()),lifetime);}catch{if(!lifetime.aborted)throw Error('Container practice worker wait failed');}
 }
}

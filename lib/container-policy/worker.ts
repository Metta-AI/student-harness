import {setTimeout as delay} from 'node:timers/promises';
import {db} from '../db';
import {createContainerBuildDispatcher,containerDispatchCandidates,type ContainerDispatchScope,type ContainerDispatchResult} from './dispatch';
import {reconcileHostedBuild} from './controller';
import {PolicyArtifactStorage} from '../../workers/policy-build/storage.mjs';
import {createContainerArtifactStorage} from './storage-config';

const PAGE_SIZE=16,MAX_SCOPES=8;
const active=['queued','provisioning','building','retaining','stopping'];
export async function dueContainerScopes(now:string,signal:AbortSignal):Promise<ContainerDispatchScope[]>{
 const result=await db().from('container_policy_builds').select('student_id,container_policy_revisions!inner(league_id)')
  .in('state',active).is('cleanup_confirmed_at',null).lte('next_at',now)
  .or(`job_until.is.null,job_until.lte.${now}`).order('next_at').order('id').limit(PAGE_SIZE)
  .abortSignal(AbortSignal.any([signal,AbortSignal.timeout(10000)]));
 if(result.error)throw Error('Build scope discovery unavailable');
 const scopes:ContainerDispatchScope[]=[],seen=new Set<string>();
 for(const row of result.data.slice(0,PAGE_SIZE)){
  const leagueId=(row.container_policy_revisions as unknown as {league_id?:string})?.league_id,studentId=row.student_id;
  if(typeof studentId!=='string'||!studentId||studentId.length>512||typeof leagueId!=='string'||!/^league_[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(leagueId))continue;
  const key=JSON.stringify([studentId,leagueId]);if(seen.has(key))continue;seen.add(key);scopes.push({studentId,leagueId});if(scopes.length===MAX_SCOPES)break;
 }return scopes;
}
export function containerStorageFromEnvironment(env:NodeJS.ProcessEnv,signal:AbortSignal){
 return createContainerArtifactStorage(env,signal);
}
export type ContainerWorkerReport={event:'container_build_pass';scopes:number;builds:number;errors:number};
export type ContainerWorkerPorts={
 scopes:typeof dueContainerScopes;
 dispatch:(scope:ContainerDispatchScope,storage:PolicyArtifactStorage,signal:AbortSignal)=>Promise<ContainerDispatchResult>;
 wait:(ms:number,signal:AbortSignal)=>Promise<void>;
 now:()=>number;
 report:(value:ContainerWorkerReport)=>void;
};
const defaults:ContainerWorkerPorts={scopes:dueContainerScopes,now:Date.now,wait:async(ms,signal)=>{await delay(ms,undefined,{signal});},report:value=>console.log(JSON.stringify(value)),
 dispatch:async(scope,storage,signal)=>{
  // Shutdown stops admission of the remaining rows in an active scope. Await the
  // already-started controller: a timer race is not proof cloud work has stopped.
  const dispatch=createContainerBuildDispatcher({now:Date.now,candidates:async(...args)=>{signal.throwIfAborted();return containerDispatchCandidates(...args);},reconcile:async(...args)=>{signal.throwIfAborted();return reconcileHostedBuild(...args);}});
  return dispatch(scope,storage,signal);
 },
};
/** Explicit long-lived entrypoint. Each completed pass rests at least a minute.
 * SIGTERM/deadline stops new work and drains in-flight bounded controller jobs.
 * SQL retains the cross-worker locks, budgets and per-build retry state. */
export async function runContainerBuildWorker({storage,signal,deadlineAt,ports=defaults}:{storage:PolicyArtifactStorage;signal:AbortSignal;deadlineAt:number;ports?:ContainerWorkerPorts}){
 if(!Number.isFinite(deadlineAt)||deadlineAt<=ports.now())throw Error('Hosted build worker deadline must be in the future');
 const lifetime=AbortSignal.any([signal,AbortSignal.timeout(Math.min(2_147_483_647,Math.ceil(deadlineAt-ports.now())))]);let failures=0;
 while(!lifetime.aborted&&ports.now()<deadlineAt){
  const summary:ContainerWorkerReport={event:'container_build_pass',scopes:0,builds:0,errors:0};
  try{
   const candidates=(await ports.scopes(new Date(ports.now()).toISOString(),lifetime)).slice(0,MAX_SCOPES),seen=new Set<string>();
   const scopes=candidates.filter(scope=>{const key=JSON.stringify([scope.studentId,scope.leagueId]);if(seen.has(key))return false;seen.add(key);return true;});let cursor=0;
   await Promise.all(Array.from({length:Math.min(2,scopes.length)},async()=>{
    while(cursor<scopes.length&&!lifetime.aborted&&ports.now()<deadlineAt){
     const scope=scopes[cursor++];summary.scopes++;
     try{const result=await ports.dispatch(scope,storage,lifetime);summary.builds+=result.results.length;summary.errors+=result.results.filter(r=>r.state==='error').length;}
     catch{summary.errors++;}
    }
   }));
  }catch{if(!lifetime.aborted)summary.errors++;}
  ports.report(summary);failures=summary.errors?failures+1:0;
  if(lifetime.aborted||ports.now()>=deadlineAt)break;
  const rest=Math.min(900000,60000*2**Math.min(failures?failures-1:0,4));
  try{await ports.wait(Math.min(rest,deadlineAt-ports.now()),lifetime);}catch{if(!lifetime.aborted)throw Error('Hosted build worker wait failed');}
 }
}

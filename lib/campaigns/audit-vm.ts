import {requireBackgroundExecution,canRunBackground} from '../research/execution-control';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Sandbox} from '@vercel/sandbox';
import {db} from '../db';
import {sealJson,unsealJson} from '../crypto';
import {rpc} from '../tasks/store';
import {checked,artifact} from './store';
import type {Release} from './model';
import {checkAuditOperation,type AuditSession} from './audit-runtime';

export type AuditScope={studentId:string;campaignId?:string;taskId?:string};
const opening=new Map<string,Promise<AuditEndpoint>>();
export type AuditEndpoint={endpoint:string;key:string;session:AuditSession;ready:boolean};
async function progress(a:AuditSession,state:string,message:string,log?:string){
 if(!await rpc('audit_runtime_progress',{p_id:a.id,p_token:a.runtime_token,p_epoch:a.control_epoch,p_state:state,p_message:message,p_log:log??null}))throw Error('Replay computer progress was superseded');
}
async function open(release:Release,scope:AuditScope):Promise<AuditEndpoint>{
 let session=await rpc<AuditSession>('audit_session_create',{p_student:scope.studentId,p_scope:scope.campaignId??scope.taskId??'replay-research',p_campaign:scope.campaignId??null,p_release:release,p_key:sealJson({key:randomBytes(32).toString('hex')})});
 const {key}=unsealJson(session.sealed_key) as {key:string};
 if(['paused','canceled'].includes(session.state))return {session,key,endpoint:'',ready:false};
 const admitted=await rpc<AuditSession|null>('audit_runtime_begin',{p_id:session.id,p_student:session.student_id,p_epoch:session.control_epoch,p_provision:true});
 if(!admitted)return {session,key,endpoint:'',ready:false};
 session=admitted;
 const signal=AbortSignal.timeout(55000);
 let provisioned=false,requested=false;
 try{
 await checkAuditOperation(session);
 requested=true;
 const sandbox=await Sandbox.getOrCreate({name:session.vm_name,resume:true,persistent:true,resources:{vcpus:4},ports:[8097],timeout:30*60*1000,tags:{purpose:'preston-replay-auditor',session:session.id},signal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});
 const computer=sandbox.currentSession();
 session.runtime_session_id=computer.sessionId;
 if(!await rpc('audit_runtime_provisioned',{p_id:session.id,p_token:session.runtime_token,p_session:session.runtime_session_id}))throw Error('Native provisioning receipt was superseded');
 provisioned=true;
 await checkAuditOperation(session);
 if(session.retry_setup)await computer.runCommand('rm',['-f','/workspace/audit/bootstrap-status.json'],{signal,timeoutMs:5000});
 // Bound Session methods cannot implicitly resume another physical computer.
 // getOrCreate reuses a running VM without renewing its deadline. Keep active
 // audits alive; persistent job inputs still recover after the provider's hard limit.
 if(sandbox.expiresAt&&sandbox.expiresAt.getTime()-Date.now()<10*60*1000){
  try{await checkAuditOperation(session);await computer.extendTimeout(30*60*1000,{signal:AbortSignal.any([signal,AbortSignal.timeout(10000)])});}
  catch{console.warn('Audit VM deadline could not be extended; persisted jobs will resume after restart',session.id);}
 }
 const files=['replay_audit.py','build_engines.py','bootstrap_vm.py','start_vm.py','native/replay.nim','native/subject_vm.nim','native/validate.nim'];
 await checkAuditOperation(session);
 await computer.writeFiles(await Promise.all(files.map(async file=>({path:`/workspace/audit/${file}`,content:await readFile(join(process.cwd(),'workers',file))}))),{signal});
 await checkAuditOperation(session);
 await computer.writeFiles([{path:'/workspace/audit/session.json',content:Buffer.from(JSON.stringify({release,key}))}],{signal});
 await checkAuditOperation(session);
 const started=await computer.runCommand('python3',['/workspace/audit/start_vm.py'],{signal,timeoutMs:15000});
 if(started.exitCode!==0)throw Error('Replay auditor process could not start');
 const bytes=await computer.readFileToBuffer({path:'/workspace/audit/bootstrap-status.json'},{signal});
 let status=bytes?JSON.parse(bytes.toString()):null;
 if(status?.state==='ready'){
  const registry=await computer.readFileToBuffer({path:'/workspace/audit/engines.json'},{signal});
  if(!registry||!JSON.parse(registry.toString())[release.fingerprint]?.probeBinary)status={state:'building'};
 }
 if(status?.state!=='ready'){
  if(status?.state==='failed'){
   const log=await computer.readFileToBuffer({path:'/workspace/audit/bootstrap.log'},{signal});
   await progress(session,'setup_failed',status.message,log?.toString().slice(-10000));
  }else{
   await checkAuditOperation(session);
   await computer.runCommand({cmd:'bash',args:['-lc','mkdir -p /workspace/audit && flock -n /workspace/audit/bootstrap.lock python3 /workspace/audit/bootstrap_vm.py >> /workspace/audit/bootstrap.log 2>&1'],detached:true,signal});
   await progress(session,'building','Preparing replay auditor on its dedicated VM');
  }
  return {session,key,endpoint:computer.domain(8097),ready:false};
 }
 await progress(session,'ready','Replay auditor ready · dedicated VM');
 return {session,key,endpoint:computer.domain(8097),ready:true};
 }catch(error){
  if(!requested)await rpc('audit_runtime_not_started',{p_id:session.id,p_token:session.runtime_token});
  if(requested&&!provisioned)await progress(session,'setup_failed','Replay computer provisioning is unconfirmed; shutdown must be reconciled before another start').catch(()=>{});
  throw error;
 }finally{await rpc('audit_runtime_release',{p_id:session.id,p_token:session.runtime_token});}
}
/** One durable named microVM per auditor session. Never executes native tools on the web host. */
export async function auditVM(release:Release,scope:AuditScope){
 await requireBackgroundExecution(scope.studentId);
 const key=[scope.studentId,scope.campaignId??scope.taskId??'replay-research',release.fingerprint].join(':');
 let pending=opening.get(key);if(!pending){pending=open(release,scope).finally(()=>opening.delete(key));opening.set(key,pending);}return pending;
}
export async function recordAuditJob(a:AuditSession,jobId:string,episodeId:string,result:any){
 checked(await db().from('research_audit_jobs').upsert({audit_session_id:a.id,job_id:jobId,episode_id:episodeId,state:result.status,result:result.result??null,error:result.error??null,updated_at:new Date().toISOString()},{onConflict:'audit_session_id,job_id'}));
 if(result.status==='completed'){
  const probe=result.result?.kind==='candidate-prefix-probe';
  const campaign=a.campaign_id?checked(await db().from('research_campaigns').select('league_id').eq('id',a.campaign_id).single()):null;
  const {defaultLeagueId}=await import('../league-catalog');
  await artifact(a.student_id,campaign?.league_id??defaultLeagueId,probe?'candidate-probe':'replay-evidence',`${probe?'Candidate prefix probe':'Audited replay'} ${episodeId}`,{episodeId,jobId,...(probe?{diagnostic:result}:{audit:result}),release:a.release,vm:a.vm_name},{campaignId:a.campaign_id??undefined,taskId:a.task_id,provenance:{auditSessionId:a.id}});
  const simulation=result.result?.simulation;
  if(simulation?.semantics)await artifact(a.student_id,campaign?.league_id??defaultLeagueId,'release-semantics','Pinned replay field meanings: hero names, coordinates, ticks and action limits',{
   release:a.release,semantics:simulation.semantics,
   heroNames:Object.fromEntries((simulation.heroes??[]).filter((h:any)=>h.class_name).map((h:any)=>[h.class,h.class_name])),
   decoderHash:result.result.engines?.replayBinarySha256,
  },{campaignId:a.campaign_id??undefined,taskId:a.task_id});
 }
 const jobs=checked(await db().from('research_audit_jobs').select('job_id,state,episode_id,error').eq('audit_session_id',a.id))??[];
 const completed=jobs.filter(j=>j.state==='completed').length,pending=jobs.filter(j=>!['completed','failed'].includes(j.state)).length;
 checked(await db().from('agent_tasks').update({status:pending?'waiting':jobs.some(j=>j.state==='failed')?'failed':'completed',checkpoint:{audit_session_id:a.id,...(a.campaign_id?{campaign_id:a.campaign_id}:{}),vm_name:a.vm_name,research_progress:{summary:`${completed}/${jobs.length} native jobs complete · ${pending} running or queued`}},result:{summary:`${completed}/${jobs.length} native jobs completed`,vm:a.vm_name,jobs},next_check_at:'2100-01-01T00:00:00Z',updated_at:new Date().toISOString()}).eq('id',a.task_id).not('status','in','(paused,canceled)'));
}
/** Stop idle compute; the named sandbox filesystem persists and resumes on demand. */
export async function stopIdleAuditVMs(){
 const rows=checked(await db().from('research_audit_sessions').select('*').eq('state','ready').lt('last_used_at',new Date(Date.now()-15*60*1000).toISOString()).limit(4))??[];
 for(const a of rows)await rpc('audit_idle_stop',{p_id:a.id});
}

export async function dispatchAuditSessions(){
 const rows=checked(await db().from('research_audit_sessions').select('*').in('state',['starting','building','ready']).order('last_used_at').limit(4))??[];
 for(const a of rows){
  try{
   if(!await canRunBackground(a.student_id))continue;
   const jobs=checked(await db().from('research_audit_jobs').select('*').eq('audit_session_id',a.id).in('state',['queued','running','waiting']))??[];
   if(a.state==='ready'&&!jobs.length)continue;
   const vm=await auditVM(a.release,{studentId:a.student_id,campaignId:a.campaign_id??undefined,taskId:a.scope_key});
   if(!vm.endpoint)continue;
   for(const job of jobs){
    const response=await fetch(new URL(`/jobs/${job.job_id}`,vm.endpoint),{headers:{Authorization:`Bearer ${vm.key}`},signal:AbortSignal.timeout(10000)});
    if(response.ok)await recordAuditJob(a,job.job_id,job.episode_id,await response.json());
    else if(response.status===404)await recordAuditJob(a,job.job_id,job.episode_id,{status:'failed',error:'The VM no longer has this audit input. Inspect the replay again to recreate the audit.'});
   }
  }catch(error){console.error('Audit session could not refresh',a.id,error instanceof Error?error.name:'Unknown error');}
 }
}

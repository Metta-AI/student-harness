import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Sandbox} from '@vercel/sandbox';
import {db} from '../db';
import {sealJson,unsealJson} from '../crypto';
import {rpc} from '../tasks/store';
import {checked,artifact} from './store';
import type {Release} from './model';

export type AuditScope={studentId:string;campaignId?:string;taskId?:string};
type AuditSession={id:string;student_id:string;task_id:string;campaign_id:string|null;vm_name:string;sealed_key:string;state:string;release:Release};
const opening=new Map<string,Promise<AuditEndpoint>>();
export type AuditEndpoint={endpoint:string;key:string;session:AuditSession;ready:boolean};
async function progress(a:AuditSession,state:string,message:string,log?:string){
 if(a.state===state&&!log){checked(await db().from('research_audit_sessions').update({last_used_at:new Date().toISOString()}).eq('id',a.id));return;}
 checked(await db().from('research_audit_sessions').update({state,last_used_at:new Date().toISOString()}).eq('id',a.id));
 checked(await db().from('agent_tasks').update({status:state==='setup_failed'?'paused':'waiting',reason:state==='setup_failed'?message:null,checkpoint:{audit_session_id:a.id,...(a.campaign_id?{campaign_id:a.campaign_id}:{}),research_progress:{summary:message},vm_name:a.vm_name},next_check_at:'2100-01-01T00:00:00Z',updated_at:new Date().toISOString(),...(log?{result:{summary:message,log}}:{})}).eq('id',a.task_id).not('status','in','(canceled,paused)'));
}
async function open(release:Release,scope:AuditScope):Promise<AuditEndpoint>{
 const session=await rpc<AuditSession>('audit_session_create',{p_student:scope.studentId,p_scope:scope.campaignId??scope.taskId??'replay-research',p_campaign:scope.campaignId??null,p_release:release,p_key:sealJson({key:randomBytes(32).toString('hex')})});
 const {key}=unsealJson(session.sealed_key) as {key:string};
 if(['paused','canceled'].includes(session.state))return {session,key,endpoint:'',ready:false};
 const sandbox=await Sandbox.getOrCreate({name:session.vm_name,persistent:true,resources:{vcpus:4},ports:[8097],timeout:30*60*1000,tags:{purpose:'preston-replay-auditor',session:session.id},signal:AbortSignal.timeout(20000)});
 // getOrCreate reuses a running VM without renewing its deadline. Keep active
 // audits alive; persistent job inputs still recover after the provider's hard limit.
 if(sandbox.expiresAt&&sandbox.expiresAt.getTime()-Date.now()<10*60*1000){
  try{await sandbox.extendTimeout(30*60*1000,{signal:AbortSignal.timeout(10000)});}
  catch{console.warn('Audit VM deadline could not be extended; persisted jobs will resume after restart',session.id);}
 }
 const files=['replay_audit.py','build_engines.py','bootstrap_vm.py','start_vm.py','native/replay.nim','native/subject_vm.nim','native/validate.nim'];
 await sandbox.writeFiles(await Promise.all(files.map(async file=>({path:`/workspace/audit/${file}`,content:await readFile(join(process.cwd(),'workers',file))}))));
 await sandbox.writeFiles([{path:'/workspace/audit/session.json',content:Buffer.from(JSON.stringify({release,key}))}]);
 const started=await sandbox.runCommand('python3',['/workspace/audit/start_vm.py']);
 if(started.exitCode!==0)throw Error('Replay auditor process could not start');
 const bytes=await sandbox.readFileToBuffer({path:'/workspace/audit/bootstrap-status.json'});
 let status=bytes?JSON.parse(bytes.toString()):null;
 if(status?.state==='ready'){
  const registry=await sandbox.readFileToBuffer({path:'/workspace/audit/engines.json'});
  if(!registry||!JSON.parse(registry.toString())[release.fingerprint]?.probeBinary)status={state:'building'};
 }
 if(status?.state!=='ready'){
  if(status?.state==='failed'){
   const log=await sandbox.readFileToBuffer({path:'/workspace/audit/bootstrap.log'});
   await progress(session,'setup_failed',status.message,log?.toString().slice(-10000));
  }else{
   await sandbox.runCommand({cmd:'bash',args:['-lc','mkdir -p /workspace/audit && flock -n /workspace/audit/bootstrap.lock python3 /workspace/audit/bootstrap_vm.py >> /workspace/audit/bootstrap.log 2>&1'],detached:true});
   await progress(session,'building','Preparing replay auditor on its dedicated VM');
  }
  return {session,key,endpoint:sandbox.domain(8097),ready:false};
 }
 await progress(session,'ready','Replay auditor ready · dedicated VM');
 return {session,key,endpoint:sandbox.domain(8097),ready:true};
}
/** One durable named microVM per auditor session. Never executes native tools on the web host. */
export function auditVM(release:Release,scope:AuditScope){
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
 for(const a of rows){
  const pending=checked(await db().from('research_audit_jobs').select('job_id').eq('audit_session_id',a.id).in('state',['queued','running','waiting']).limit(1));if(pending?.length)continue;
  const sandbox=await Sandbox.get({name:a.vm_name});await sandbox.stop();
  checked(await db().from('research_audit_sessions').update({state:'idle'}).eq('id',a.id));
 }
}

export async function controlAuditSession(studentId:string,taskId:string,action:string,note:string){
 const a=checked(await db().from('research_audit_sessions').select('*').eq('student_id',studentId).eq('task_id',taskId).single());
 if(!a)throw Error('Audit session not found');
 if(action==='steer'){
  checked(await db().from('agent_tasks').update({reason:note}).eq('id',taskId));return;
 }
 if(!['pause','resume','cancel'].includes(action))throw Error('Invalid audit control');
 // Save the control first: a failed VM connection must not leave the session runnable.
 checked(await db().from('research_audit_sessions').update({state:action==='resume'?'starting':action==='pause'?'paused':'canceled',last_used_at:new Date().toISOString()}).eq('id',a.id));
 checked(await db().from('agent_tasks').update({status:action==='resume'?'waiting':action==='pause'?'paused':'canceled',reason:note||null,next_check_at:'2100-01-01T00:00:00Z'}).eq('id',taskId));
 try{
  const sandbox=await Sandbox.get({name:a.vm_name});
  if(action==='resume'){
   if(a.state==='setup_failed')await sandbox.runCommand('rm',['-f','/workspace/audit/bootstrap-status.json']);
  }else await sandbox.stop();
 }catch(error){
  // Provisioning may have failed before a VM existed. Resume provisions it in the dispatcher.
  if(!(error instanceof Error&&'response' in error&&(error.response as Response)?.status===404))throw error;
 }
}
export async function dispatchAuditSessions(){
 const rows=checked(await db().from('research_audit_sessions').select('*').in('state',['starting','building','ready']).order('last_used_at').limit(4))??[];
 for(const a of rows){
  try{
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

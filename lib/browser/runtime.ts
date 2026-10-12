import {setTimeout as delay} from 'node:timers/promises';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Sandbox} from '@vercel/sandbox';
import {db} from '../db';
import {rpc} from '../tasks/store';
import {computerEnabled,browserKeys} from './store';
import type {BrowserSession} from './model';
export const browserFiles=['worker.mjs','server.mjs','observer.mjs','install.sh','bootstrap.sh','serve.sh','package.json','package-lock.json'];
export const desktopFiles=['worker.mjs','server.mjs','backend.mjs','supervisor.py','install.sh','bootstrap.sh','serve.sh'];
async function allowed(b:BrowserSession){if(!await rpc<boolean>('cloud_browser_check',{p_id:b.id,p_job:b.job_token}))throw Error('Browser setup was stopped or its lease changed');}
async function finish(b:BrowserSession,state:string,message:string,endpoint:string|null=null,worker:unknown=null,error=false){return rpc('cloud_browser_finish',{p_id:b.id,p_job:b.job_token,p_state:state,p_message:message,p_endpoint:endpoint,p_worker:worker,p_error:error});}
function missing(error:unknown){return error instanceof Error&&'response' in error&&(error.response as Response)?.status===404;}
export async function reconcileBrowser(id:string){
 const b=await rpc<BrowserSession|null>('cloud_browser_claim',{p_id:id});if(!b)return;
 const kind=b.kind??'browser',root=`/vercel/sandbox/cloud-${kind}`,files=kind==='desktop'?desktopFiles:browserFiles;
 const workerState=async(response:Response)=>{const state=await response.json();if((state.kind??'browser')!==kind)throw Error('Wrong computer worker scope');return state;};
 const signal=AbortSignal.timeout(55000);
 let providerRequested=false;
 const notStarted=async()=>{if(!providerRequested&&b.job_token===b.provision_token)await rpc('cloud_browser_not_started',{p_id:b.id,p_job:b.job_token});};
 try{
  if(!computerEnabled(kind)&&b.state!=='stopping'){await notStarted();await finish(b,'stopping','Computer provisioning was disabled; shutting down');return;}
  let sandbox:Sandbox;
  if(b.job_token===b.provision_token&&b.state==='provisioning'){
   await allowed(b);
   // Only the first admitted job can request provisioning. Any interrupted or
   // timed-out creation is observed by name without resuming or creating again.
   providerRequested=true;
   sandbox=await Sandbox.getOrCreate({name:b.vm_name,resume:true,timeout:Math.max(1000,Date.parse(b.expires_at)-Date.now()),resources:{vcpus:2},ports:[8099],tags:{purpose:`preston-cloud-${kind}`,browser:b.id},signal:AbortSignal.any([signal,AbortSignal.timeout(20000)])});
  }else{
   try{sandbox=await Sandbox.get({name:b.vm_name,resume:false,signal:AbortSignal.any([signal,AbortSignal.timeout(10000)])});}
   catch(error){if(!missing(error))throw error;
    if(b.provision_uncertain){await finish(b,'stopping','Provisioning remains unconfirmed; no second computer will be requested',null,null,true);return;}
    await finish(b,'stopped','No browser computer remains');return;
   }
  }
  let computer;
  try{computer=sandbox.currentSession();}catch(error){
   if(error instanceof Error&&error.message==='No active session. Run a command or call resume first.'){
    await finish(b,b.provision_uncertain?'stopping':'stopped',b.provision_uncertain?'Provisioning remains unconfirmed':'Browser computer is stopped',null,null,b.provision_uncertain);return;
   }throw error;
  }
  if(b.provider_session_id&&b.provider_session_id!==computer.sessionId)throw Error('Provider browser identity changed unexpectedly');
  if(b.provision_token&&!await rpc<boolean>('cloud_browser_provisioned',{p_id:b.id,p_provision:b.provision_token,p_session:computer.sessionId}))throw Error('Provider identity receipt could not be saved');
  b.provision_uncertain=false;
  if(['stopped','failed','aborted'].includes(computer.status)){await finish(b,'stopped','Browser computer shutdown confirmed');return;}
  // All subsequent provider methods bind to this immutable physical session.
  if(b.state==='stopping'||!await rpc<boolean>('cloud_browser_check',{p_id:b.id,p_job:b.job_token})){
   await computer.stop({signal});await finish(b,'stopping','Provider accepted shutdown; awaiting terminal state');return;
  }
  const keys=browserKeys(b),endpoint=computer.domain(8099);
  if(b.state==='ready'){
   const response=await fetch(endpoint+'/state',{headers:{Authorization:`Bearer ${keys.humanKey}`},signal:AbortSignal.any([signal,AbortSignal.timeout(8000)]),redirect:'error'});
   if(!response.ok)throw Error('Computer worker did not respond');const state=await workerState(response);
   if(state.owner==='stopped'){await finish(b,'stopping',kind==='desktop'&&state.failure==='desktop_unavailable'?'Desktop became unavailable; stopping compute':'Computer lease ended; stopping compute');return;}
   await finish(b,'ready',kind==='desktop'?'Desktop ready':'Browser ready',endpoint,state);return;
  }
  await allowed(b);
  // Files/config are immutable for this session; a repeated setup observation
  // does not extend the browser lease or change its authentication keys.
  const bytes=await computer.readFileToBuffer({path:root+'/bootstrap.json'},{signal});
  const boot=bytes?JSON.parse(bytes.toString()):null;
  if(!boot){
   await computer.writeFiles(await Promise.all(files.map(async file=>({path:`${root}/${file}`,content:await readFile(join(process.cwd(),`workers/${kind}`,file))}))),{signal});
   await allowed(b);
   await computer.writeFiles([{path:root+'/private.json',content:Buffer.from(JSON.stringify({directory:root+'/state',binary:root+'/node_modules/.bin/agent-browser',origins:b.origins,expiresAt:Date.parse(b.expires_at),humanKey:keys.humanKey,agentKey:keys.agentKey,port:8099}))}],{signal});
  }
  if(boot?.state==='failed'||(!boot||boot.state!=='installed')&&Date.now()-Date.parse(b.created_at)>6*60000){await finish(b,'stopping','Browser setup failed or exceeded its deadline; shutting down');return;}
  if(boot?.state!=='installed'){
   await allowed(b);await computer.runCommand({cmd:'bash',args:[root+'/bootstrap.sh'],cwd:root,detached:true,timeoutMs:300000,signal});
   await finish(b,'booting',`Installing the isolated ${kind}`);return;
  }
  await allowed(b);await computer.update({networkPolicy:b.origins.length?{allow:b.origins.map(origin=>new URL(origin).hostname)}:'deny-all'},{signal});
  await allowed(b);await computer.runCommand({cmd:'bash',args:[root+'/serve.sh'],cwd:root,detached:true,timeoutMs:Math.max(1000,Date.parse(b.expires_at)-Date.now()),signal});
  const response=await fetch(endpoint+'/state',{headers:{Authorization:`Bearer ${keys.humanKey}`},signal:AbortSignal.any([signal,AbortSignal.timeout(8000)]),redirect:'error'});
  if(!response.ok){await finish(b,'booting','Waiting for the browser service');return;}
  await finish(b,'ready',kind==='desktop'?'Desktop ready':'Browser ready',endpoint,await workerState(response));
 }catch{
  // Keep both provisioning uncertainty and requested stop intact. Retrying this
  // reconciliation only observes the named computer; it never repeats creation.
  await notStarted();
  await finish(b,b.state==='ready'?'stopping':b.state==='provisioning'?'provisioning':b.state==='stopping'?'stopping':'booting','Browser status could not be confirmed; reconciliation will retry',null,null,true);
 }
}
export async function dispatchBrowsers(){
 const r=await db().from('cloud_browser_sessions').select('id').neq('state','stopped').lte('next_at',new Date().toISOString()).order('next_at').limit(1);
 if(r.error){if(r.error.code==='PGRST205'||r.error.code==='42P01')return;throw Error('Browser dispatcher unavailable');}
 for(const [index,b] of r.data.entries()){if(index)await delay(2010);await reconcileBrowser(b.id);}
}

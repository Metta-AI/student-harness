import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import {db} from '../db';
import {ownedContainerRevision,builderIdentitySchema} from './store';
import type {RecoveryBuild} from './recovery';
import {buildIdentity,verifyHostedReceipt} from '../../workers/policy-build/worker.mjs';

export type BuildInput={id:string;leagueId:string;coworldId:string;manifestHash:string;platform:string;dockerfile:string;files:{path:string;content:string}[]};
export type BuildEnvelope={input:BuildInput;commandToken:string;providerSessionId:string;deadlineAt:string;workerIdentity:z.infer<typeof builderIdentitySchema>};
export type WorkerBundle={identity:z.infer<typeof builderIdentitySchema>;files:{name:string;content:Buffer}[]};
const commandSchema=z.object({build_id:z.uuid(),student_id:z.string(),provider_session_id:z.string(),command_token:z.uuid(),admission_job:z.uuid(),command_id:z.string().nullable(),source_hash:z.string(),worker_identity:builderIdentitySchema,deadline_at:z.string(),state:z.enum(['admitted','installing','building','completed','failed','interrupted'])});
export type BuildCommand=z.infer<typeof commandSchema>;
export type CommandStore={input:(b:RecoveryBuild)=>Promise<BuildInput>;rpc:(name:string,args:Record<string,unknown>)=>Promise<unknown>};
export type CommandGateway={
 start:(b:RecoveryBuild,envelope:BuildEnvelope,bundle:WorkerBundle,authorize:()=>Promise<void>,signal:AbortSignal)=>Promise<string>;
 observe:(b:RecoveryBuild,command:BuildCommand,signal:AbortSignal)=>Promise<unknown|null>;
};
export async function trustedBuildBundle():Promise<WorkerBundle>{
 const files=await Promise.all(['worker.mjs','inspect_oci.py','install.sh'].map(async name=>({name,content:await fs.readFile(path.join(process.cwd(),'workers/policy-build',name))})));
 const hashes=files.map(f=>createHash('sha256').update(f.content).digest('hex'));
 return {identity:{workerSha256:hashes[0],inspectorSha256:hashes[1],installSha256:hashes[2]},files};
}
export const commandStore:CommandStore={
 async input(b){
  const r=await db().from('container_policy_revisions').select('league_id').eq('student_id',b.student_id).eq('id',b.revision_id).maybeSingle();
  if(r.error||!r.data)throw Error('Admitted container source could not load');
  const v=await ownedContainerRevision(b.student_id,r.data.league_id,b.revision_id);
  return {id:b.id,leagueId:v.league_id,coworldId:v.coworld_id,manifestHash:v.identity.manifestHash,platform:'linux/amd64',dockerfile:v.identity.dockerfile,files:v.files};
 },
 async rpc(name,args){const r=await db().rpc(name,args);if(r.error)throw Error(r.error.message);return r.data;},
};
/** Called under the current provider reconciliation job after its physical
 * session is persisted. No uncertain command is ever started a second time. */
export async function advanceContainerCommand(b:RecoveryBuild,gateway:CommandGateway,signal:AbortSignal,store:CommandStore=commandStore,bundleLoader:()=>Promise<WorkerBundle>=trustedBuildBundle){
 signal.throwIfAborted();
 const bundle=await bundleLoader();
 signal.throwIfAborted();
 const raw=await store.rpc('container_policy_command_claim',{p_student:b.student_id,p_build:b.id,p_job:b.job_token,p_worker:bundle.identity});
 const claim=z.object({command:commandSchema,can_run:z.boolean()}).parse(raw),c=claim.command;
 if(c.build_id!==b.id||c.student_id!==b.student_id||c.provider_session_id!==b.provider_session_id||!isDeepStrictEqual(c.worker_identity,b.worker_identity)||Date.parse(c.deadline_at)!==Date.parse(b.deadline_at))throw Error('Hosted command admission scope mismatch');
 const input=await store.input(b);
 if(input.id!==b.id||buildIdentity(input).sourceHash!==c.source_hash)throw Error('Hosted command source differs from admission');
 // Preserve PostgreSQL's microseconds in the evidence. JavaScript Date would
 // truncate them, making a valid worker receipt differ from its SQL admission.
 const envelope:BuildEnvelope={input,commandToken:c.command_token,providerSessionId:c.provider_session_id,deadlineAt:c.deadline_at,workerIdentity:c.worker_identity};
 const args={p_student:b.student_id,p_build:b.id,p_token:c.command_token};
 const authorize=async()=>{signal.throwIfAborted();if(!await store.rpc('container_policy_command_allowed',{...args,p_job:b.job_token}))throw Error('Hosted command authority expired or stopped');signal.throwIfAborted();};
 if(claim.can_run){
  if(c.admission_job!==b.job_token||!isDeepStrictEqual(bundle.identity,c.worker_identity))throw Error('Hosted worker deployment changed');
  await authorize();
  // start checks again before writing the envelope and before the provider POST.
  // If the response is lost, the next job only observes the original receipt.
  const commandId=await gateway.start(b,envelope,bundle,authorize,signal);
  if(!await store.rpc('container_policy_command_handle',{...args,p_session:c.provider_session_id,p_command:commandId}))throw Error('Hosted command handle was not accepted');
  return {state:'waiting',message:'Hosted build started; observing its original receipt'} as const;
 }
 signal.throwIfAborted();
 const receipt=await gateway.observe(b,c,signal);
 if(!receipt)return {state:'waiting',message:'Original command receipt is not visible; no replacement command was started'} as const;
 const verified=verifyHostedReceipt(envelope,receipt);
 if(verified.status==='uncertain')return {state:'waiting',message:'Original worker claim remains uncertain; no replacement command was started'} as const;
 if(!await store.rpc('container_policy_command_receipt',{...args,p_receipt:verified}))throw Error('Hosted worker receipt was not accepted');
 if(verified.status==='completed')return {state:'artifact_ready',command:c,envelope,receipt:verified,message:'Hosted artifact is ready for independent retention'} as const;
 if(['failed','interrupted'].includes(verified.status))return {state:'failed',message:'Hosted setup or build ended; stopping its builder'} as const;
 return {state:'waiting',message:`Hosted worker is ${verified.status}`} as const;
}

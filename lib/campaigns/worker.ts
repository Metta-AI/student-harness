import {gzipSync} from 'node:zlib';
import {auditVM,recordAuditJob,type AuditScope} from './audit-vm';
import { hashObject,sha,type Release } from './model';

export async function validatePolicySource(release:Release,source:string,scope:AuditScope){
 const vm=await auditVM(release,scope);
 if(!vm.ready)throw Error('Pinned policy compiler is preparing on the replay VM');
 const response=await fetch(new URL('/validate',vm.endpoint),{method:'POST',headers:{Authorization:`Bearer ${vm.key}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(40000),body:JSON.stringify({release,source})});
 if(!response.ok)throw Error(`Policy compiler returned ${response.status}; will retry without starting games`);
 const result=await response.json();
 if(typeof result.valid!=='boolean'||result.sourceHash!==sha(source)||result.release!==release.fingerprint||!/^[a-f0-9]{64}$/.test(result.compilerHash))throw Error('Policy compiler receipt identity mismatch');
 return result as {valid:boolean;sourceHash:string;release:string;compilerHash:string;error?:string;max_globals?:number};
}

/** Poll a persisted job without downloading the multi-megabyte replay again. A
 * missing job falls back to the original immutable input/recovery path. */
export async function readReplayAudit(release:Release,jobId:string,episodeId:string,scope:AuditScope){
 if(!/^[a-f0-9]{64}$/.test(jobId))throw Error('Invalid replay audit job identity');
 const vm=await auditVM(release,scope);
 if(!vm.endpoint||!vm.ready)return {status:'waiting',jobId};
 const response=await fetch(new URL(`/jobs/${jobId}`,vm.endpoint),{headers:{Authorization:`Bearer ${vm.key}`},signal:AbortSignal.timeout(10000)});
 if(response.status===404)return null;
 if(!response.ok)throw Error(`Replay worker returned ${response.status}`);
 const result=await response.json();
 await recordAuditJob(vm.session,jobId,episodeId,result);
 if(result.status==='failed')throw Error(`Replay audit mismatch: ${result.error}`);
 return {...result,jobId};
}

export async function requestReplayAudit(input:{episodeId:string;release:Release;replay:Uint8Array;source?:string;slot:number;scope?:AuditScope;mode?:'candidate-prefix-probe'}){
 const vm=input.scope?await auditVM(input.release,input.scope).catch(error=>{throw Error(`Open audit VM: ${error instanceof Error?error.message:String(error)}`);}):null;
 const endpoint=vm?.endpoint??process.env.PRESTON_AUDIT_WORKER_URL,key=vm?.key??process.env.PRESTON_AUDIT_WORKER_KEY;
 if(vm&&!vm.endpoint)return {status:'waiting',message:'Replay auditor session is paused or canceled',jobId:null};
 if(!endpoint||!key)return {status:'waiting',message:'Replay audit worker is not configured. Games remain recorded; promotion is blocked.',jobId:null};
 const jobId=hashObject({release:input.release.fingerprint,replay:sha(input.replay),source:sha(input.source??''),slot:input.slot,...(input.mode?{mode:input.mode}:{})});
 const headers={Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
 const url=new URL(`/jobs/${jobId}`,endpoint);
 let response=await fetch(url,{headers,signal:AbortSignal.timeout(10000)}).catch(error=>{throw Error(`Read audit receipt: ${error instanceof Error?error.message:String(error)}`);});
 if(response.status===404)response=await fetch(new URL('/jobs',endpoint),{method:'POST',headers,signal:AbortSignal.timeout(20000),body:JSON.stringify({jobId,episodeId:input.episodeId,release:input.release,replayEncoding:'gzip',replay:gzipSync(input.replay).toString('base64'),source:input.source??'',slot:input.slot,...(input.mode?{mode:input.mode}:{})})}).catch(error=>{throw Error(`Upload replay (${input.replay.length} bytes): ${error instanceof Error?error.message:String(error)}`);});
 if(!response.ok)throw Error(`Replay worker returned ${response.status}`);
 const result=await response.json();
 if(vm)await recordAuditJob(vm.session,jobId,input.episodeId,result);
 if(result.status==='failed')throw Error(`Replay audit mismatch: ${result.error}`);
 return {...result,jobId};
}

/** Check the exact release before spending on evaluation games. */
export async function auditWorkerReady(release:Release,scope?:AuditScope):Promise<boolean>{
 const vm=scope?await auditVM(release,scope):null;
 if(vm&&!vm.ready)return false;
 const endpoint=vm?.endpoint??process.env.PRESTON_AUDIT_WORKER_URL,key=vm?.key??process.env.PRESTON_AUDIT_WORKER_KEY;
 if(!endpoint||!key)return false;
 const response=await fetch(new URL(`/engines/${release.fingerprint}`,endpoint),{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(10000)});
 if(!response.ok)return false;
 const data=await response.json();return data.ready===true&&data.sourceUrl===release.sourceUrl;
}

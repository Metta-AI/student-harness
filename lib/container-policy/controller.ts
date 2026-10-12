import {reconcileContainerProvider,recoveryStore,type RecoveryStore,type BuildProvider} from './recovery';
import {advanceContainerCommand,commandStore,trustedBuildBundle,type CommandStore,type CommandGateway,type WorkerBundle} from './commands';
import {vercelBuildProvider} from './provider';
import {vercelCommandGateway,collectContainerArchive} from './command-provider';
import {retainContainerBuild,transferStore,type TransferStore} from './transfer';
import {PolicyArtifactStorage} from '../../workers/policy-build/storage.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type HostedBuildPorts={provider:BuildProvider;recovery:RecoveryStore;commands:CommandStore;gateway:CommandGateway;bundle:()=>Promise<WorkerBundle>;collect:typeof collectContainerArchive;transfers:TransferStore};
const defaults:HostedBuildPorts={provider:vercelBuildProvider,recovery:recoveryStore,commands:commandStore,gateway:vercelCommandGateway,bundle:trustedBuildBundle,collect:collectContainerArchive,transfers:transferStore};

/** Collect under the bounded provider job, then release that job before the
 * longer, independently leased storage transfer. Durable retention requests
 * shutdown; a subsequent provider pass must observe it before build completion. */
export async function reconcileHostedBuild(student:string,id:string,storage:PolicyArtifactStorage,ports:HostedBuildPorts=defaults,signal?:AbortSignal){
 signal?.throwIfAborted();
 const work:{command:Awaited<ReturnType<typeof advanceContainerCommand>>|null;directory:string|null;archive:string|null}={command:null,directory:null,archive:null};
 try{
  const provider=await reconcileContainerProvider(student,id,ports.provider,ports.recovery,async(build,signal)=>{
   const result=await advanceContainerCommand(build,ports.gateway,signal,ports.commands,ports.bundle);work.command=result;
   if(result.state==='artifact_ready'){
    if(!await ports.recovery.allowed(build))throw Error('Artifact collection was stopped');
    work.directory=await fs.mkdtemp(path.join(os.tmpdir(),'policy-collection-'));
    const file=path.join(work.directory,'download.tar');
    await ports.collect(build,result.envelope,result.receipt,file,signal);work.archive=file;
    return {message:'Archive collected; awaiting independently verified storage'};
   }
   return {message:result.message,stop:result.state==='failed'};
  },signal);
  if(provider.state!=='ready'||!work.archive||!work.directory||work.command?.state!=='artifact_ready')return {provider,command:work.command,retention:null};
  const retention=await retainContainerBuild({studentId:student,leagueId:work.command.envelope.input.leagueId,buildId:id,receipt:work.command.receipt.build,archivePath:work.archive,directory:path.join(work.directory,'verified'),storage,signal},ports.transfers);
  return {provider,command:work.command,retention};
 }finally{
  if(work.directory)await fs.rm(work.directory,{recursive:true,force:true});
 }
}

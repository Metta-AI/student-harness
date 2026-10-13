import {Sandbox} from '@vercel/sandbox';
import {containerProviderCredentials} from './provider-credentials.ts';
import type {BuildProvider,ProviderObservation,RecoveryBuild} from './recovery';

function missing(error:unknown){return error instanceof Error&&'response' in error&&(error.response as Response)?.status===404;}
const bounded=(signal:AbortSignal)=>AbortSignal.any([signal,AbortSignal.timeout(15000)]);
async function observation(sandbox:Sandbox,b:RecoveryBuild,signal:AbortSignal):Promise<ProviderObservation>{
 if(sandbox.name!==b.provider_name)throw Error('Provider returned another build');
 // A stopped named sandbox may no longer expose currentSession(). Observe one
 // bounded history page; never resume it just to retrieve an identity.
 const page=await sandbox.listSessions({limit:2,sortOrder:'desc',signal:bounded(signal)});
 if(page.sessions.length!==1||page.pagination.next)throw Error('Expected exactly one physical builder session');
 const session=page.sessions[0];
 if(b.provider_session_id&&session.id!==b.provider_session_id)throw Error('Physical builder session changed');
 return {name:sandbox.name,sessionId:session.id,status:session.status,stop:async stopSignal=>{
  const current=sandbox.currentSession();if(current.sessionId!==session.id)throw Error('Refusing to stop another physical session');
  await current.stop({signal:bounded(stopSignal)});
 }};
}
export const vercelBuildProvider:BuildProvider={
 async create(b,signal){
  const remaining=Date.parse(b.deadline_at)-Date.now();if(!Number.isFinite(remaining)||remaining<=0||remaining>600000)throw Error('Invalid builder lease');
  const sandbox=await Sandbox.create({...containerProviderCredentials(),name:b.provider_name,timeout:remaining,resources:{vcpus:2},
   persistent:false,tags:{purpose:'preston-policy-build',build:b.id},signal:bounded(signal)});
  return observation(sandbox,b,signal);
 },
 async observe(b,signal){
  let sandbox:Sandbox;
  try{sandbox=await Sandbox.get({...containerProviderCredentials(),name:b.provider_name,resume:false,signal:bounded(signal)});}
  catch(error){if(missing(error))return null;throw error;}
  return observation(sandbox,b,signal);
 },
};

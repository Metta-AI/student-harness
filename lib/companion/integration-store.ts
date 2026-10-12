import {createHash,randomBytes} from 'node:crypto';
import {db} from '../db';
import {sealJson,unsealJson} from '../crypto';
import {defaultLeagueId} from '../league-catalog';
import {externalObservationSchema,integrationMutationSchema,IntegrationError,type IntegrationSource} from './integrations';
import {verifyWebhook,webhookBody} from './webhook-signature';
const fields='id,name,status,revision,expires_at,created_at';
type PrivateSource=IntegrationSource&{student_id:string;sealed_key:string};
function key(source:PrivateSource){
 const value=unsealJson(source.sealed_key) as {student?:unknown;key?:unknown};
 if(value.student!==source.student_id||typeof value.key!=='string')throw Error('Webhook key unavailable');return value.key;
}
function publicSource(source:PrivateSource):IntegrationSource{
 const {id,name,status,revision,expires_at,created_at}=source;return {id,name,status,revision,expires_at,created_at};
}
export async function integrationSources(student:string){
 const r=await db().from('companion_integrations').select(fields).eq('student_id',student).order('created_at',{ascending:false}).limit(30);
 if(r.error)throw Error('External sources unavailable');return r.data as IntegrationSource[];
}
export async function expireIntegrations(){
 const r=await db().rpc('companion_expire_integrations').abortSignal(AbortSignal.timeout(15000));if(r.error)throw Error('External source expiry could not be applied');return r.data as number;
}
export async function mutateIntegration(student:string,input:unknown){
 const p=integrationMutationSchema.parse(input);
 const sealed=p.action==='create'||p.action==='rotate'?sealJson({student,key:'whsec_'+randomBytes(32).toString('base64')}):null;
 const r=await db().rpc('companion_manage_integration',{p_student:student,p_input:p,p_sealed:sealed}).abortSignal(AbortSignal.timeout(10000));
 if(r.error)throw new IntegrationError(r.error.code==='P0001'?r.error.message:'Source receipt unavailable; retry the same operation',r.error.code==='P0001'?409:503);
 const source=r.data.source as PrivateSource;
 return {source:publicSource(source),...(r.data.revealKey?{signingKey:key(source)}:{})};
}
export async function receiveExternalObservation(id:string,request:Request){
 const body=await webhookBody(request);
 const r=await db().from('companion_integrations').select('*').eq('id',id).maybeSingle();
 if(r.error)throw Error('Webhook service unavailable');const source=r.data as PrivateSource|null;
 if(!source||source.status!=='active'||Date.parse(source.expires_at)<=Date.now())throw new IntegrationError('Webhook source unavailable',401);
 const delivery=verifyWebhook(request.headers,body,key(source));
 let input;try{input=externalObservationSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body)));}catch{throw new IntegrationError('Invalid external observation payload',400);}
 const accepted=await db().rpc('companion_accept_external_event',{p_id:id,p_revision:source.revision,p_delivery:delivery,p_digest:createHash('sha256').update(body).digest('hex'),p_input:input}).abortSignal(AbortSignal.timeout(10000));
 if(accepted.error){
  const message=accepted.error.message;
  if(message==='External source quota reached')throw new IntegrationError(message,429);
  if(message==='Webhook delivery ID reused with different content')throw new IntegrationError(message,409);
  if(message==='Webhook source changed or unavailable')throw new IntegrationError(message,401);
  throw Error('Webhook receipt could not be saved; retry the same delivery ID');
 }
 return accepted.data as {eventId:string;duplicate:boolean};
}
export async function externalObservation(student:string,id:string){
 const r=await db().from('research_events').select('id,payload,created_at').eq('student_id',student).eq('id',id).eq('kind','external.observation').eq('payload->>leagueId',defaultLeagueId).maybeSingle();
 if(r.error)throw Error('External observation unavailable');return r.data as {id:string;payload:{sourceName:string;title:string;text:string;observedAt:string};created_at:string}|null;
}

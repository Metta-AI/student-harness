import {z} from 'zod';

const digest=z.string().regex(/^sha256:[a-f0-9]{64}$/);
const imageId=z.string().refine(v=>v.startsWith('img_')&&z.uuid().safeParse(v.slice(4)).success);
const imageSchema=z.object({id:imageId,name:z.string(),version:z.number().int().positive(),client_hash:digest.nullable(),status:z.enum(['pending','ready','deleted','published']),image_uri:z.string().nullable().optional(),image_digest:digest.nullable().optional()});
const pushSchema=z.object({kind:z.literal('ecr'),region:z.string().min(1),registry:z.string().min(1),repository:z.string().min(1),tag:z.string().min(1),image_uri:z.string().min(1),endpoint_url:z.url().nullable().optional(),expires_at:z.iso.datetime({offset:true}),authorization_token:z.string().min(1)});
const uploadSchema=z.object({image:imageSchema,pre_signed_info:pushSchema.nullable().optional()});
const versionSchema=z.object({id:z.uuid(),name:z.string(),version:z.number().int().positive()});
const nameSchema=z.string().min(1).max(64).refine(v=>!v.includes(':'));
const registrationSchema=z.strictObject({name:nameSchema,imageId,clientHash:digest,manifestDigest:digest,run:z.array(z.string().min(1)).min(1).max(100).optional(),env:z.record(z.string(),z.string()).optional(),tags:z.record(z.string().min(1).max(128),z.string().max(1024)).refine(v=>Object.keys(v).length<=50).optional(),secretEnvId:z.uuid().optional()});
export type ContainerImage=z.infer<typeof imageSchema>;
/** Temporary repository credentials. Never persist these in a build receipt or return them from a chat tool. */
export type ContainerPushCredentials=z.infer<typeof pushSchema>;
export type ContainerUploadScope={token:string;subjectId:string;playerId:string;authorize?:()=>Promise<void>};
export type ContainerImageIdentity={imageId:string;clientHash:string;manifestDigest:string};
export type ContainerPolicyRegistration=z.infer<typeof registrationSchema>;

/** No response bodies, request bodies or credential-bearing causes are included in errors. */
export class ContainerUploadApiError extends Error {
  readonly status:number;
  readonly uncertain:boolean;
  registeredVersion?:{id:string;name:string;version:number};
  constructor(status:number,message:string,uncertain=false){super(message);this.name='ContainerUploadApiError';this.status=status;this.uncertain=uncertain;}
}

async function request<T extends z.ZodType>(scope:ContainerUploadScope,path:string,schema:T,body?:unknown,signal?:AbortSignal):Promise<z.infer<T>>{
  if(!scope.token||!scope.subjectId||!scope.playerId)throw new ContainerUploadApiError(0,'Upload account and player identity are required');
  const timeout=AbortSignal.timeout(20_000),combined=signal?AbortSignal.any([signal,timeout]):timeout;
  const url=`${process.env.SOFTMAX_API_URL??'https://softmax.com/api'}/observatory${path}`;
  await scope.authorize?.();combined.throwIfAborted();
  let response:Response;
  try{response=await fetch(url,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${scope.token}`,'User-Agent':'softmax-student-harness/1.0',...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:combined,redirect:'error',cache:'no-store'});}
  catch{throw new ContainerUploadApiError(0,'Softmax upload request did not return a confirmed response',body!==undefined);}
  if(!response.ok){await response.body?.cancel();throw new ContainerUploadApiError(response.status,`Softmax upload request returned ${response.status}`,body!==undefined&&(response.status>=500||[408,409,429].includes(response.status)));}
  // Even malformed upstream responses must not echo temporary registry credentials into logs.
  const reader=response.body?.getReader();let size=0;const chunks:Uint8Array[]=[];
  try{
    if(!reader)throw Error();
    for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>131072)throw Error();chunks.push(value);}
    const parsed=schema.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));if(!parsed.success)throw Error();return parsed.data;
  }catch{throw new ContainerUploadApiError(0,'Softmax upload response could not be verified',body!==undefined);}
  finally{await reader?.cancel().catch(()=>{});reader?.releaseLock();}
}

/** Resolves the principal used by Docker registration. Never substitutes the first
 * listed player when no explicit default exists. This performs bounded reads only. */
export async function resolveContainerUploadPlayer(token:string,subjectId:string,signal?:AbortSignal,authorize?:()=>Promise<void>){
  const scope={token,subjectId,playerId:subjectId,authorize};
  const identity=await request(scope,'/whoami',z.object({subject_type:z.enum(['user','player']),subject_id:z.string(),name:z.string().nullable().optional()}),undefined,signal);
  if(identity.subject_id!==subjectId)throw new ContainerUploadApiError(0,'Upload account identity changed');
  if(identity.subject_type==='player')return {id:subjectId,name:identity.name??'Your player'};
  const players=await request(scope,'/players',z.array(z.object({id:z.string(),name:z.string().optional(),is_default:z.boolean(),disabled_at:z.string().nullable().optional()})),undefined,signal);
  const defaults=players.filter(p=>p.is_default&&!p.disabled_at);
  if(defaults.length!==1)throw new ContainerUploadApiError(0,'Container registration requires one active explicit default player');
  return {id:defaults[0].id,name:defaults[0].name??'Your player'};
}
async function assertScope(scope:ContainerUploadScope,signal?:AbortSignal,checkDefault=true){
  if(checkDefault){
    const player=await resolveContainerUploadPlayer(scope.token,scope.subjectId,signal,scope.authorize);
    if(player.id!==scope.playerId)throw new ContainerUploadApiError(0,'Container registration requires the current default player; the selected player changed or is unavailable');
    return;
  }
  const identity=await request(scope,'/whoami',z.object({subject_type:z.enum(['user','player']),subject_id:z.string()}),undefined,signal);
  if(identity.subject_id!==scope.subjectId)throw new ContainerUploadApiError(0,'Upload account identity changed');
  if(identity.subject_type==='player'&&identity.subject_id!==scope.playerId)throw new ContainerUploadApiError(0,'Upload player identity changed');
}
function assertImage(image:ContainerImage,identity:ContainerImageIdentity,ready=false,uncertain=false){
  if(image.id!==identity.imageId||image.client_hash!==identity.clientHash||image.status==='deleted')throw new ContainerUploadApiError(0,'Container image identity mismatch',uncertain);
  if(image.status==='ready'||image.status==='published'){
    if(image.image_digest!==identity.manifestDigest)throw new ContainerUploadApiError(0,'Container registry manifest digest mismatch',uncertain);
    if(image.image_uri&&!image.image_uri.endsWith(`@${identity.manifestDigest}`))throw new ContainerUploadApiError(0,'Container registry URI is not pinned to the verified manifest',uncertain);
  }else if(ready)throw new ContainerUploadApiError(0,'Container image is not ready',uncertain);
  return image;
}
function identityInput(input:ContainerImageIdentity){return z.object({imageId,clientHash:digest,manifestDigest:digest}).parse(input);}

/** Same client hash reuses an image in the authenticated namespace, even under another name.
 * The hash must identify the admitted image content, not a mutable policy label or build attempt.
 * No automatic retries: callers retain their original identity before requesting/reconciling it. */
export async function requestContainerImageUpload(scope:ContainerUploadScope,input:{name:string;clientHash:string;manifestDigest:string},signal?:AbortSignal){
  const data=z.object({name:z.string().min(1).max(128),clientHash:digest,manifestDigest:digest}).parse(input);
  await assertScope(scope,signal);
  const result=await request(scope,'/v2/container_images/upload',uploadSchema,{name:data.name,client_hash:data.clientHash},signal);
  assertImage(result.image,{imageId:result.image.id,...data},false,true);
  const credentials=result.pre_signed_info??null;
  if(result.image.status==='pending'){
    if(!credentials||Date.parse(credentials.expires_at)<=Date.now()||credentials.image_uri!==`${credentials.registry}/${credentials.repository}:${credentials.tag}`)throw new ContainerUploadApiError(0,'Container upload credentials are missing, expired or inconsistent',true);
  }else if(credentials)throw new ContainerUploadApiError(0,'Ready container image unexpectedly returned upload credentials',true);
  return {image:result.image,credentials};
}
export async function getContainerImage(scope:ContainerUploadScope,input:ContainerImageIdentity,signal?:AbortSignal){
  const identity=identityInput(input);await assertScope(scope,signal,false);
  return assertImage(await request(scope,`/v2/container_images/${identity.imageId}`,imageSchema,undefined,signal),identity);
}
export async function completeContainerImageUpload(scope:ContainerUploadScope,input:ContainerImageIdentity,signal?:AbortSignal){
  const identity=identityInput(input);await assertScope(scope,signal);
  return assertImage(await request(scope,'/v2/container_images/upload/complete',imageSchema,{id:identity.imageId},signal),identity,true,true);
}
/** Upstream has no player_id field. User credentials use the default player at POST time.
 * Preflight and readback detect a concurrent default-player change, but cannot make it atomic.
 * A mismatch can mean registration already happened: retain the receipt and never retry under
 * another identity. Player credentials avoid this race when available. Registration is otherwise
 * idempotent for identical name/image/run/env/player/secret; tags are mutable metadata, not identity.
 * Successful registration also schedules platform automatic counterfactual evaluations. Admission
 * must authorize that side effect; this function is never a read-only qualification probe. */
export async function registerContainerPolicy(scope:ContainerUploadScope,input:ContainerPolicyRegistration,signal?:AbortSignal){
  const data=registrationSchema.parse(input);
  const image=await getContainerImage(scope,data,signal);assertImage(image,data,true);
  await assertScope(scope,signal);
  const version=await request(scope,'/stats/policies/docker-img/complete',versionSchema,{name:data.name,container_image_id:data.imageId,...(data.run?{run:data.run}:{}),...(data.env?{env:data.env}:{}),...(data.tags?{tags:data.tags}:{}),...(data.secretEnvId?{policy_secret_env_id:data.secretEnvId}:{})},signal);
  try{
    if(version.name!==data.name)throw Error();
    if(!await lookupRegisteredContainerPolicy(scope,version,signal))throw Error();
  }catch{
    const error=new ContainerUploadApiError(0,`Registered policy ${version.id} could not be verified for the admitted player; inspect this version before any further registration`,true);
    error.registeredVersion=version;throw error;
  }
  return {...version,player_id:scope.playerId};
}

/** Read-only recovery for a known registration receipt. Never searches by mutable policy name. */
export async function lookupRegisteredContainerPolicy(scope:ContainerUploadScope,version:{id:string;name:string;version?:number},signal?:AbortSignal){
  const expected=versionSchema.partial({version:true}).parse(version);await assertScope(scope,signal,false);
  const params=new URLSearchParams({mine:'true',policy_version_id:expected.id,limit:'1'});
  const row=z.object({policy_version_id:z.uuid(),policy_name:z.string(),version:z.number().int(),player_id:z.string().nullable()});
  const page=await request(scope,`/v2/policy-versions?${params}`,z.union([z.array(row),z.object({entries:z.array(row)})]),undefined,signal);
  const rows=Array.isArray(page)?page:page.entries;
  if(rows.length!==1||rows[0].policy_version_id!==expected.id||rows[0].policy_name!==expected.name||(expected.version!==undefined&&rows[0].version!==expected.version)||rows[0].player_id!==scope.playerId)return null;
  return {id:expected.id,name:expected.name,version:rows[0].version,player_id:scope.playerId};
}

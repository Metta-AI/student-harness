import {randomUUID} from 'node:crypto';
import {getVercelOidcToken} from '@vercel/oidc';
import {CreditLimitError,reserveCredits,settleCredits,type ModelUsage} from '../credits';
import {verifyHermesMcpToken} from './host';

/** Hermes reaches AI Gateway only through this proxy. Each model call reserves
 * one dollar before it starts and settles the gateway's reported cost, exactly
 * like a Preston step; a call whose cost never arrives keeps its hold. */
const UPSTREAM='https://ai-gateway.vercel.sh/';
const json=(status:number,message:string,type='invalid_request_error')=>Response.json({error:{message,type}},{status,headers:{'cache-control':'no-store'}});

function student(request:Request){
 const header=request.headers.get('authorization')??'';
 return header.startsWith('Bearer ')?verifyHermesMcpToken(header.slice(7)):null;
}
async function credential(){
 const value=process.env.AI_GATEWAY_API_KEY||await getVercelOidcToken().catch(()=>process.env.VERCEL_OIDC_TOKEN);
 if(!value)throw Error('Vercel AI Gateway credentials are unavailable.');
 return value;
}
/** OpenAI-format usage, which AI Gateway prices in `cost`. */
export function gatewayUsage(value:unknown):ModelUsage|null{
 const usage=(value as {usage?:Record<string,unknown>}|null)?.usage;
 if(!usage||typeof usage!=='object')return null;
 const number=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:undefined;
 const details=usage.prompt_tokens_details as Record<string,unknown>|undefined;
 return {costUsd:number(usage.cost),inputTokens:number(usage.prompt_tokens),outputTokens:number(usage.completion_tokens),
  cacheReadTokens:number(details?.cached_tokens),cacheWriteTokens:number(usage.cache_creation_input_tokens)};
}
/** Reads SSE `data:` lines as they pass and keeps the last usage object. */
function meteredStream(body:ReadableStream<Uint8Array>,settle:(usage:ModelUsage|null)=>Promise<void>){
 const decoder=new TextDecoder();let buffer='',usage:ModelUsage|null=null,settled=false;
 const finish=async()=>{if(settled)return;settled=true;await settle(usage).catch(()=>{});};
 const scan=(text:string)=>{
  buffer+=text;let index:number;
  while((index=buffer.indexOf('\n'))>=0){
   const line=buffer.slice(0,index).trim();buffer=buffer.slice(index+1);
   if(!line.startsWith('data:'))continue;const data=line.slice(5).trim();if(!data||data==='[DONE]')continue;
   try{usage=gatewayUsage(JSON.parse(data))??usage;}catch{}
  }
 };
 return body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({
  transform(chunk,controller){scan(decoder.decode(chunk,{stream:true}));controller.enqueue(chunk);},
  async flush(){scan(decoder.decode()+'\n');await finish();},
 }));
}

export async function hermesGateway(request:Request,path:string[]){
 const id=student(request);if(!id)return json(401,'Hermes gateway authorization is invalid.','authentication_error');
 if(path[0]!=='v1')return json(404,'Unknown gateway path.','not_found_error');
 const target=new URL(path.map(encodeURIComponent).join('/'),UPSTREAM);
 if(!target.href.startsWith(UPSTREAM+'v1/'))return json(400,'Invalid gateway path.');
 target.search=new URL(request.url).search;
 let upstreamAuth:string;try{upstreamAuth=await credential();}catch(error){return json(503,(error as Error).message,'api_error');}
 const headers=new Headers({authorization:`Bearer ${upstreamAuth}`,'content-type':request.headers.get('content-type')??'application/json'});
 for(const name of ['accept','http-referer','x-title','user-agent'])if(request.headers.has(name))headers.set(name,request.headers.get(name)!);
 if(request.method==='GET'){
  const response=await fetch(target,{headers,signal:request.signal});
  return new Response(response.body,{status:response.status,headers:{'content-type':response.headers.get('content-type')??'application/json'}});
 }
 if(request.method!=='POST')return json(405,'Method not allowed.');
 let body:Record<string,unknown>;
 try{body=await request.json() as Record<string,unknown>;}catch{return json(400,'Request body must be JSON.');}
 // Ask for the final usage chunk, which carries the priced cost.
 if(body.stream===true)body={...body,stream_options:{...(body.stream_options as object|undefined),include_usage:true}};
 const key=`chat:hermes:${randomUUID()}`;
 try{await reserveCredits(id,key);}
 catch(error){return error instanceof CreditLimitError?json(402,error.message,'insufficient_quota'):json(503,(error as Error).message,'api_error');}
 const settle=(usage:ModelUsage|null)=>settleCredits(id,key,usage??{});
 // A failed or cancelled transfer keeps its hold: the provider may still bill it.
 const response=await fetch(target,{method:'POST',headers,body:JSON.stringify(body),signal:request.signal});
 const out=new Headers({'content-type':response.headers.get('content-type')??'application/json','cache-control':'no-store'});
 const generation=response.headers.get('x-generation-id');if(generation)out.set('x-generation-id',generation);
 // AI Gateway does not bill a rejected request.
 if(!response.ok){await settle({costUsd:0}).catch(()=>{});return new Response(response.body,{status:response.status,headers:out});}
 if(!response.body){await settle(null).catch(()=>{});return new Response(null,{status:response.status,headers:out});}
 if((response.headers.get('content-type')??'').includes('text/event-stream'))
  return new Response(meteredStream(response.body,settle),{status:response.status,headers:out});
 const text=await response.text();
 let usage:ModelUsage|null=null;try{usage=gatewayUsage(JSON.parse(text));}catch{}
 await settle(usage).catch(()=>{});
 return new Response(text,{status:response.status,headers:out});
}

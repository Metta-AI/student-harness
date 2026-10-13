import {createMCPClient,type MCPClient} from '@ai-sdk/mcp';
import {createHmac} from 'node:crypto';
import {z} from 'zod';
import {db} from '../db';
import {canonical} from '../campaigns/model';
import {connectionCatalog,type ToolConnection} from '../companion/tool-connections';
import {toolConnections,toolConnectionToken} from '../companion/tool-connection-store';
import {voiceConnectionInput} from './connection-input';
import {assertVoiceActive} from './session-access';
import {repositoryResultPage,type RepositoryReceipt,type RepositoryResult} from './connection-results';

export async function repositoryReceipt(student:string,id:string){
 const r=await db().from('companion_voice_connection_operations').select('id,connection_id,revision,voice_session,action,tool,status,result,created_at,finished_at,lease_until')
  .eq('student_id',student).eq('id',id).abortSignal(AbortSignal.timeout(5000)).maybeSingle();
 if(r.error||!r.data)throw Error('Repository receipt unavailable');return r.data as RepositoryReceipt;
}
async function connectionAccess(student:string,session:string,row:ToolConnection,operation?:string){
 const r=await db().rpc('companion_voice_connection_access',{p_student:student,p_session:session,p_connection:row.id,p_revision:row.revision,p_operation:operation??null}).abortSignal(AbortSignal.timeout(5000));
 if(r.error||r.data!==true)throw Error('Voice connection access changed');
}
function textResult(raw:Record<string,unknown>,token:string){
 const parts:string[]=[];
 for(const block of Array.isArray(raw.content)?raw.content:[]){
  if(block?.type==='text'&&typeof block.text==='string')parts.push(block.text);
  else if(block?.type==='resource'&&typeof block.resource?.text==='string')parts.push(block.resource.text);
 }
 if(raw.structuredContent!==undefined)parts.push(JSON.stringify(raw.structuredContent));
 let text=parts.join('\n\n');if(token)text=text.replaceAll(token,'[credential removed]');
 return {text:text.slice(0,120000),truncated:text.length>120000,isError:raw.isError===true};
}
export async function voiceRepository(student:string,session:string,expires:number,callId:string,raw:unknown){
 const input=voiceConnectionInput.parse(raw);
 const active=async()=>{if(Date.now()>=expires)throw Error('Voice session expired');await assertVoiceActive(student,session);};
 await active();
 const rows=(await toolConnections(student)).filter(r=>r.status==='active'&&r.voice_access===true&&Date.parse(r.expires_at)>Date.now());
 if(input.action==='list')return {connections:rows.map(r=>({provider:r.provider,revision:r.revision,description:connectionCatalog[r.provider].description,disclosure:connectionCatalog[r.provider].disclosure})),settings:'/connections'};
 if(input.action==='read'){
  const receipt=await repositoryReceipt(student,input.receiptId!),row=rows.find(r=>r.id===receipt.connection_id);
  if(!row)throw Error('Voice access to this source is disabled');await connectionAccess(student,session,row);
  return repositoryResultPage(receipt,input.offset);
 }
 const row=rows.find(r=>r.provider===input.provider);
 if(!row||input.action==='call'&&row.revision!==input.revision)throw Error('Voice connection changed; discover it again');
 const spec=connectionCatalog[row.provider];
 if(input.action==='call'&&!(spec.tools as readonly string[]).includes(input.tool!))throw Error('Tool is outside this connection scope');
 const key=process.env.SESSION_SECRET;if(!key)throw Error('Receipt storage unavailable');
 const fingerprint=createHmac('sha256',key).update(canonical({student,session,input})).digest('hex');
 const claim=await db().rpc('companion_claim_voice_connection',{p_student:student,p_session:session,p_call:callId,p_connection:row.id,p_revision:row.revision,p_action:input.action,p_tool:input.tool??null,p_fingerprint:fingerprint}).abortSignal(AbortSignal.timeout(5000));
 if(claim.error)throw Error('Repository request was not admitted');
 const operation=claim.data.operation as RepositoryReceipt;
 if(!claim.data.claimed)return repositoryResultPage(operation);
 let client:MCPClient|undefined,token='',sent=false,finished=false,bytes=0;
 const lifetime=new AbortController(),timer=setTimeout(()=>lifetime.abort(),25000);
 async function guard(){lifetime.signal.throwIfAborted();await active();await connectionAccess(student,session,row!,operation.id);}
 try{
  await guard();if(spec.token)token=(await toolConnectionToken(student,row)).token;
  client=await createMCPClient({protocolVersionDiscovery:false,maxRetries:0,initializationOptions:{signal:lifetime.signal,timeout:10000},
   transport:{type:'http',url:spec.endpoint,redirect:'error',headers:{...token?{Authorization:`Bearer ${token}`}:{},...row.provider==='github'?{'X-MCP-Readonly':'true','X-MCP-Tools':spec.tools.join(',')}:{}},
    fetch:async(url,init)=>{
     if((url instanceof Request?url.url:String(url))!==spec.endpoint)throw Error('Unexpected repository endpoint');await guard();
     const response=await fetch(url,{...init,redirect:'error',signal:AbortSignal.any([lifetime.signal,...init?.signal?[init.signal]:[]])});
     const body=response.body?.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(chunk,controller){bytes+=chunk.byteLength;if(bytes>2*1024*1024)throw Error('Repository response too large');controller.enqueue(chunk);}}));
     return new Response(body??null,{status:response.status,statusText:response.statusText,headers:response.headers});
    },
   },
  });
  let definitions=await client.listTools({options:{signal:lifetime.signal,timeout:10000}});
  const selected=new Map(definitions.tools.filter(t=>(spec.tools as readonly string[]).includes(t.name)).map(t=>[t.name,t]));
  for(let page=1;definitions.nextCursor&&selected.size<spec.tools.length&&page<4;page++){
   definitions=await client.listTools({params:{cursor:definitions.nextCursor},options:{signal:lifetime.signal,timeout:10000}});
   for(const tool of definitions.tools)if((spec.tools as readonly string[]).includes(tool.name))selected.set(tool.name,tool);
  }
  const tools=[...selected.values()];
  let result:RepositoryResult;
  if(input.action==='discover'){
   result={kind:'tools',provider:row.provider,revision:row.revision,receivedAt:new Date().toISOString(),truncated:!!definitions.nextCursor&&selected.size<spec.tools.length,tools:tools.map(t=>({name:t.name,description:(t.description??'').slice(0,1200),inputSchema:t.inputSchema}))};
   if(JSON.stringify(result).length>60000)throw Error('Repository schemas too large');
  }else{
   const definition=tools.find(t=>t.name===input.tool);if(!definition)throw Error('Tool unavailable');
   if(!z.fromJSONSchema(definition.inputSchema as Parameters<typeof z.fromJSONSchema>[0]).safeParse(input.arguments).success)throw Error('Arguments do not match the discovered schema');
   await guard();sent=true;
   const response=await client.callTool({name:input.tool!,arguments:input.arguments,options:{signal:lifetime.signal,timeout:15000}});
   result={kind:'text',provider:row.provider,revision:row.revision,tool:input.tool,arguments:input.arguments,receivedAt:new Date().toISOString(),...textResult(response,token)};
  }
  // Redact credentials from all provider-controlled metadata and echoed arguments too.
  if(token)result=JSON.parse(JSON.stringify(result).replaceAll(token,'[credential removed]')) as RepositoryResult;
  // Terminate the remote session before making the operation receipt terminal.
  await client.close();client=undefined;
  const saved=await db().rpc('companion_finish_voice_connection',{p_student:student,p_operation:operation.id,p_worker:operation.worker!,p_status:'completed',p_result:result}).abortSignal(AbortSignal.timeout(5000));
  if(saved.error||saved.data!==true)throw Error('Repository result receipt unavailable');finished=true;
  await active();await connectionAccess(student,session,row);
  return repositoryResultPage({...operation,status:'completed',result});
 }catch{
  if(!finished)await db().rpc('companion_finish_voice_connection',{p_student:student,p_operation:operation.id,p_worker:operation.worker!,p_status:sent?'unknown':'failed',p_result:null}).abortSignal(AbortSignal.timeout(5000)).then(()=>{},()=>{});
  await active();await connectionAccess(student,session,row);
  return repositoryResultPage(await repositoryReceipt(student,operation.id));
 }finally{
  // Close while the operation is still bounded. A revoked/expired grant can reject
  // a remote DELETE; aborting still closes local sockets without another read.
  await Promise.race([client?.close().catch(()=>{}),new Promise<void>(resolve=>{const timer=setTimeout(resolve,1000);timer.unref();})]);
  clearTimeout(timer);lifetime.abort();
 }
}

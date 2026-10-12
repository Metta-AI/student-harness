import {defineChannel,POST,GET} from 'eve/channels';
import {verifyHermesMcpToken} from '../../lib/hermes/host';
import {hermesToolList,runHermesTool} from '../lib/hermes-tools';

/** Harness tools for Hermes over MCP (Streamable HTTP, JSON responses). The
 * bearer token is injected by the Hermes sandbox's network policy, never stored
 * in the VM; it identifies the account. Each call also names its conversation,
 * which must belong to that account. */
const PROTOCOL='2025-06-18';
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const rpcError=(id:unknown,code:number,message:string)=>json({jsonrpc:'2.0',id:id??null,error:{code,message}});
const textResult=(value:unknown,isError=false)=>{
 const text=typeof value==='string'?value:JSON.stringify(value,null,1);
 return {content:[{type:'text',text:text.length>60000?`${text.slice(0,60000)}\n…(truncated)`:text}],isError};
};

async function handle(request:Request){
 const token=(request.headers.get('authorization')??'').replace(/^Bearer\s+/i,'');
 const student=token?verifyHermesMcpToken(token):null;
 if(!student)return json({error:'unauthorized'},401);
 const body=await request.json().catch(()=>null) as {jsonrpc?:string;id?:unknown;method?:string;params?:Record<string,unknown>}|null;
 if(!body||typeof body.method!=='string')return rpcError(null,-32600,'Invalid request');
 const {id,method,params}=body;
 if(id===undefined)return new Response(null,{status:202});
 if(method==='initialize')return json({jsonrpc:'2.0',id,result:{protocolVersion:typeof params?.protocolVersion==='string'?params.protocolVersion:PROTOCOL,capabilities:{tools:{listChanged:false}},serverInfo:{name:'preston-harness',version:'1.0.0'},instructions:'Softmax IDE harness tools: league data, saved policies, builds, uploads, practice games, research, memory and workspace views. Pass conversation_id on every call.'}});
 if(method==='ping')return json({jsonrpc:'2.0',id,result:{}});
 if(method==='tools/list')return json({jsonrpc:'2.0',id,result:{tools:hermesToolList()}});
 if(method==='tools/call'){
  const name=String(params?.name??''),args=(params?.arguments??{}) as Record<string,unknown>;
  try{
   const outcome=await runHermesTool(name,args,student,AbortSignal.any([request.signal,AbortSignal.timeout(10*60000)]));
   if(outcome.status==='ok')return json({jsonrpc:'2.0',id,result:textResult(outcome.result)});
   return json({jsonrpc:'2.0',id,result:textResult(outcome,outcome.status==='denied')});
  }catch(error){return json({jsonrpc:'2.0',id,result:textResult(error instanceof Error?error.message:'Tool failed',true)});}
 }
 return rpcError(id,-32601,`Method not found: ${method}`);
}

export default defineChannel({
 routes:[GET('/hermes/mcp',async()=>new Response(null,{status:405,headers:{Allow:'POST'}})),POST('/hermes/mcp',handle)],
});

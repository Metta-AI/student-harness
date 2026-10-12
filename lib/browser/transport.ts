import {desktopCommand} from '../computer/model';
import {browserCommand} from './model';
import {browserKeys,computerEnabled} from './store';
import {rpc} from '../tasks/store';
import type {BrowserSession,ComputerKind} from './model';
import {canRunBackground} from '../research/execution-control';
import {computerResponse} from './response';
export async function browserAdmission(student:string,id:string,kind:ComputerKind='browser'){
 const b=await rpc<BrowserSession>('cloud_browser_admit',{p_student:student,p_id:id});
 if((b.kind??'browser')!==kind)throw Error('Computer permission scope does not match this tool');
 // Worker receipts remain readable across handoff while the session is active.
 if(b.state!=='ready'||!b.endpoint||Date.parse(b.expires_at)<=Date.now())throw Error('Browser is not ready or its lease ended');
 if(!await canRunBackground(student))throw Error('Browser execution is held');
 const endpoint=new URL(b.endpoint);
 if(endpoint.protocol!=='https:'||!endpoint.hostname.endsWith('.vercel.run')||endpoint.username||endpoint.password||endpoint.port)throw Error('Invalid browser endpoint');
 return {browser:b,endpoint};
}
export async function browserTransport(student:string,id:string,actor:'human'|'agent',route:'/state'|'/command'|'/handoff'|'/receipt',input?:unknown,operationId?:string,kind:ComputerKind='browser'){
 if((route==='/command'||route==='/handoff')&&!computerEnabled(kind))throw Error('Cloud browser execution is disabled on this deployment');
 const {browser:b,endpoint}=await browserAdmission(student,id,kind),keys=browserKeys(b);
 let body:unknown=input;
 if(route==='/command')body=(kind==='desktop'?desktopCommand:browserCommand).parse(input);
 if(route==='/handoff'&&actor!=='human')throw Error('Only the human can change browser ownership');
 if(route==='/receipt'&&(!operationId||!/^[a-zA-Z0-9_-]{8,100}$/.test(operationId)))throw Error('Invalid browser receipt');
 const response=await fetch(new URL(route+(route==='/receipt'?`?id=${encodeURIComponent(operationId!)}`:''),endpoint),{method:body?'POST':'GET',headers:{Authorization:`Bearer ${actor==='human'?keys.humanKey:keys.agentKey}`,'Content-Type':'application/json'},...body?{body:JSON.stringify(body)}:{},signal:AbortSignal.timeout(45000),redirect:'error'});
 return computerResponse(response,kind,route);
}

// A read-only HTTP stream, never a tunnel to the browser's bidirectional socket.
// Admission is rechecked during the connection so a saved Stop/account hold also
// closes viewers whose client never sends another request.
export async function browserWatch(student:string,id:string,signal:AbortSignal,kind:ComputerKind='browser'){
 const {browser,endpoint}=await browserAdmission(student,id,kind);
 const abort=new AbortController(),upstreamSignal=AbortSignal.any([signal,abort.signal,AbortSignal.timeout(50000)]);
 const response=await fetch(new URL('/watch',endpoint),{headers:{Authorization:`Bearer ${browserKeys(browser).humanKey}`},signal:upstreamSignal,redirect:'error',cache:'no-store'});
 if(!response.ok||!response.body||!response.headers.get('content-type')?.startsWith('text/event-stream')){abort.abort();throw Error('Live browser view is unavailable');}
 const reader=response.body.getReader();let alive=true,checking=false,timer:ReturnType<typeof setInterval>;
 let output:ReadableStreamDefaultController<Uint8Array>;
 const cleanup=()=>{alive=false;clearInterval(timer);upstreamSignal.removeEventListener('abort',finish);abort.abort();void reader.cancel().catch(()=>{});};
 const finish=()=>{if(!alive)return;cleanup();output?.close();};
 const body=new ReadableStream<Uint8Array>({
  start(controller){
   output=controller;upstreamSignal.addEventListener('abort',finish,{once:true});
   if(upstreamSignal.aborted){finish();return;}
   timer=setInterval(()=>{
    if(checking||!alive)return;checking=true;
    void browserAdmission(student,id,kind).then(current=>{if(current.browser.provider_session_id!==browser.provider_session_id||current.endpoint.href!==endpoint.href)finish();}).catch(finish).finally(()=>{checking=false;});
   },10000);
  },
  async pull(controller){try{const next=await reader.read();if(!alive)return;if(next.done){finish();return;}controller.enqueue(next.value);}catch{finish();}},
  cancel(){if(alive)cleanup();},
 },{highWaterMark:0});
 return new Response(body,{headers:{'Content-Type':'text/event-stream','Cache-Control':'no-store','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff'}});
}

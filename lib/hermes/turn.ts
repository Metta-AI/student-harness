import {db} from '../db';
import {ensureHermesHost} from './host';

/** One conversation's link to its Hermes session on the account's shared host. */
/** Hermes titles must be unique per host, and conversations often open with the
 * same words, so each title carries a short conversation-and-time suffix. */
export async function hermesSessionFor(host:{url:string;key:string},student:string,eveSessionId:string,leagueId:string,title:string){
 const existing=await db().from('hermes_conversations').select('hermes_session_id').eq('eve_session_id',eveSessionId).eq('student_id',student).maybeSingle();
 if(existing.data?.hermes_session_id){
  const probe=await fetch(`${host.url}/api/sessions/${encodeURIComponent(existing.data.hermes_session_id)}`,{headers:{authorization:`Bearer ${host.key}`},signal:AbortSignal.timeout(15000)}).catch(()=>null);
  if(probe?.ok)return {id:existing.data.hermes_session_id as string,created:false};
 }
 const response=await fetch(`${host.url}/api/sessions`,{method:'POST',headers:{authorization:`Bearer ${host.key}`,'content-type':'application/json'},body:JSON.stringify({title:`${title.slice(0,100)} · ${eveSessionId.slice(-6)}${Date.now().toString(36).slice(-4)}`}),signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error(`Hermes could not create a session (${response.status}).`);
 const body=await response.json() as Record<string,unknown>;
 const id=String(body.id??body.session_id??(body.session as Record<string,unknown>|undefined)?.id??'');
 if(!id)throw Error('Hermes returned no session id.');
 const saved=await db().from('hermes_conversations').upsert({eve_session_id:eveSessionId,student_id:student,league_id:leagueId,hermes_session_id:id,updated_at:new Date().toISOString()});
 if(saved.error)throw Error('Could not save the Hermes session link.');
 return {id,created:true};
}

export type HermesProgress={kind:'tool';name:string;state:'started'|'completed'|'failed'}|{kind:'commentary'|'answer';text:string};
export type HermesTurnResult={reply:string;tools:string[];pendingApprovals:{tool:string;input:unknown}[];hermesSessionId:string;usage?:unknown};

function* sseEvents(buffer:{text:string}){
 let index:number;
 while((index=buffer.text.indexOf('\n\n'))>=0){
  const block=buffer.text.slice(0,index);buffer.text=buffer.text.slice(index+2);
  let event='message',data='';
  for(const line of block.split('\n')){if(line.startsWith('event:'))event=line.slice(6).trim();else if(line.startsWith('data:'))data+=line.slice(5).trim();}
  if(data)yield {event,data};
 }
}
function parsed(data:string){try{return JSON.parse(data) as Record<string,unknown>;}catch{return {} as Record<string,unknown>;}}
const harnessTool=(name:string)=>name.replace(/^mcp[_:]+preston[_:]+/,'').replace(/^preston[_:]+/,'');
/** Tool names in a Hermes tool event. Hermes loads MCP tools lazily and calls
 * them through its tool_call wrapper, so the real names are in its arguments. */
function eventTools(body:Record<string,unknown>):string[]{
 const name=String(body.tool_name??body.tool??body.name??'');
 if(!name||name.startsWith('_'))return [];
 const calls=(body.args as {calls?:unknown}|null|undefined)?.calls;
 if(name==='tool_call'&&Array.isArray(calls)){const inner=calls.map(call=>String((call as {name?:unknown})?.name??'')).filter(Boolean);if(inner.length)return inner.map(harnessTool);}
 return [harnessTool(name)];
}

/** Streams one Hermes turn. Progress is yielded as it arrives; the final value
 * carries the reply and any harness actions waiting for human approval. */
export async function* runHermesTurn(options:{student:string;eveSessionId:string;leagueId:string;title:string;message:string;model:string;signal:AbortSignal}):AsyncGenerator<HermesProgress,HermesTurnResult>{
 yield {kind:'commentary',text:'Connecting to the research workspace'};
 const host=await ensureHermesHost(options.student);
 const session=await hermesSessionFor(host,options.student,options.eveSessionId,options.leagueId,options.title);
 yield {kind:'commentary',text:'Reading your request and the saved conversation'};
 const response=await fetch(`${host.url}/api/sessions/${encodeURIComponent(session.id)}/chat/stream`,{method:'POST',
  headers:{authorization:`Bearer ${host.key}`,'content-type':'application/json',accept:'text/event-stream'},
  body:JSON.stringify({input:options.message,model:options.model,provider:'ai-gateway'}),signal:options.signal});
 if(!response.ok||!response.body)throw Error(`Hermes turn failed to start (${response.status}): ${(await response.text().catch(()=>'')).slice(0,300)}`);
 const reader=response.body.getReader(),decoder=new TextDecoder(),buffer={text:''};
 let reply='',completed:string|null=null,usage:unknown;const tools:string[]=[],pending:{tool:string;input:unknown}[]=[];let lastStarted:string[]=[];let lastPreviewAt=0,lastPreviewSize=0;
 for(;;){
  const {value,done}=await reader.read();if(done)break;
  buffer.text+=decoder.decode(value,{stream:true});
  for(const {event,data} of sseEvents(buffer)){
   const body=parsed(data),type=String(body.type??event);
   if(type==='assistant.delta'){
    reply+=String(body.delta??body.text??'');
    // Public assistant text only; never expose reasoning events. Bound updates
    // so token streaming does not flood durable tool receipts.
    const now=Date.now();
    if(reply.trim()&&(lastPreviewSize===0||now-lastPreviewAt>=1000)&&reply.length-lastPreviewSize>=40){
     const paragraph=reply.trim().split(/\n\s*\n/).at(-1)??'';
     yield {kind:'answer',text:paragraph.slice(0,240)};
     lastPreviewAt=now;lastPreviewSize=reply.length;
    }
   }
   else if(type==='assistant.commentary'&&typeof body.text==='string')yield {kind:'commentary',text:body.text};
   else if(type==='tool.started'){const names=eventTools(body);if(names.length)lastStarted=names;for(const name of names){tools.push(name);yield {kind:'tool',name,state:'started'};}}
   else if(type==='tool.completed'||type==='tool.failed'){const names=eventTools(body);const shown=names.length===1&&names[0]==='tool_call'?lastStarted:names;for(const name of shown)yield {kind:'tool',name,state:type==='tool.failed'||body.error===true?'failed':'completed'};}
   else if(type==='assistant.completed'||type==='run.completed'){const text=body.final_response??body.output??body.text??body.content;if(typeof text==='string'&&text.trim())completed=text;usage=body.usage??usage;}
   else if(type==='run.cancelled')throw Error('Hermes turn was cancelled.');
   else if(type==='error'||type==='run.failed')throw Error(`Hermes turn failed: ${String(body.message??body.error??data).slice(0,400)}`);
  }
 }
 const held=await db().from('hermes_conversations').select('pending_approvals').eq('eve_session_id',options.eveSessionId).eq('student_id',options.student).maybeSingle();
 for(const item of Array.isArray(held.data?.pending_approvals)?held.data.pending_approvals as {tool:string;input:unknown}[]:[])if(item&&typeof item.tool==='string')pending.push(item);
 if(pending.length)await db().from('hermes_conversations').update({pending_approvals:[]}).eq('eve_session_id',options.eveSessionId).eq('student_id',options.student);
 return {reply:(completed??reply).trim(),tools,pendingApprovals:pending,hermesSessionId:session.id,usage};
}

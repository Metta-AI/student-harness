import type {MessageStreamEvent} from 'eve/client';
export type TranscriptEntry={id:string;at:string;sessionId:string;kind:'message'|'tool'|'result'|'error';text?:string;name?:string;input?:unknown;output?:unknown;state?:'running'|'done'|'failed';terminal?:boolean};
/** Public messages and tool activity only. Reasoning and auth/context events are intentionally excluded. */
export function applyTranscriptEvent(entries:Map<string,TranscriptEntry>,sessionId:string,event:MessageStreamEvent) {
 if(!('data' in event))return;
 const {type,data,meta}=event;
 const base={at:meta.at,sessionId};
 if(type==='message.completed'&&data.message){const id=`${sessionId}:${meta.id}`;entries.set(id,{...base,id,kind:'message',text:data.message});}
 if(type==='actions.requested')for(const action of data.actions){
  if(action.kind!=='tool-call')continue;
  const id=`${sessionId}:tool:${action.callId}`;
  entries.set(id,{...base,id,kind:'tool',name:action.toolName,input:action.input,state:'running'});
 }
 if(type==='action.result'&&data.result.kind==='tool-result'){
  const result=data.result,id=`${sessionId}:tool:${result.callId}`,old=entries.get(id);
  entries.set(id,{...base,...old,id,kind:'tool',name:result.toolName,input:old?.input,output:result.output,state:result.isError?'failed':'done'});
 }
 if(type==='result.completed') {const id=`${sessionId}:${meta.id}`;entries.set(id,{...base,id,kind:'result',output:data.result});}
 if(type==='session.failed'||type==='turn.failed'){
  // Eve emits turn.failed and session.failed for the same failure. Keep one
  // readable incident while preserving its diagnostic fields behind Details.
  const errorId=data.details?.errorId;
  const id=`${sessionId}:error:${errorId??meta.id}`,old=entries.get(id);
  const message=data.message||'Agent execution stopped';
  const text=/Could not load session model selection/.test(message)?'The saved model could not be loaded.':message;
  entries.set(id,{...base,...old,id,kind:'error',name:'Execution details',text,
   output:{...(old?.output as Record<string,unknown>??{}),...data},terminal:old?.terminal||type==='session.failed'});
 }
}

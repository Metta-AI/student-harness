import type { VoiceEvent } from './transcript';
export type ConversationVoiceEvent = VoiceEvent & { session_id: string };
/** A stable message per spoken turn. Anchor to text IDs so reopening does not reorder a mixed conversation. */
export function spokenMessages(events: ConversationVoiceEvent[]) {
 const messages: {id:string;role:'user'|'assistant';text:string;createdAt:Date;after:string|null;end:number|null;session:string}[]=[];
 const seen=new Set<string>();
 for(const event of [...events].sort((a,b)=>a.received_at.localeCompare(b.received_at)||a.sequence-b.sequence)){
  const key=`${event.session_id}:${event.event_id}`;
  if(seen.has(key)||event.kind!=='transcript'||!event.role)continue;
  seen.add(key);
  const last=messages.at(-1),after=event.after_message_id??null;
  if(last&&last.session===event.session_id&&last.role===event.role&&last.after===after&&(event.start_ms===null||last.end===null||event.start_ms-last.end<1800)) {last.text+=event.text;last.end=event.end_ms;}
  else messages.push({id:`voice:${key}`,role:event.role,text:event.text,createdAt:new Date(event.received_at),after,end:event.end_ms,session:event.session_id});
 }
 return messages;
}
export function mergeSpokenMessages<T extends {id:string}>(text:T[],spoken:(T&{after:string|null})[]):T[]{
 const ids=new Set(text.map(m=>m.id));
 const groups=new Map<string|null,T[]>();
 for(const message of spoken){const key=message.after&&ids.has(message.after)?message.after:null;groups.set(key,[...(groups.get(key)??[]),message]);}
 return [...(groups.get(null)??[]),...text.flatMap(m=>[m,...(groups.get(m.id)??[])])];
}

export async function readVoiceConversation(session:string,signal:AbortSignal):Promise<ConversationVoiceEvent[]>{
 const events:ConversationVoiceEvent[]=[];let after=-1;
 do {
  const response=await fetch(`/api/voice/transcripts?session=${encodeURIComponent(session)}&after=${after}`,{signal});
  if(!response.ok)throw Error('Could not load the spoken conversation.');
  const page=await response.json();
  events.push(...page.events.map((event:VoiceEvent)=>({...event,session_id:session})));
  after=page.next??-1;
 }while(after!==-1);
 return events;
}

import { db } from "../db";
import { transcriptTurns, type VoiceEvent } from "./transcript";
export function missingConversationSchema(error:{code?:string;message?:string}|null){return !!error && ['42703','PGRST204'].includes(error.code??'');}
export async function registerVoiceSession(student: string, id: string, model: string, leagueId = "league_3c60897b-25cf-4b37-9d1a-8554c1198f28") {
  let {error}=await db().from('voice_sessions').insert({student_id:student,id,model,league_id:leagueId});
  if(missingConversationSchema(error))({error}=await db().from('voice_sessions').insert({student_id:student,id,model}));
  if(error)throw new Error('Could not register voice history');
}
export async function appendVoiceEvents(student: string, session: string, events: VoiceEvent[]) {
  let {error}=await db().from('voice_events').upsert(events.map(e=>({...e,student_id:student,session_id:session})),{onConflict:'student_id,session_id,event_id',ignoreDuplicates:true});
  if(missingConversationSchema(error))({error}=await db().from('voice_events').upsert(events.map(({after_message_id,...e})=>({...e,student_id:student,session_id:session})),{onConflict:'student_id,session_id,event_id',ignoreDuplicates:true}));
  if(error)throw new Error('Could not save voice history');
}
export async function recentVoiceHistory(student: string, leagueId = "league_3c60897b-25cf-4b37-9d1a-8554c1198f28") {
  const {data:sessions,error}=await db().from('voice_sessions').select('id').eq('student_id',student).eq('league_id',leagueId).order('started_at',{ascending:false}).limit(1);
  if(error)throw new Error('Could not read voice history');
  if(!sessions?.length)return [];
  const {data,error:eventsError}=await db().from('voice_events').select('*').eq('student_id',student).eq('session_id',sessions[0].id).eq('kind','transcript').order('sequence',{ascending:false}).limit(200);
  if(eventsError)throw new Error('Could not read voice history');
  return transcriptTurns(data as VoiceEvent[]).slice(-12).map(t=>({role:t.role,text:t.text.slice(-1500)}));
}

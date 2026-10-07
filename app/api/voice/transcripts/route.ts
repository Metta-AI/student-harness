import { z } from 'zod';
import { currentSession, sameOrigin } from '../../../../lib/session';
import { db } from '../../../../lib/db';
import { verifyVoiceTranscriptLease } from '../../../../lib/voice/server';
import { voiceEventSchema } from '../../../../lib/voice/transcript';
import { appendVoiceEvents, missingConversationSchema } from '../../../../lib/voice/transcript-store';
export async function POST(request:Request) {
  if(!sameOrigin(request))return new Response(null,{status:403});
  const student=await currentSession();if(!student)return new Response(null,{status:401});
  let body,session;
  try {
    const raw=await request.text();if(raw.length>60000)return new Response(null,{status:413});
    body=z.object({lease:z.string().max(2000),events:z.array(voiceEventSchema).min(1).max(100)}).parse(JSON.parse(raw));
    session=verifyVoiceTranscriptLease(body.lease,student.subjectId).session;
  } catch {return new Response(null,{status:400});}
  try {await appendVoiceEvents(student.subjectId,session,body.events);return Response.json({saved:body.events.map(e=>e.event_id)});}
  catch {return Response.json({error:'Transcript not saved yet'},{status:503});}
}
export async function GET(request:Request) {
  const student=await currentSession();if(!student)return new Response(null,{status:401});
  const query=new URL(request.url).searchParams,session=query.get('session');
  const headers={'Cache-Control':'no-store'};
  const chat=query.get('chat');
  if(chat){
    const {data:sessions,error}=await db().from('voice_sessions').select('id,started_at').eq('student_id',student.subjectId).eq('chat_session_id',chat).order('started_at',{ascending:true});
    if(missingConversationSchema(error))return Response.json({sessions:[],linkingAvailable:false},{headers});
    return Response.json(error?{error:'History unavailable'}:{sessions},{status:error?503:200,headers});
  }
  if(!session){
    let {data,error}=await db().from('voice_sessions').select('id,started_at,model,chat_session_id,league_id').eq('student_id',student.subjectId).order('started_at',{ascending:false}).limit(50);
    if(missingConversationSchema(error)){const legacy=await db().from('voice_sessions').select('id,started_at,model').eq('student_id',student.subjectId).order('started_at',{ascending:false}).limit(50);error=legacy.error;data=legacy.data?.map(row=>({...row,chat_session_id:null,league_id:null}))??null;}
    return Response.json(error?{error:'History unavailable'}:{sessions:data},{status:error?503:200,headers});
  }
  const after=Number(query.get('after')??-1);if(!Number.isInteger(after)||after< -1)return new Response(null,{status:400});
  let {data,error}=await db().from('voice_events').select('event_id,sequence,kind,role,text,start_ms,end_ms,received_at,after_message_id').eq('student_id',student.subjectId).eq('session_id',session).gt('sequence',after).order('sequence',{ascending:true}).limit(1000);
  if(missingConversationSchema(error)){const legacy=await db().from('voice_events').select('event_id,sequence,kind,role,text,start_ms,end_ms,received_at').eq('student_id',student.subjectId).eq('session_id',session).gt('sequence',after).order('sequence',{ascending:true}).limit(1000);error=legacy.error;data=legacy.data?.map(row=>({...row,after_message_id:null}))??null;}
  return Response.json(error?{error:'History unavailable'}:{events:data,next:data?.length===1000?data.at(-1)!.sequence:null},{status:error?503:200,headers});
}

/** Link only this student's calls to this student's saved text conversation. Never move an already linked call. */
export async function PATCH(request:Request){
 if(!sameOrigin(request))return new Response(null,{status:403});
 const student=await currentSession();if(!student)return new Response(null,{status:401});
 const parsed=z.object({chatSessionId:z.string().min(4).max(128),voiceSessionIds:z.array(z.string().min(1).max(200)).min(1).max(100)}).safeParse(await request.json().catch(()=>null));
 if(!parsed.success)return new Response(null,{status:400});
 const {chatSessionId,voiceSessionIds}=parsed.data;
 const {data:chat,error:chatError}=await db().from('chat_sessions').select('session_id').eq('student_id',student.subjectId).eq('session_id',chatSessionId).maybeSingle();
 if(chatError)return Response.json({error:'Could not save conversation link'},{status:503});
 if(!chat)return new Response(null,{status:404});
 const {data:voices,error}=await db().from('voice_sessions').select('id,chat_session_id,league_id').eq('student_id',student.subjectId).in('id',voiceSessionIds);
 if(error)return Response.json({error:'Could not save conversation link'},{status:503});
 if(voices?.length!==new Set(voiceSessionIds).size||voices.some(v=>v.league_id!=='league_3c60897b-25cf-4b37-9d1a-8554c1198f28'||v.chat_session_id&&v.chat_session_id!==chatSessionId))return new Response(null,{status:409});
 const result=await db().from('voice_sessions').update({chat_session_id:chatSessionId}).eq('student_id',student.subjectId).in('id',voiceSessionIds).is('chat_session_id',null);
 if(result.error)return Response.json({error:'Could not save conversation link'},{status:503});
 // Another tab may have linked a call after the ownership check. Do not report the wrong association as saved.
 const verified=await db().from('voice_sessions').select('id,chat_session_id').eq('student_id',student.subjectId).in('id',voiceSessionIds);
 if(verified.error)return Response.json({error:'Could not verify conversation link'},{status:503});
 if(verified.data?.some(v=>v.chat_session_id!==chatSessionId))return new Response(null,{status:409});
 return Response.json({ok:true});
}

import { defaultLeagueId,leagueIdSchema } from "../../../lib/league-catalog";
import { z } from 'zod';
import { currentSession,sameOrigin } from '../../../lib/session';
import { db } from '../../../lib/db';
import { createView } from '../../../lib/views/store';
export async function POST(request:Request) {
  if(!sameOrigin(request))return new Response(null,{status:403});
  const student=await currentSession();if(!student)return new Response(null,{status:401});
  try {const leagueId=leagueIdSchema.parse(new URL(request.url).searchParams.get('league')??defaultLeagueId);const raw=await request.text();if(raw.length>150000)return new Response(null,{status:413});return Response.json(await createView(student.subjectId,JSON.parse(raw),leagueId));}
  catch {return Response.json({error:'The view could not be saved. Check its content and evidence links.'},{status:400});}
}
export async function GET(request:Request) {
  const student=await currentSession();if(!student)return new Response(null,{status:401});
  const selected=leagueIdSchema.safeParse(new URL(request.url).searchParams.get('league')??defaultLeagueId);if(!selected.success)return new Response(null,{status:400});
  const id=new URL(request.url).searchParams.get('id'),headers={'Cache-Control':'no-store'};
  if(id&&!z.uuid().safeParse(id).success)return new Response(null,{status:400});
  if(id){const {data,error}=await db().from('preston_views').select('id,title,document,created_at').eq('student_id',student.subjectId).eq('league_id',selected.data).eq('id',id).maybeSingle();return Response.json(error||!data?{error:'View unavailable'}:data,{status:error?503:data?200:404,headers});}
  const {data,error}=await db().from('preston_views').select('id,title,created_at').eq('student_id',student.subjectId).eq('league_id',selected.data).order('created_at',{ascending:false}).limit(50);
  return Response.json(error?{error:'Views unavailable'}:{views:data},{status:error?503:200,headers});
}

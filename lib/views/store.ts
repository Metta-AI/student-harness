import { defaultLeagueId } from "../league-catalog";
import { db } from '../db';
import { createViewSchema } from './model';
export async function createView(student:string,input:unknown,leagueId=defaultLeagueId) {
  const {requestToken,...document}=createViewSchema.parse(input);
  const {data,error}=await db().from('preston_views').insert({student_id:student,league_id:leagueId,title:document.title,document}).select('id').single();
  if(error)throw new Error('Could not save view');
  return {status:'prepared',presentation:{view:'custom',artifactId:data.id,requestToken,last:10,reason:document.title},note:'Saved in the user’s view library. The browser receipt determines whether it is displayed or queued.'};
}

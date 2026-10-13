import {leagueIdSchema} from '../league-catalog';
import {db} from '../db';
import type {UpdateCursor,UpdateInbox} from './inbox';
export async function readUpdateInbox(student:string,cursor?:UpdateCursor,leagueId?:string):Promise<UpdateInbox>{
 let query=db().from('companion_updates').select('id,league_id,task_id,study_id,title,outcome,finding,delivery,decision_reason,created_at,read_at')
  .eq('student_id',student).eq('delivery','inbox').is('dismissed_at',null);
 if(leagueId)query=query.eq('league_id',leagueIdSchema.parse(leagueId));
 // Cursor values are parsed as ISO date and UUID at the HTTP boundary.
 if(cursor)query=query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
 const result=await query.order('created_at',{ascending:false}).order('id',{ascending:false}).limit(51).abortSignal(AbortSignal.timeout(10000));
 if(result.error)throw Error('Updates are unavailable. Please retry.');
 const updates=(result.data??[]).slice(0,50),last=updates.at(-1);
 return {updates,next:result.data.length>50&&last?{createdAt:last.created_at,id:last.id}:null};
}
export async function updateInboxItem(student:string,id:string,action:'read'|'dismiss'){
 const result=await db().from('companion_updates').update(action==='read'?{read_at:new Date().toISOString()}:{dismissed_at:new Date().toISOString()})
  .eq('student_id',student).eq('id',id).eq('delivery','inbox').select('id').abortSignal(AbortSignal.timeout(10000)).maybeSingle();
 if(result.error||!result.data)throw Error('Update not found');
}

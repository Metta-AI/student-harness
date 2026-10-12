import {createHash} from 'node:crypto';
import {sessionControlInput} from './companion-control-input';
import {db} from '../db';
import {controlTask,taskById} from './store';
import type {Task} from './model';

export function controlOperationKey(surface:'voice'|'chat',session:string,callId:string){
 return `${surface}:control:${createHash('sha256').update(JSON.stringify([session,callId])).digest('hex')}`;
}
export function sessionControlSnapshot(task:Task){
 return {taskId:task.id,generation:task.generation,directionRevision:task.direction_revision??0,status:task.status,objective:task.objective,
  directionPending:task.checkpoint?.direction_pending===true,direction:task.checkpoint?.student_note??null,reason:task.reason,
  url:`/sessions/${task.id}`};
}
export class SessionControlConflict extends Error {}
export async function recentSessionControls(student:string,taskId:string){
 const rows=await db().from('task_direction_receipts').select('id,input,result,created_at')
  .eq('student_id',student).eq('task_id',taskId).order('created_at',{ascending:false}).limit(10).abortSignal(AbortSignal.timeout(5000));
 if(rows.error)throw Error('Session control history unavailable');
 return rows.data.map(row=>({id:row.id,action:row.input.action,note:row.input.note,expectedGeneration:row.input.generation,applied:row.result,appliedAt:row.created_at}));
}
export async function controlCompanionSession(student:string,raw:unknown,requestKey:string){
 const input=sessionControlInput.parse(raw);
 try{await controlTask(student,input.taskId,input.action,input.note,{requestKey,generation:input.generation});}
 catch(error){
  if(error instanceof Error&&/^(Task|Campaign) changed;/.test(error.message))throw new SessionControlConflict('The session changed after you inspected it. Read its current state and recent control receipts; do not automatically overwrite the intervening direction.');
  throw error;
 }
 const receipt=await db().from('task_direction_receipts').select('id,task_id,input,result,created_at')
  .eq('student_id',student).eq('task_id',input.taskId).eq('request_key',requestKey).abortSignal(AbortSignal.timeout(5000)).maybeSingle();
 if(receipt.error||!receipt.data)throw Error('Control receipt unavailable. Retry the same operation; do not invent a new request.');
 const current=await taskById(input.taskId,student);if(!current)throw Error('Session snapshot unavailable; the saved control may have completed.');
 const applied=receipt.data.result as {generation:number;directionRevision:number;status:string};
 return {ok:true,receipt:{id:receipt.data.id,action:input.action,note:input.note,appliedAt:receipt.data.created_at,...applied},
  session:sessionControlSnapshot(current),superseded:current.generation!==applied.generation,
  note:'The receipt records the original accepted control; the session is a later snapshot. Already submitted work may finish. Runtime cancellation is cooperative, not proof that an external process stopped.'};
}

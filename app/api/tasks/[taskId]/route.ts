import {NextResponse} from 'next/server';
import {z} from 'zod';
import {currentSession} from '../../../../lib/session';
import {db} from '../../../../lib/db';
export async function GET(_request:Request,{params}:{params:Promise<{taskId:string}>}) {
 const student=await currentSession();
 if(!student)return NextResponse.json({error:'Sign in first'},{status:401});
 const {taskId}=await params;
 if(!z.uuid().safeParse(taskId).success)return NextResponse.json({error:'Session not found'},{status:404});
 try {
  const signal=AbortSignal.timeout(12000);
  const task=await db().from('agent_tasks').select('*').eq('id',taskId).eq('student_id',student.subjectId).abortSignal(signal).maybeSingle();
  if(task.error)throw task.error;
  if(!task.data)return NextResponse.json({error:'Session not found'},{status:404});
  const [usage,workers,history,executions]=await Promise.all([
   db().from('agent_task_usage').select('call_key').eq('task_id',taskId).abortSignal(signal),
   db().from('agent_task_workers').select('*').eq('task_id',taskId).order('updated_at').abortSignal(signal),
   db().from('agent_task_history').select('*').eq('task_id',taskId).order('id').abortSignal(signal),
   db().from('agent_task_executions').select('session_id,generation,model_selection,created_at').eq('task_id',taskId).order('created_at').abortSignal(signal),
  ]);
  for(const result of [usage,workers,history,executions])if(result.error)throw result.error;
  // Budget reservations record every root/child attempt, even when a restart replaces session_id.
  const sessionIds=[...new Set([task.data.session_id,...executions.data!.map(row=>row.session_id),...usage.data!.map(row=>row.call_key.split(':')[0])].filter((id):id is string=>typeof id==='string'&&/^wrun_[a-zA-Z0-9_-]+$/.test(id)))];
  const artifacts=task.data.context?.mode==='audit'?await db().from('research_artifacts').select('id,title,kind').eq('student_id',student.subjectId).eq('task_id',taskId).order('created_at',{ascending:false}).limit(100).abortSignal(signal):{data:[],error:null};
  if(artifacts.error)throw artifacts.error;
  return NextResponse.json({task:task.data,workers:workers.data,history:history.data,executions:executions.data,sessionIds,artifacts:artifacts.data},{headers:{'Cache-Control':'no-store'}});
 }catch(error){console.error('Session history lookup failed',error);return NextResponse.json({error:'Session could not refresh. Try again shortly.'},{status:503});}
}

import type { SessionContext } from 'eve/tools';
import { taskIdentity } from './auth';
import { assertExecution } from '../../../lib/tasks/model';
import { taskById } from '../../../lib/tasks/store';
import { studentToken } from '../../../lib/db';
export async function researchTask(ctx:SessionContext){
 const identity=taskIdentity(ctx.session.auth);
 if(!identity)throw Error('Background task identity required');
 const task=await taskById(identity.taskId,identity.studentId);
 if(!task||task.kind!=='research'||task.generation!==identity.generation)throw Error('Research session is no longer active');
 assertExecution(task,task.execution_key!);
 return {task,token:await studentToken(task.student_id)};
}

/** Publish tool activity without depending on the model remembering to narrate progress. */
export async function researchActivity(ctx:SessionContext,summary:string) {
 const access=await researchTask(ctx);
 const {checkpoint}=await import('../../../lib/tasks/store');
 const previous=access.task.checkpoint.research_progress as Record<string,unknown>|undefined;
 await checkpoint(access.task,access.task.execution_key!,access.task.phase,{research_progress:{...previous,summary}});
 return access;
}

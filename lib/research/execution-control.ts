import {db} from '../db';

/** No permissive fallback: an unavailable control service must not unleash queued work. */
export async function canRunBackground(studentId:string, taskId?:string):Promise<boolean> {
 const {data,error}=await db().rpc('research_execution_allowed',{p_student:studentId,p_task:taskId??null});
 if(error)throw Error('Background research is held until recovery controls can be checked.');
 return data===true;
}
export async function requireBackgroundExecution(studentId:string,taskId?:string) {
 if(!await canRunBackground(studentId,taskId))throw Error('Background research is held. Use recovery controls to resume one session; refilling credits does not restart the backlog.');
}

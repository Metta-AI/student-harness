import {z} from 'zod';
export const sessionControlInput=z.object({
 taskId:z.uuid(),action:z.enum(['pause','resume','steer','cancel']),generation:z.number().int().nonnegative(),
 note:z.string().trim().max(2000).default(''),
}).strict().superRefine((input,ctx)=>{
 if(input.action==='steer'&&!input.note)ctx.addIssue({code:'custom',message:'Include the human’s updated direction or evidence'});
});
export const sessionControlDescription='Pause, resume, redirect (steer), or cancel the specific research session the human asks to change. Read session_status first for its taskId and generation; never guess a target or auto-refresh/retry a conflicting direction. Include the human’s new evidence in note. Steer fences the old worker and requires direction review before further effects; a paused task stays paused. A campaign root controls its descendants. Interrupting speech alone is not a request to cancel research. Existing submitted operations may finish. Report the saved control receipt and current task snapshot separately; a retried old receipt must not be described as a new action.';

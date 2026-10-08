import {readableText} from './communication.ts';
import type {Task} from './model';

export function taskActivity(task:Pick<Task,'status'|'kind'|'checkpoint'|'reason'|'context'>,runtimeStopped=false){
 const reason=task.reason?readableText(task.reason):null;
 const progress=task.checkpoint.research_progress as {summary?:string;nextStep?:string}|undefined;
 const retryAt=typeof task.checkpoint.provider_retry_at==='string'?task.checkpoint.provider_retry_at:null;
 if(task.status==='completed')return {label:'Completed',tone:'normal',summary:'Results and evidence are saved.',retryAt:null};
 if(task.status==='canceled')return {label:'Canceled',tone:'normal',summary:reason??'Work stopped. Saved evidence remains available.',retryAt:null};
 if(task.status==='paused')return {label:'Paused',tone:'normal',summary:'Saved work is ready to resume.',retryAt:null};
 if(task.status==='failed'||task.status==='needs_input')return {label:task.status==='failed'?'Failed':'Needs attention',tone:'attention',summary:reason??'Review the execution details before resuming.',retryAt:null};
 if(runtimeStopped)return {label:'Recovering',tone:'retry',summary:'The last execution stopped. Preston is checking it and will retry from saved work.',retryAt:null};
 if(retryAt)return {label:'Retrying',tone:'retry',summary:'Waiting to retry automatically. Saved work and evidence are retained.',retryAt};
 if(task.status==='queued'&&task.reason&&/error|fail|interrupt|retry|recover|timeout|timed out/i.test(task.reason))return {label:'Retry queued',tone:'retry',summary:'A new execution will continue from saved work.',retryAt:null};
 if(task.status==='queued')return {label:'Queued',tone:'normal',summary:'Waiting for a worker.',retryAt:null};
 if(task.status==='waiting')return {label:task.context?.mode==='campaign'?'Campaign active':task.kind==='research'?'Waiting':'Waiting for game',tone:'normal',summary:reason??(progress?.summary?readableText(progress.summary):null)??'Waiting for the next result.',retryAt:null};
 return {label:'Working',tone:'normal',summary:(progress?.summary?readableText(progress.summary):null)??'Preparing the next step.',retryAt:null};
}

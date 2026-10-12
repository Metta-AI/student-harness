import type {Task} from '../tasks/model';
export type RecoveryControl={held:boolean;allowed_task:string|null;remaining_calls:number;trial_expires_at:string|null};
export function recoveryCandidates(tasks:Task[],now=Date.now()) {
 return tasks.filter(t=>t.kind==='research'&&['queued','paused','needs_input'].includes(t.status)
  &&!['campaign','study','audit','auto','candidate'].includes(t.context?.mode??'')&&t.context?.role!=='candidate'&&Date.parse(t.deadline_at)>now);
}

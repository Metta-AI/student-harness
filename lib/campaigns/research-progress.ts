import type {OpponentProfile} from '../opponents/model';
import type {Task} from '../tasks/model';

/** Research different players first; avoid spending parallel sessions on obsolete versions. */
export function selectResearchOpponents(profiles:OpponentProfile[],limit=3){
 const seen=new Set<string>();
 return [...profiles].filter(p=>!p.own&&p.current!==false).sort((a,b)=>
  (a.rank??Infinity)-(b.rank??Infinity)||Number(!!b.current)-Number(!!a.current)||b.policyLabel.localeCompare(a.policyLabel,undefined,{numeric:true})
 ).filter(p=>{const key=p.playerId??p.policyId;if(seen.has(key))return false;seen.add(key);return true;}).slice(0,limit);
}
export function researchProgress(tasks:(Task|null)[]){
 const completed=tasks.filter(t=>t?.status==='completed').length;
 const working=tasks.filter(t=>t?.status==='running').length;
 const queued=tasks.filter(t=>t?.status==='queued').length;
 const paused=tasks.filter(t=>t&&['paused','needs_input'].includes(t.status)).length;
 return `${completed}/${tasks.length} investigations complete${working?` · ${working} working`:''}${queued?` · ${queued} queued`:''}${paused?` · ${paused} need attention`:''}`;
}

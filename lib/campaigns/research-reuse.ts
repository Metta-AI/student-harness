import {db} from '../db';
import {checked} from './store';
import type {Campaign} from './model';
import type {Task} from '../tasks/model';

/** Reuse version-scoped observations, never an older competitive verdict.
 * Missing provenance is deliberately a cache miss. Fresh own-replay and study
 * reviews still run each cycle, and synthesis reconciles their counterexamples. */
export async function reusableOpponentResearch(c:Campaign,policyId:string,now=Date.now()):Promise<Task|null>{
 const baselineHash=c.checkpoint.baselines?.[0]?.sourceHash;
 const releaseFingerprint=c.checkpoint.release?.fingerprint;
 if(!baselineHash||!releaseFingerprint)return null;
 const rows=checked(await db().from('agent_tasks').select('*')
  .eq('student_id',c.student_id).eq('status','completed').eq('kind','research')
  .eq('context->>campaignId',c.id).eq('context->>leagueId',c.league_id)
  .eq('context->>role','opponent').eq('context->>policyId',policyId)
  .eq('context->>baselineHash',baselineHash).eq('context->>releaseFingerprint',releaseFingerprint)
  .gte('created_at',new Date(now-24*60*60*1000).toISOString())
  .lte('created_at',new Date(now).toISOString())
  .order('created_at',{ascending:false}).limit(10)) as Task[]|null;
 return rows?.find(t=>{
  const r=t.result as {status?:string;summary?:unknown}|null;
  return r?.status==='completed'&&typeof r.summary==='string'&&r.summary.trim().length>0;
 })??null;
}

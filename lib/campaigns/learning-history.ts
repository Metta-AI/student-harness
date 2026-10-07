import {db} from '../db';
import {checked} from './store';
import type {Campaign} from './model';

/** A small index of past decisions; detailed evidence remains in immutable studies.
 * Never include active, reserved, or current-cycle comparisons in model context. */
export async function campaignLearningHistory(c:Campaign){
 const rows=checked(await db().from('research_studies')
  .select('id,task_id,cycle,cohort,state,result,baselineHash:protocol->baseline->>sourceHash,candidateHash:protocol->candidate->>sourceHash,release:protocol->release->>fingerprint,summary:protocol->candidate->>summary,components:protocol->candidate->components')
  .eq('student_id',c.student_id).eq('campaign_id',c.id).lt('cycle',c.cycle)
  .in('state',['completed','invalid']).order('cycle',{ascending:false}).order('created_at',{ascending:false}).limit(20))??[];
 return rows.map(row=>({
  studyId:row.id,sessionUrl:`/sessions/${row.task_id}`,cycle:row.cycle,cycleNumber:row.cycle+1,cohort:row.cohort,state:row.state,
  baselineHash:row.baselineHash,candidateHash:row.candidateHash,release:row.release,
  sameBaseline:row.baselineHash===c.checkpoint.baselines?.[0]?.sourceHash,
  sameRelease:row.release===c.checkpoint.release?.fingerprint,
  summary:typeof row.summary==='string'?row.summary.slice(0,600):'',
  componentIds:Array.isArray(row.components)?row.components.flatMap(p=>p&&typeof p==='object'&&!Array.isArray(p)&&typeof p.id==='string'?[p.id]:[]):[],
  // Infrastructure/compiler failures do not establish competitive effects.
  result:row.state==='invalid'?{invalidReason:row.result?.invalidReason??row.result?.error??'Invalid comparison'}:row.result,
 }));
}

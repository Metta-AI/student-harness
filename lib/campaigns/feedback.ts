import {db} from '../db';
import {artifact,checked} from './store';
import type {Campaign,Outcome,Study} from './model';

/** Only terminal, owned studies become learning material. Invalid studies expose
 * their failure and proposal, never partial competitive comparisons. Reserved or
 * running confirmation outcomes must not leak into candidate construction. */
export async function previousStudyFeedback(c:Campaign){
 const id=c.checkpoint.lastResult?.details?.studyId;
 if(!id)return null;
 const study=checked(await db().from('research_studies').select('*').eq('id',id)
  .eq('student_id',c.student_id).eq('campaign_id',c.id).maybeSingle()) as Study|null;
 if(!study||!['completed','invalid'].includes(study.state)||study.cycle>=c.cycle||!study.result)return null;
 if(study.state==='invalid'){
  const content={studyId:id,cycle:study.cycle,cycleNumber:study.cycle+1,cohort:study.cohort,state:study.state,result:study.result,
   baselineHash:study.protocol.baseline.sourceHash,candidateHash:study.protocol.candidate.sourceHash,
   components:study.protocol.candidate.components,pairs:[],
   guidance:'This study is invalid, not a negative gameplay result. Its exact proposal and failure are preserved for repair. No partial outcomes establish a treatment effect. Repair source or infrastructure first; use a new frozen study and fresh independent confirmation.'};
  const artifactId=await artifact(c.student_id,c.league_id,'study-feedback',`Cycle ${study.cycle+1} ${study.cohort}: invalid study and repair context`,content,{campaignId:c.id,taskId:study.task_id});
  return {artifactId,...content};
 }
 // Session context needs outcomes and evidence links, not every native replay
 // timeline. Read the stored summary without decompressing the full result.
 const attempts=[];
 for(let offset=0;;offset+=500){
  const page=checked(await db().from('research_attempts').select('fixture_id,arm,attempt,result:outcome_summary,evidenceId:receipt->>evidenceId')
   .eq('study_id',id).eq('state','complete').order('attempt',{ascending:true}).order('id').range(offset,offset+499))??[];
  attempts.push(...page);if(page.length<500)break;
 }
 const grouped=new Map<string,Record<string,{result:Omit<Outcome,'evidence'>;evidenceId:string|null}>>();
 for(const a of attempts){
  if(!a.result||a.result.audit!=='verified')continue;
  const pair=grouped.get(a.fixture_id)??{};pair[a.arm]=a;grouped.set(a.fixture_id,pair);
 }
 const pairs=[...grouped].flatMap(([fixtureId,p])=>p.baseline&&p.candidate?[{
  fixtureId,utilityDelta:p.candidate.result.utility-p.baseline.result.utility,
  baseline:{...p.baseline.result,evidence:undefined,evidenceId:p.baseline.evidenceId},
  candidate:{...p.candidate.result,evidence:undefined,evidenceId:p.candidate.evidenceId},
 }]:[]);
 if(pairs.length!==study.protocol.pairs)throw Error('Completed study feedback is missing audited pairs');
 const content={studyId:id,cycle:study.cycle,cycleNumber:study.cycle+1,cohort:study.cohort,result:study.result,
  baselineHash:study.protocol.baseline.sourceHash,candidateHash:study.protocol.candidate.sourceHash,
  components:study.protocol.candidate.components,pairs,
  guidance:'These are previously evaluated examples, not fresh validation. Investigate regressions and unchanged outcomes before choosing another mechanism. A failed batch does not establish which component caused the result. New candidates require new frozen fixtures and independent confirmation.'};
 const artifactId=await artifact(c.student_id,c.league_id,'study-feedback',`Cycle ${study.cycle+1} ${study.cohort}: comparison and counterexamples`,content,{campaignId:c.id,taskId:study.task_id});
 return {artifactId,...content};
}

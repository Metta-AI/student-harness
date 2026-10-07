import {db} from '../db';
import {checked,artifact,campaignById} from './store';
import {hashObject,type Study} from './model';

type Selection={outcome?:'all'|'improved'|'regressed'|'unchanged';offset?:number;limit?:number};
type Attempt={fixture_id:string;arm:'baseline'|'candidate';episode_id:string;evidenceId:string;result:any};
const numeric=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)?value:null;
const metricKeys=['deaths','xp','hits','gold','ticks','buyCommands','useCommands','buybackCommands'] as const;

function subject(attempt:Attempt,study:Study){
 const o=attempt.result,n=o?.evidence?.native,s=n?.simulation,slot=n?.vm?.subject;
 if(o?.audit!=='verified'||!attempt.evidenceId||o.episodeId!==attempt.episode_id||n?.kind
  ||n?.release!==study.protocol.release.fingerprint||n?.vm?.source_hash!==study.protocol[attempt.arm].sourceHash
  ||s?.hash_mismatches!==0||!Number.isInteger(s?.ticks)||s.ticks<=0||n.vm.validated_hashes!==s.ticks
  ||!Number.isInteger(slot)||slot<0||slot>9||o.evidence.slot!==slot)throw Error('Study analysis requires exact verified subject receipts');
 if(![-1,0,1].includes(s.winner)||o.utility!==(s.winner<0?0.5:Number(s.winner===Math.floor(slot/5))))throw Error('Study utility does not match native outcome');
 const hero=s.heroes?.find((h:any)=>h.slot===slot);
 if(!hero)throw Error('Audited subject is missing from replay evidence');
 const actions=Array.isArray(s.item_actions)?s.item_actions:null;
 // The sparse ledger is specific to the decoder subject. Incomplete ledgers
 // remain unknown, never zero; counts are requests, not accepted effects.
 const complete=!!actions&&s.subject===slot&&Number.isInteger(s.item_action_count)&&s.item_action_count===actions.length;
 const count=(kinds:string[])=>complete?actions!.filter((a:any)=>kinds.includes(a.kind)).length:null;
 return {episodeId:attempt.episode_id,evidenceId:attempt.evidenceId,slot,
  heroClass:typeof hero.class_name==='string'?hero.class_name:`class ${hero.class}`,
  utility:o.utility,metrics:{deaths:numeric(hero.deaths),xp:numeric(hero.xp),hits:numeric(hero.hits),gold:numeric(hero.gold),ticks:s.ticks,
   buyCommands:count(['buy_item']),useCommands:count(['use_item','use_item_at']),buybackCommands:count(['buyback'])},
  commandLedgerComplete:complete};
}

/** Deterministic descriptive analysis of an entire completed paired study.
 * Filtering/pagination never alters the full-study summaries or decision. */
export function analyzeStudy(study:Study,attempts:Attempt[],selection:Selection={}){
 if(study.state!=='completed'||!study.result)throw Error('Only completed studies are available for behavior analysis');
 if(hashObject(study.protocol)!==study.protocol_hash)throw Error('Frozen study protocol hash mismatch');
 const grouped=new Map<string,Partial<Record<Attempt['arm'],ReturnType<typeof subject>>>>();
 for(const a of attempts){
  if(!['baseline','candidate'].includes(a.arm))throw Error('Unknown study arm');
  const pair=grouped.get(a.fixture_id)??{};
  if(pair[a.arm])throw Error('Duplicate completed study arm');
  pair[a.arm]=subject(a,study);grouped.set(a.fixture_id,pair);
 }
 if(grouped.size!==study.protocol.pairs||attempts.length!==study.protocol.pairs*2)throw Error('Completed study is missing audited pairs');
 const pairs=[...grouped].sort(([a],[b])=>a.localeCompare(b)).map(([fixtureId,p])=>{
  if(!p.baseline||!p.candidate||p.baseline.slot!==p.candidate.slot)throw Error('Completed study has an incomplete or mismatched pair');
  const delta=p.candidate.utility-p.baseline.utility;
  if(!Number.isFinite(delta))throw Error('Study utility is unavailable');
  return {fixtureId,outcome:delta>0?'improved':delta<0?'regressed':'unchanged',utilityDelta:delta,
   classPair:`${p.baseline.heroClass} → ${p.candidate.heroClass}`,baseline:p.baseline,candidate:p.candidate};
 });
 const summarize=(rows:typeof pairs)=>({pairs:rows.length,improved:rows.filter(p=>p.outcome==='improved').length,
  regressed:rows.filter(p=>p.outcome==='regressed').length,
  metrics:Object.fromEntries(metricKeys.map(key=>{
   const covered=rows.filter(p=>p.baseline.metrics[key]!==null&&p.candidate.metrics[key]!==null);
   const mean=(arm:'baseline'|'candidate')=>covered.length?covered.reduce((sum,p)=>sum+p[arm].metrics[key]!,0)/covered.length:null;
   const baseline=mean('baseline'),candidate=mean('candidate');
   const meanDelta=covered.length?covered.reduce((sum,p)=>sum+p.candidate.metrics[key]!-p.baseline.metrics[key]!,0)/covered.length:null;
   return [key,{pairedCoverage:covered.length,baselineMean:baseline,candidateMean:candidate,meanDelta}];
  }))});
 const groups=(key:'classPair'|'outcome')=>[...new Set(pairs.map(p=>p[key]))].sort().map(value=>({group:value,...summarize(pairs.filter(p=>p[key]===value))}));
 const matched=pairs.filter(p=>!selection.outcome||selection.outcome==='all'||p.outcome===selection.outcome);
 const offset=Math.max(0,selection.offset??0),limit=Math.min(20,Math.max(1,selection.limit??10));
 return {analysisVersion:1,studyId:study.id,cycle:study.cycle,cycleNumber:study.cycle+1,cohort:study.cohort,release:study.protocol.release,
  baselineHash:study.protocol.baseline.sourceHash,candidateHash:study.protocol.candidate.sourceHash,
  decision:study.result,all:summarize(pairs),byHeroClass:groups('classPair'),byOutcome:groups('outcome'),
  pairs:matched.slice(offset,offset+limit),matchedPairs:matched.length,nextOffset:offset+limit<matched.length?offset+limit:null,
  interpretation:'Descriptive comparisons of completed training evidence, not a new experiment or causal attribution. Final gold is unspent gold, not earned gold. Item/use/buyback counts are recorded commands, not proof of acceptance, damage or benefit. Missing/truncated/wrong-subject command ledgers have null metrics and explicit paired coverage. Outcome-selected groups are diagnostic and cannot estimate an independent treatment effect. Full-study summaries and the frozen decision never change with the page/filter.'};
}

export async function completedStudyAnalysis(studentId:string,leagueId:string,studyId:string,selection:Selection={},taskId?:string){
 const study=checked(await db().from('research_studies').select('*').eq('id',studyId).eq('student_id',studentId).maybeSingle()) as Study|null;
 if(!study||study.state!=='completed')throw Error('Only completed owned studies are available for behavior analysis');
 const campaign=await campaignById(study.campaign_id,studentId);
 if(!campaign||campaign.league_id!==leagueId)throw Error('Study is not in this league');
 const attempts:Attempt[]=[];
 // Native evidence includes large timelines. Bound each response and retain only
 // the fields used below so a long confirmation cannot overload the DB or heap.
 const pageSize=8;
 for(let offset=0;;offset+=pageSize){
  const page=checked(await db().from('research_attempts').select('fixture_id,arm,episode_id,result,evidenceId:receipt->>evidenceId')
   .eq('study_id',study.id).eq('state','complete').order('id').range(offset,offset+pageSize-1)) as Attempt[];
  for(const a of page){
   const o=a.result,e=o?.evidence,n=e?.native,s=n?.simulation;
   attempts.push({...a,result:{audit:o?.audit,episodeId:o?.episodeId,utility:o?.utility,evidence:{slot:e?.slot,native:{
    kind:n?.kind,release:n?.release,vm:n?.vm,simulation:{ticks:s?.ticks,winner:s?.winner,hash_mismatches:s?.hash_mismatches,
     subject:s?.subject,heroes:s?.heroes,item_action_count:s?.item_action_count,item_actions:s?.item_actions},
   }}}});
  }
  if(page.length<pageSize)break;
 }
 const report=analyzeStudy(study,attempts,selection);
 const artifactId=await artifact(studentId,leagueId,'study-analysis',`Completed ${study.cohort} behavior comparison · cycle ${study.cycle+1}`,report,
  {campaignId:study.campaign_id,taskId,provenance:{studyId:study.id,protocolHash:study.protocol_hash}});
 return {artifactId,...report};
}

import {db} from '../db';
import {defaultLeagueId,leagueIdSchema} from '../league-catalog';
import {learningAvailable as availableInLeague} from './learning-availability';
import {learningMutationSchema,learningToolSchema,learningContract,type LearningEvidence,type LearningDetail,type LearningEntryDetail,type LearningEntry,type LearningStudy,type EvidenceSnapshot,type StudyResearch} from './learning';

export function learningAvailable(leagueId:string){return availableInLeague(leagueId,process.env.GENERIC_LEARNING_ENABLED==='1');}
function scope(leagueId:string){leagueIdSchema.parse(leagueId);if(!learningAvailable(leagueId))throw Error('Shared learning is not enabled for this league');return leagueId;}
const eventScope=(leagueId:string)=>leagueId===defaultLeagueId?`payload->>leagueId.is.null,payload->>leagueId.eq.${leagueId}`:`payload->>leagueId.eq.${leagueId}`;
const studyHref=(id:string,leagueId:string)=>`/learn/${id}${leagueId===defaultLeagueId?'':`?leagueId=${encodeURIComponent(leagueId)}`}`;
type HumanObservation={actor:'human';text:string;phase:string;createdAt:string};
type ObservationCorrections={ids:string[];latestId:string|null;latestObservation?:HumanObservation;observationOmitted?:string;truncated:boolean};
const observationProjection=(row:Record<string,unknown>):HumanObservation=>({actor:'human',text:String(row.text),phase:String(row.phase??''),createdAt:String(row.created_at)});
// Walk identifiers only, with a shared read/deadline budget across every referenced
// observation. A tail is current only after a scoped read finds no successor.
async function observationCorrections(student:string,leagueId:string,ids:string[]){
 const result=new Map<string,ObservationCorrections>(),signal=AbortSignal.timeout(10000);
 let frontier=ids.map(id=>({root:id,tail:id,ids:[id]})),reads=0;
 while(frontier.length&&reads<10){
  const next:typeof frontier=[];
  for(let offset=0;offset<frontier.length;offset+=80){
   const batch=frontier.slice(offset,offset+80);
   if(reads>=10){next.push(...frontier.slice(offset));break;}
   reads++;
   const r=await db().from('replay_observations').select('id,supersedes,student_id,league_id').eq('student_id',student).eq('league_id',leagueId).in('supersedes',[...new Set(batch.map(n=>n.tail))]).limit(81).abortSignal(signal);
   if(r.error)throw Error('Evidence corrections could not be checked');
   for(const node of batch){
    const children=r.data.filter(row=>row.supersedes===node.tail&&row.student_id===student&&row.league_id===leagueId);
    const child=children[0];
    const truncated=r.data.length>=81||children.length>1||Boolean(child&&node.ids.includes(child.id));
    if(truncated||!child){
     if(node.ids.length>1||truncated)result.set(node.root,{ids:node.ids,latestId:truncated?null:node.tail,truncated});
    }else next.push({...node,tail:child.id,ids:[...node.ids,child.id]});
   }
  }
  frontier=next;
 }
 for(const node of frontier)result.set(node.root,{ids:node.ids,latestId:null,truncated:true});
 // Twelve notes is the exact-entry evidence bound; do not materialize all texts
 // from a large history page or any intermediate correction bodies.
 const latestIds=[...new Set([...result.values()].flatMap(c=>c.latestId?[c.latestId]:[]))].slice(0,12);
 if(latestIds.length){
  const r=await db().from('replay_observations').select('id,text,phase,created_at,student_id,league_id').eq('student_id',student).eq('league_id',leagueId).in('id',latestIds).limit(12).abortSignal(signal);
  if(r.error)throw Error('Latest human corrections could not be read');
  for(const chain of result.values())if(chain.latestId){
   const row=r.data.find(row=>row.id===chain.latestId&&row.student_id===student&&row.league_id===leagueId);
   if(row&&typeof row.text==='string')chain.latestObservation=observationProjection(row);
   else chain.observationOmitted='Latest correction text was not included in this bounded read; open its replay observation';
  }
 }
 return result;
}

export async function listLearningStudies(student:string,evidence?:LearningEvidence,leagueId=defaultLeagueId){
 scope(leagueId);
 let query=db().from('learning_studies').select('*').eq('student_id',student).eq('league_id',leagueId).order('updated_at',{ascending:false}).limit(50);
 // Filter before the bound: an older anchored study must not disappear behind unrelated studies.
 if(evidence)query=query.contains('anchors',[{kind:evidence.kind,id:evidence.id}]);
 const r=await query;
 if(r.error)throw Error(r.error.message);return {studies:r.data as LearningStudy[],limited:r.data.length===50};
}
async function evidenceAvailability(student:string,refs:EvidenceSnapshot[],leagueId:string,detailBudget:number){
 const kinds=[...new Set(refs.map(r=>r.kind))];const status=new Map<string,string>();const observations=new Map<string,HumanObservation>();let corrections=new Map<string,ObservationCorrections>();
 await Promise.all(kinds.map(async kind=>{
  const ids=[...new Set(refs.filter(r=>r.kind===kind).map(r=>r.id))];
  const generic=['replay_observation','container_revision','practice'].includes(kind);
  if(!generic&&leagueId!==defaultLeagueId)return;
  const table={desktop_moment:'desktop_moments',frame:'desktop_replay_frames',moment:'research_events',revision:'policy_versions',experiment:'experiments',replay_observation:'replay_observations',container_revision:'container_policy_revisions',practice:'container_policy_practices'}[kind];
  const columns={desktop_moment:'id,revision,withdrawn_at',frame:'id,expires_at',moment:'id',revision:'id',experiment:'xp_request_id,status',replay_observation:'id,text,phase,created_at',container_revision:'id',practice:'id,result'}[kind];
  const rows:Record<string,unknown>[]=[];
  for(let offset=0;offset<ids.length;offset+=80){
   let q=db().from(table).select(columns).eq('student_id',student).in(kind==='experiment'?'xp_request_id':'id',ids.slice(offset,offset+80));
   if(generic)q=q.eq('league_id',leagueId);
   if(kind==='moment')q=q.or(eventScope(leagueId));
   const r=await q;
   if(r.error)throw Error('Evidence availability could not be checked');
   rows.push(...r.data as unknown as Record<string,unknown>[]);
  }
  for(const ref of refs.filter(r=>r.kind===kind)){
   const row=rows.find(r=>(r.id??r.xp_request_id)===ref.id);
   if(kind==='replay_observation'&&row&&typeof row.text==='string')observations.set(ref.id,observationProjection(row));
   status.set(`${kind}:${ref.id}:${ref.revision??''}`,!row||kind==='practice'&&!(row.result as {terminal?:boolean}|null)?.terminal?'unavailable':row.withdrawn_at?'withdrawn':row.expires_at&&Date.parse(String(row.expires_at))<=Date.now()?'expired':kind==='desktop_moment'&&row.revision!==ref.revision?'corrected':'available');
  }
  if(kind==='replay_observation'){
   corrections=await observationCorrections(student,leagueId,ids.filter(id=>observations.has(id)));
   for(const [id,chain] of corrections)status.set(`${kind}:${id}:`,chain.ids.length>1?'superseded':'unknown');
  }
  if(kind==='moment'){
   for(let offset=0;offset<ids.length;offset+=80){
    let q=db().from(kind==='moment'?'research_events':'replay_observations').select('supersedes').eq('student_id',student).in('supersedes',ids.slice(offset,offset+80)).limit(80);
    q=kind==='moment'?q.or(eventScope(leagueId)):q.eq('league_id',leagueId);
    const replacements=await q;
    if(replacements.error)throw Error('Evidence corrections could not be checked');
    for(const r of replacements.data)status.set(`${kind}:${r.supersedes}:`,'superseded');
   }
  }
 }));
 // Original immutable human text is an attributed read projection, never rewritten into the saved snapshot.
 // Keep whole observations; exact entry reads can retrieve details omitted from a large history page.
 let remaining=detailBudget;
 return (r:EvidenceSnapshot)=>{
  const observation=r.kind==='replay_observation'?observations.get(r.id):undefined;
  const size=observation?JSON.stringify(observation).length:0;
  const include=Boolean(observation&&size<=remaining);if(include)remaining-=size;
  const chain=r.kind==='replay_observation'?corrections.get(r.id):undefined;
  const correctionSize=chain?.latestObservation?JSON.stringify(chain.latestObservation).length:0;
  const includeCorrection=correctionSize<=remaining;if(includeCorrection)remaining-=correctionSize;
  const {latestObservation,...chainMetadata}=chain??{};
  return {...r,availability:status.get(`${r.kind}:${r.id}:${r.revision??''}`)??'unavailable',...(include?{observation}:observation?{observationOmitted:'Read the exact study entry for the original human observation'}:{}),...(chain?{corrections:{...chainMetadata,...(latestObservation?(includeCorrection?{latestObservation}:{observationOmitted:'Read the exact study entry for the latest human correction'}):{})}}:{})};
 };
}
export async function readLearningStudy(student:string,id:string,before?:number,leagueId=defaultLeagueId):Promise<LearningDetail|null>{
 scope(leagueId);
 const s=await db().from('learning_studies').select('*').eq('student_id',student).eq('league_id',leagueId).eq('id',id).maybeSingle();
 if(s.error)throw Error(s.error.message);if(!s.data)return null;
 let query=db().from('research_events').select('id,sequence,actor,created_at,supersedes,payload').eq('student_id',student).eq('payload->>studyId',id).or(eventScope(leagueId)).order('sequence',{ascending:false}).limit(51);
 if(before)query=query.lt('sequence',before);
 const r=await query;if(r.error)throw Error(r.error.message);
 const hasMore=r.data.length>50;const entries=r.data.slice(0,50).reverse() as LearningEntry[];
 const study=s.data as LearningStudy;
 const result=await projectLearningEntries(student,entries,leagueId,study.anchors);
 return {study:{...study,anchors:result.anchors},entries:result.entries,hasMore,nextBefore:hasMore?entries[0].sequence:null,contract:learningContract};
}
async function projectLearningEntries(student:string,entries:LearningEntry[],leagueId:string,anchors:EvidenceSnapshot[]=[],detailBudget=12000){
 const ids=entries.map(e=>e.id);
 const replaced=ids.length?await db().from('research_events').select('id,supersedes').eq('student_id',student).or(eventScope(leagueId)).in('payload->>studyId',[...new Set(entries.map(e=>e.payload.studyId))]).in('supersedes',ids).limit(50):{data:[],error:null};
 if(replaced.error)throw Error(replaced.error.message);
 const replacedIds=new Set(replaced.data.map(r=>r.supersedes));
 const project=await evidenceAvailability(student,[...anchors,...entries.flatMap(e=>e.payload.learningEvidence??[])],leagueId,detailBudget);
 return {anchors:anchors.map(project),entries:entries.map(e=>({...e,isCurrent:!replacedIds.has(e.id),correctedBy:replaced.data.find(r=>r.supersedes===e.id)?.id??null,payload:{studyId:e.payload.studyId,entryType:e.payload.entryType,text:e.payload.text,input:e.payload.input,learningEvidence:(e.payload.learningEvidence??[]).map(project)}}))};
}
export async function readLearningEntry(student:string,studyId:string,entryId:string,leagueId=defaultLeagueId):Promise<LearningEntryDetail|null>{
 scope(leagueId);
 const study=await db().from('learning_studies').select('id').eq('student_id',student).eq('league_id',leagueId).eq('id',studyId).maybeSingle();
 if(study.error)throw Error('Study could not be read');if(!study.data)return null;
 const row=await db().from('research_events').select('id,sequence,actor,created_at,supersedes,payload').eq('student_id',student).eq('payload->>studyId',studyId).or(eventScope(leagueId)).eq('id',entryId).limit(1).maybeSingle();
 if(row.error)throw Error('Study entry could not be read');if(!row.data)return null;
 const result=await projectLearningEntries(student,[row.data as LearningEntry],leagueId,[],52000);
 return {entry:result.entries[0],contract:learningContract,href:`/learn/${studyId}/entries/${entryId}${leagueId===defaultLeagueId?'':`?leagueId=${encodeURIComponent(leagueId)}`}`};
}
export async function writeLearning(student:string,actor:'human'|'preston',input:unknown,leagueId=defaultLeagueId,voiceSession?:string){
 scope(leagueId);
 const p=learningMutationSchema.parse(input);
 if(voiceSession&&(actor!=='preston'||!['create','append','experiment'].includes(p.action)))throw Error('Voice may only record Preston’s study entries or propose a GoTA experiment');
 if((p.action==='experiment'||p.action==='experiment_control')&&leagueId!==defaultLeagueId)throw Error('Study experiments require the GoTA adapter; attach a completed hosted practice as evidence instead');
 if(p.action==='control'&&actor!=='human')throw Error('Only the human controls study mode and closure');
 if(p.action==='experiment_control'&&actor!=='human')throw Error('Only the human controls study experiments');
 const r=voiceSession?await db().rpc('learning_voice_write',{p_student:student,p_session:voiceSession,p_league:leagueId,p_key:p.requestKey,p_action:p.action,p_study:p.action==='create'?null:p.studyId,p_input:p.action==='create'?p.study:p.action==='append'?p.entry:p.action==='experiment'?p.experiment:null}):p.action==='experiment'?await db().rpc('learning_propose_experiment',{p_student:student,p_actor:actor,p_key:p.requestKey,p_study:p.studyId,p_input:p.experiment}):p.action==='experiment_control'?await db().rpc('learning_control_experiment',{p_student:student,p_study:p.studyId,p_plan:p.planId,p_action:p.command,p_key:p.requestKey}):await db().rpc(leagueId===defaultLeagueId?'learning_write':'learning_write_scoped',{p_student:student,...(leagueId===defaultLeagueId?{}:{p_league:leagueId}),p_actor:actor,p_key:p.requestKey,p_action:p.action,p_study:p.action==='create'?null:p.studyId,p_input:p.action==='create'?p.study:p.action==='append'?p.entry:p.control});
 if(r.error)throw Error(r.error.message);return {...r.data,href:studyHref(r.data.studyId,leagueId)};
}
export async function learningTool(student:string,input:unknown,key:string,leagueId=defaultLeagueId,voiceSession?:string){
 scope(leagueId);
 const p=learningToolSchema.parse(input);
 if(p.action==='list'){const r=await listLearningStudies(student,p.evidence,leagueId);return {limited:r.limited,studies:r.studies.map(s=>({id:s.id,questionPreview:s.question.slice(0,240),mode:s.mode,status:s.status,leagueId:s.league_id,href:studyHref(s.id,leagueId)}))};}
 if(p.action==='read'){
  if(p.entryId)return await readLearningEntry(student,p.studyId!,p.entryId,leagueId)??{error:'Study entry not found'};
  const detail=await readLearningStudy(student,p.studyId!,p.before,leagueId);if(!detail)return {error:'Study not found'};
  // Keep whole entries and a cursor rather than truncating reasoning or evidence.
  while(JSON.stringify(detail).length>24000&&detail.entries.length>1){detail.entries.shift();detail.hasMore=true;detail.nextBefore=detail.entries[0].sequence;}
  const research=await readStudyResearch(student,p.studyId!,leagueId);
  return {...detail,research:{cycles:research.cycles.map(c=>({...c,question:c.question.slice(0,160)})),experiments:research.experiments.slice(0,5).map(e=>({...e,plan:{...e.plan,objective:e.plan.objective.slice(0,240)}})),moreExperiments:research.experiments.length>5}};
 }
 return writeLearning(student,'preston',p.action==='create'?{...p,study:{...p.study,mode:'explore'},requestKey:key}:{...p,requestKey:key},leagueId,voiceSession);
}

export async function readStudyResearch(student:string,id:string,leagueId=defaultLeagueId):Promise<StudyResearch>{
 scope(leagueId);
 const s=await db().from('learning_studies').select('id,cycle_id').eq('student_id',student).eq('league_id',leagueId).eq('id',id).maybeSingle();
 if(s.error||!s.data)throw Error('Study not found');
 if(leagueId!==defaultLeagueId)return {cycles:[],experiments:[]};
 let cq=db().from('research_cycles').select('id,question,active_version_id,state,autonomy,expires_at,call_limit,calls_allocated,game_limit,games_allocated').eq('student_id',student).neq('state','closed').order('created_at',{ascending:false}).limit(30);
 if(s.data.cycle_id)cq=cq.eq('id',s.data.cycle_id);
 const [cycles,links]=await Promise.all([s.data.cycle_id?cq:Promise.resolve({data:[],error:null}),db().from('learning_experiments').select('plan_id,prediction_id,base_version_id,actor,created_at').eq('student_id',student).eq('study_id',id).order('created_at',{ascending:false}).limit(20)]);
 if(cycles.error||links.error)throw Error('Study experiments could not be loaded');
 if(!links.data.length)return {cycles:cycles.data,experiments:[]};
 const plans=await db().from('research_plans').select('id,objective,mode,status,task_id,max_calls').eq('student_id',student).in('id',links.data.map(l=>l.plan_id));
 if(plans.error)throw Error('Experiment plans could not be loaded');
 const ids=plans.data.flatMap(p=>p.task_id?[p.task_id]:[]);
 const tasks=ids.length?await db().from('agent_tasks').select('id,status,reason,games_requested,model_calls').eq('student_id',student).in('id',ids):{data:[],error:null};
 if(tasks.error)throw Error('Experiment progress could not be loaded');
 return {cycles:cycles.data,experiments:links.data.flatMap(l=>{const plan=plans.data.find(p=>p.id===l.plan_id);return plan?[{...l,plan,task:tasks.data.find(t=>t.id===plan.task_id)??null}]:[];})};
}

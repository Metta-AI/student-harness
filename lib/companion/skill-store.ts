import {db} from '../db';
import {queryWords} from './context';
import {skillMutationSchema,skillToolSchema,skillContract,type LearnedSkill,type SkillVersion,type SkillTrial,type SkillDetail} from './skills';
export async function listSkills(student:string,query=''){
 let q=db().from('companion_skills').select('id,title,revision,status,active_version,latest_version,updated_at').eq('student_id',student).order('updated_at',{ascending:false}).limit(50);
 const words=queryWords(query);if(words.length)q=q.or(words.map(w=>`title.ilike.%${w}%`).join(','));
 const r=await q;if(r.error)throw Error('Skills could not be loaded');return r.data as LearnedSkill[];
}
export async function readSkill(student:string,id:string):Promise<SkillDetail|null>{
 const root=await db().from('companion_skills').select('*').eq('student_id',student).eq('id',id).maybeSingle();
 if(root.error)throw Error('Skill could not be loaded');if(!root.data)return null;
 const [versions,trials]=await Promise.all([
  db().from('companion_skill_versions').select('id,number,actor,content,created_at').eq('student_id',student).eq('skill_id',id).order('number',{ascending:false}).limit(20),
  db().from('companion_skill_trials').select('id,version_id,actor,outcome,observation,evidence,created_at').eq('student_id',student).eq('skill_id',id).order('sequence',{ascending:false}).limit(50),
 ]);
 if(versions.error||trials.error)throw Error('Skill history could not be loaded');
 const trialRows=trials.data as SkillTrial[];
 if(trialRows.length){
  const sources=await db().from('companion_task_procedure_trials').select('trial_id,task_id,generation').eq('student_id',student).in('trial_id',trialRows.map(t=>t.id)).limit(50);
  if(sources.error)throw Error('Trial attribution could not be loaded');
  for(const trial of trialRows){const source=sources.data.find(s=>s.trial_id===trial.id);if(source)trial.source={taskId:source.task_id,generation:source.generation};}
 }
 const skill=root.data as LearnedSkill;let usable=false,reason='This procedure is not active.';
 if(skill.status==='active'&&skill.active_version){
  const current=await db().rpc('companion_skill_available',{p_student:student,p_version:skill.active_version});
  if(current.error)throw Error('Skill evidence could not be checked');usable=current.data===true;
  reason=usable?'Human-activated procedure; confirm its stated scope before use.':'Source evidence changed, or the latest trial is inconclusive, failed or unavailable. Review before reuse.';
 }
 return {skill,versions:versions.data as SkillVersion[],trials:trialRows,availability:{usable,reason},contract:skillContract};
}
export async function readTaskProcedure(task:{id:string;student_id:string;generation:number;execution_key:string|null},skill:string,key:string){
 const r=await db().rpc('companion_task_read_procedure',{p_task:task.id,p_student:task.student_id,p_generation:task.generation,p_execution:task.execution_key,p_skill:skill,p_key:key});
 if(r.error)throw Error('Procedure read could not be recorded; refresh task and procedure state before retrying');
 return {...r.data,contract:skillContract,trialInstructions:'If you actually apply this version, optionally assess it in the final procedureTrials using readReceipt.id and inspected evidence. A read receipt proves delivery of the procedure, not that it was followed or succeeded. Completion records or rejects each trial; do not claim it was saved before checking that receipt.'};
}
export async function writeSkill(student:string,actor:'human'|'preston',input:unknown){
 const p=skillMutationSchema.parse(input);if(p.action==='control'&&actor!=='human')throw Error('Only the human controls learned skills');
 const {requestKey,...operation}=p;
 const r=await db().rpc('companion_skill_write',{p_student:student,p_actor:actor,p_key:requestKey,p_input:operation});
 if(r.error)throw Error(r.error.message);return {...r.data,href:`/skills/${r.data.skillId}`};
}
export async function learnedSkillTool(student:string,input:unknown,key:string){
 const p=skillToolSchema.parse(input);
 if(p.action==='discover'){
  const r=await db().rpc('companion_discover_procedures',{p_student:student,p_query:p.query!,p_limit:p.limit});
  if(r.error)throw Error('Procedure discovery unavailable; retry without assuming the library is empty');
  return {...r.data,contract:skillContract};
 }
 if(p.action==='list')return {skills:await listSkills(student,p.query),contract:skillContract};
 if(p.action==='read'){
  const detail=await readSkill(student,p.skillId!);if(!detail)return {error:'Skill not found'};
  const {versions,trials,...rest}=detail;
  return {...rest,active:versions.find(v=>v.id===detail.skill.active_version)??null,latest:versions[0],history:versions.map(v=>({id:v.id,number:v.number,actor:v.actor})),recentTrials:trials.slice(0,5)};
 }
 return writeSkill(student,'preston',p.action==='propose'?{action:p.action,requestKey:key,skillId:p.skillId,baseVersionId:p.baseVersionId,procedure:p.procedure}:{action:p.action,requestKey:key,skillId:p.skillId,trial:p.trial});
}

export type SkillLesson={id:string;text:string;studyId:string;actor:string;evidence:{kind:string;id:string}[]};
export async function skillLessons(student:string):Promise<SkillLesson[]>{
 const r=await db().from('research_memory').select('id,actor,payload').eq('student_id',student).eq('payload->>entryType','lesson').order('sequence',{ascending:false}).limit(50);
 if(r.error)throw Error('Working lessons could not be loaded');
 return r.data.map(e=>({id:e.id,actor:e.actor,text:String(e.payload.text),studyId:String(e.payload.studyId),evidence:(e.payload.learningEvidence??[]).map((r:{kind:string;id:string})=>({kind:r.kind,id:r.id}))}));
}

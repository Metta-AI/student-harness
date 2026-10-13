import {z} from 'zod';
import {db} from '../db';
import {defaultLeagueId,leagueIdSchema} from '../league-catalog';
import {readUpdateInbox} from './inbox-store';
import {readCompanionEvidence} from './evidence-store';
import {readLearningEntry} from './learning-store';
import {findingContract,findingToolInput,findingPresentation,type FindingDetail} from './findings';
import type {CompanionUpdate} from './responsibilities';

export async function readFinding(student:string,id:string,page:{offset?:number;digest?:string}={},expectedLeague?:string):Promise<FindingDetail|null>{
 if(!student)throw Error('Sign in first');
 const p=findingToolInput.parse({action:'read',id,...page}),signal=AbortSignal.timeout(10000);
 // Dismissal only hides an inbox row. Its permanent link remains owner-readable.
 // Deferred updates are not available until the attention policy releases them.
 let query=db().from('companion_updates').select('id,league_id,task_id,study_id,event_key,title,outcome,finding,created_at')
  .eq('student_id',student).eq('id',p.id!).eq('delivery','inbox');
 if(expectedLeague)query=query.eq('league_id',leagueIdSchema.parse(expectedLeague));
 const row=await query.limit(1).abortSignal(signal).maybeSingle();
 if(row.error)throw Error('Finding unavailable. Please retry.');if(!row.data)return null;
 const update=row.data as CompanionUpdate&{event_key:string};
 const leagueId=leagueIdSchema.parse(update.league_id??defaultLeagueId);
 const scopeQuery=`?${new URLSearchParams({leagueId})}`;
 const [source,entries]=await Promise.all([
  db().from('research_events').select('id,freshness:payload->resultSnapshot->>freshness,followup:payload->resultSnapshot->value->nextExperimentReceipt')
   .eq('student_id',student).eq('event_key',`companion-${update.event_key}`).limit(1).abortSignal(signal).maybeSingle(),
  update.study_id?db().from('research_events').select('id').eq('student_id',student).eq('payload->>studyId',update.study_id)
   .in('event_key',[`learning-result:${update.task_id}`,`learning-debrief:${update.task_id}`])
   .eq('created_at',update.created_at).order('sequence').limit(2).abortSignal(signal):Promise.resolve({data:[],error:null}),
 ]);
 if(source.error||entries.error)throw Error('Finding evidence unavailable. Please retry.');
 const [original,linked]=await Promise.all([
  source.data?readCompanionEvidence(student,{eventId:source.data.id,leagueId,view:'history',offset:p.offset,digest:p.digest}):Promise.resolve(null),
  Promise.all((entries.data??[]).map(e=>readLearningEntry(student,update.study_id!,e.id,leagueId))),
 ]);
 // Preserve the human's original position beside the returned assessment. A
 // correction to that prediction must not masquerade as Preston changing its
 // debrief, or disappear because only recent study entries are loaded.
 const predictionIds=[...new Set(linked.flatMap(detail=>{
  const id=z.uuid().safeParse(detail?.entry.payload.input.predictionId);return id.success?[id.data]:[];
 }))];
 const predictions=await Promise.all(predictionIds.map(id=>readLearningEntry(student,update.study_id!,id,leagueId)));
 return {presentation:findingPresentation(update),contract:findingContract,work:{id:update.task_id,href:`/sessions/${update.task_id}`},
  study:update.study_id?{id:update.study_id,href:`/learn/${update.study_id}${scopeQuery}`}:null,
  entries:[...predictions,...linked].flatMap(detail=>detail?[{id:detail.entry.id,href:detail.href,label:detail.entry.payload.entryType==='prediction'?'Original prediction':detail.entry.payload.entryType==='debrief'?'Preston’s debrief':'Experiment receipt',text:detail.entry.payload.text,
   actor:detail.entry.actor,createdAt:detail.entry.created_at,evidence:detail.entry.payload.learningEvidence,correctedBy:detail.entry.correctedBy??null,correctionHref:detail.entry.correctedBy?`/learn/${update.study_id}/entries/${detail.entry.correctedBy}${scopeQuery}`:null}]:[]),
  source:original,reportFreshness:typeof source.data?.freshness==='string'?source.data.freshness:null,followUp:source.data?.followup??null};
}

export async function companionFinding(student:string,input:unknown,leagueId=defaultLeagueId){
 const p=findingToolInput.parse(input);
 leagueId=leagueIdSchema.parse(leagueId);
 if(p.action==='read')return await readFinding(student,p.id!,{offset:p.offset,digest:p.digest},leagueId)??{available:false,reason:'Finding unavailable.'};
 const page=await readUpdateInbox(student,p.cursor,leagueId);
 return {findings:page.updates.map(findingPresentation),next:page.next,contract:findingContract};
}

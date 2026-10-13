import {createHash} from 'node:crypto';
import {db} from '../db';
import {desktopEvidenceState} from '../desktop/control-evidence';
import {companionEvidenceInput,evidenceContract,evidenceLeague,isCompanionEvidence,type EvidenceInput,type EvidenceRecord} from './evidence';
export async function readCompanionEvidence(student:string,input:EvidenceInput){
 const p=companionEvidenceInput.parse(input);if(!student)throw Error('Authenticated evidence owner required');
 const signal=AbortSignal.timeout(8000),client=db();
 const source=await client.from('research_events').select('id,kind,actor,payload,evidence,created_at,supersedes').eq('student_id',student).eq('id',p.eventId).limit(1).abortSignal(signal).maybeSingle();
 if(source.error)throw Error('Evidence unavailable; retry this same source');
 const row=source.data as EvidenceRecord|null;
 if(!row||!isCompanionEvidence(row)||evidenceLeague(row)!==p.leagueId)return {status:'unavailable',eventId:p.eventId,contract:evidenceContract};
 const replacement=await client.from('research_events').select('id,kind,actor,payload,supersedes').eq('student_id',student).eq('supersedes',p.eventId).order('sequence',{ascending:false}).limit(5).abortSignal(signal);
 if(replacement.error)throw Error('Evidence correction state unavailable; retry this same source');
 const replacements=(replacement.data as EvidenceRecord[]).filter(r=>evidenceLeague(r)===p.leagueId).map(r=>r.id);
 if(row.payload.withdrawn===true)return {status:'withdrawn',eventId:row.id,contract:evidenceContract};
 if(replacement.data.length&&p.view==='current')return {status:'superseded',eventId:row.id,replacements,contract:evidenceContract};
 let taskState: {generation:number;status:string;updated_at:string}|null=null;
 if(row.kind.startsWith('task.')&&typeof row.payload.taskId==='string'&&zUuid(row.payload.taskId)){
  const task=await client.from('agent_tasks').select('generation,status,updated_at').eq('student_id',student).eq('id',row.payload.taskId).limit(1).abortSignal(signal).maybeSingle();
  if(task.error)throw Error('Task evidence freshness unavailable; retry this same source');taskState=task.data;
 }
 const changedTask=row.kind.startsWith('task.')&&(!taskState||taskState.generation!==row.payload.generation||taskState.status!==row.payload.status);
 const desktopState=row.kind.startsWith('desktop.')?await desktopEvidenceState(student,row,signal):undefined;
 const text=JSON.stringify(row),digest=createHash('sha256').update(text).digest('hex');
 if(p.digest&&p.digest!==digest)return {status:'changed',eventId:row.id,reason:'Restart at offset zero; do not join pages from different source digests.',contract:evidenceContract};
 if(p.offset>text.length)throw Error('Evidence offset exceeds source length');
 let end=Math.min(p.offset+6000,text.length);
 // Never split a UTF-16 surrogate pair at a page boundary.
 if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1]))end--;
 return {status:replacement.data.length?'superseded':changedTask||desktopState?.historical?'historical':'current',eventId:row.id,replacements,taskState,desktopState,
  resultAvailability:row.kind.startsWith('task.')?(row.payload.resultSnapshot?'recorded_at_transition':'not_recorded'):undefined,
  content:{format:'application/json',digest,totalChars:text.length,offset:p.offset,text:text.slice(p.offset,end),nextOffset:end<text.length?end:null},contract:evidenceContract};
}
function zUuid(value:string){return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);}

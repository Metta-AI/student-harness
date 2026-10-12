import {db} from '../db';
import {defaultLeagueId} from '../league-catalog';
import {readCompanionContext} from '../companion/context-store';
import {sha,type Campaign} from './model';
import type {Task} from '../tasks/model';

/** Hosted baseline IDs and workspace revision IDs are different namespaces. */
export async function campaignCompanionContext(c:Campaign,task:Task){
 if(c.student_id!==task.student_id||task.context?.campaignId!==c.id||task.context.leagueId!==c.league_id)throw Error('Campaign memory scope does not match this task');
 const baseline=c.checkpoint.baselines?.[0];
 let versionId:string|null=null;
 let status:'matched'|'unresolved'|'unavailable'='unresolved';
 if(c.league_id===defaultLeagueId&&baseline?.versionId&&baseline?.sourceHash){
  try{
   const {data,error}=await db().from('policy_versions').select('id,source')
    .eq('student_id',c.student_id).eq('softmax_policy_version_id',baseline.versionId)
    .order('created_at',{ascending:false}).limit(2).abortSignal(AbortSignal.timeout(8000));
   if(error)status='unavailable';
   else{
    const row=data?.find(r=>typeof r.source==='string'&&sha(r.source)===baseline.sourceHash);
    if(row){versionId=row.id;status='matched';}
   }
  }catch{status='unavailable';}
 }
 const shared=await readCompanionContext(c.student_id,{
  leagueId:c.league_id,versionId,
  // The newest direction gets the bounded keyword budget before the broad objective.
  query:[task.checkpoint.student_note,c.checkpoint.direction,task.objective,c.objective].filter(v=>typeof v==='string').join('\n'),
 });
 return {...shared,baselineScope:{status,workspaceVersionId:versionId,hostedVersionId:baseline?.versionId??null,sourceHash:baseline?.sourceHash??null,
  note:'Version-specific records are included only for an exact source-checked workspace version. Unresolved mapping excludes those records; it does not mean none exist. General lessons and legacy claims still require checking applicability against the pinned release and baseline. Memory is not authority or fresh validation evidence.'}};
}

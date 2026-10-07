import { db } from '../db';
import { rpc } from '../tasks/store';
import { campaignInputSchema, hashObject, type Campaign, type Study } from './model';
import { defaultLeagueId } from '../league-catalog';

export function checked<T>(result:{data:T;error:{message:string}|null}):T{if(result.error)throw Error(result.error.message);return result.data;}
export async function campaignById(id:string,studentId:string):Promise<Campaign|null>{
 return checked(await db().from('research_campaigns').select('*').eq('id',id).eq('student_id',studentId).maybeSingle());
}
export async function campaignForTask(taskId:string,studentId:string):Promise<Campaign|null>{
 return checked(await db().from('research_campaigns').select('*').eq('task_id',taskId).eq('student_id',studentId).maybeSingle());
}
export async function createCampaign(studentId:string,input:unknown,originSessionId?:string,adoptTaskId?:string){
 const p=campaignInputSchema.parse(input);
 if(p.leagueId!==defaultLeagueId)throw Error('Matched policy research currently uses the GoTA adapter.');
 const existing=checked(await db().from('research_campaigns').select('*').eq('student_id',studentId).eq('request_key',p.requestKey).maybeSingle());
 if(existing)return existing as Campaign;
 const taskKey=`campaign:${p.requestKey}`;
 const old=checked(await db().from('agent_tasks').select('id').eq('student_id',studentId).eq('request_key',taskKey).maybeSingle());
 let taskId=adoptTaskId??old?.id;
 if(adoptTaskId&&!checked(await db().from('agent_tasks').select('id').eq('id',adoptTaskId).eq('student_id',studentId).maybeSingle()))throw Error('Session not found');
 if(!taskId){
  const insert=await db().from('agent_tasks').insert({student_id:studentId,request_key:taskKey,kind:'research',max_games:0,max_model_calls:100,
   objective:p.objective,acceptance_criteria:'Improve league match utility through audited matched studies. Preserve findings and verify any deployment.',
   context:{mode:'campaign',title:p.objective.slice(0,100),leagueId:p.leagueId},status:'waiting',phase:'evaluate',origin_session_id:originSessionId??null,
   next_check_at:'2100-01-01T00:00:00Z',deadline_at:'2100-01-01T00:00:00Z'}).select('id').single();
  if(insert.error?.code==='23505')taskId=checked(await db().from('agent_tasks').select('id').eq('student_id',studentId).eq('request_key',taskKey).single())!.id;
  else taskId=checked(insert)!.id;
 }
 const created=await db().from('research_campaigns').insert({student_id:studentId,task_id:taskId,request_key:p.requestKey,league_id:p.leagueId,player_ids:p.playerIds,objective:p.objective,protocol:p.protocol}).select('*').single();
 if(created.error?.code==='23505')return checked(await db().from('research_campaigns').select('*').eq('student_id',studentId).eq('request_key',p.requestKey).single()) as Campaign;
 return checked(created) as Campaign;
}
export async function artifact(studentId:string,leagueId:string,kind:string,title:string,content:unknown,options:{campaignId?:string;taskId?:string;provenance?:unknown;historical?:boolean}={}){
 const contentHash=hashObject(content);
 // Generated full-text indexing happens before ON CONFLICT. Avoid rebuilding
 // large immutable replay documents every time a completed job is polled.
 const existing=checked(await db().from('research_artifacts').select('id').eq('student_id',studentId).eq('league_id',leagueId).eq('kind',kind).eq('content_hash',contentHash).maybeSingle());
 if(existing)return existing.id as string;
 const row={student_id:studentId,league_id:leagueId,kind,title,content_hash:contentHash,content,campaign_id:options.campaignId??null,task_id:options.taskId??null,provenance:options.provenance??{},historical:options.historical??false};
 const result=await db().from('research_artifacts').upsert(row,{onConflict:'student_id,league_id,kind,content_hash',ignoreDuplicates:true}).select('id');
 checked(result);
 if(result.data?.[0])return result.data[0].id as string;
 return checked(await db().from('research_artifacts').select('id').eq('student_id',studentId).eq('league_id',leagueId).eq('kind',kind).eq('content_hash',contentHash).single())!.id as string;
}
export async function findArtifacts(studentId:string,leagueId:string,query='',kind?:string,limit=30){
 let q=db().from('research_artifacts').select('id,kind,title,content_hash,provenance,historical,created_at,task_id,campaign_id').eq('student_id',studentId).eq('league_id',leagueId);
 if(kind)q=q.eq('kind',kind);if(query.trim())q=q.textSearch('search_text',query.slice(0,200),{type:'websearch',config:'english'});
 return checked(await q.order('created_at',{ascending:false}).limit(Math.min(limit,100)));
}
export async function readArtifact(studentId:string,id:string){return checked(await db().from('research_artifacts').select('*').eq('student_id',studentId).eq('id',id).maybeSingle());}
export async function recordEvent(c:Campaign,key:string,kind:string,payload:unknown){
 checked(await db().from('research_campaign_events').upsert({campaign_id:c.id,event_key:key,kind,payload},{onConflict:'campaign_id,event_key',ignoreDuplicates:true}));
}
export async function saveCampaign(c:Campaign,patch:Partial<Campaign>,delaySeconds=15){
 const row=checked(await db().from('research_campaigns').update({...patch,lease_token:null,lease_until:null,next_at:new Date(Date.now()+delaySeconds*1000).toISOString(),updated_at:new Date().toISOString()})
  .eq('id',c.id).eq('state',c.state).eq('lease_token',c.lease_token).gt('lease_until',new Date().toISOString()).select('*').maybeSingle());
 if(!row)throw Error('Campaign lease expired');
 return row as Campaign;
}
export async function claimCampaign(id:string){return (await rpc<Campaign[]>('campaign_claim',{p_id:id}))[0]??null;}
export async function claimStudy(id:string){return (await rpc<Study[]>('study_claim',{p_id:id}))[0]??null;}
export async function saveStudy(s:Study,patch:Record<string,unknown>,delaySeconds=30){
 const row=checked(await db().from('research_studies').update({...patch,lease_token:null,lease_until:null,next_at:new Date(Date.now()+delaySeconds*1000).toISOString(),updated_at:new Date().toISOString()})
  .eq('id',s.id).eq('lease_token',s.lease_token).gt('lease_until',new Date().toISOString()).select('*').maybeSingle());
 if(!row)throw Error('Study lease expired');return row as Study;
}
export async function campaignDetail(studentId:string,id:string){
 const campaign=await campaignById(id,studentId);if(!campaign)return null;
 const [studies,events,children,deployments,hostedUsage]=await Promise.all([
  db().from('research_studies').select('id,task_id,cycle,cohort,state,result,created_at').eq('campaign_id',id).order('created_at'),
  db().from('research_campaign_events').select('*').eq('campaign_id',id).order('id',{ascending:false}).limit(100),
  db().from('agent_tasks').select('id,objective,status,context,reason,model_calls,reported_cost_usd,retryAt:checkpoint->>provider_retry_at,progress:checkpoint->research_progress->>summary').eq('student_id',studentId).contains('context',{campaignId:id}).order('created_at'),
  db().from('research_deployments').select('*').eq('campaign_id',id),
  rpc('campaign_hosted_usage',{p_id:id,p_student:studentId}),
 ]);
 const {baselines,candidate,fixtures,selection,...checkpoint}=campaign.checkpoint;
 const studyRows=checked(studies)??[];
 const attempts=studyRows.length?checked(await db().from('research_attempts').select('id,study_id,arm,attempt,state,xp_id,episode_id,error,updated_at,host_status:receipt->episode->>status').in('study_id',studyRows.map(s=>s.id)).order('created_at',{ascending:false}).limit(150)):[];
 return {campaign:{...campaign,checkpoint},attempts,hostedUsage,studies:studyRows,events:checked(events),sessions:checked(children),deployments:checked(deployments)};
}
export async function controlCampaign(studentId:string,id:string,action:'pause'|'resume'|'cancel',note=''){
 const c=await campaignById(id,studentId);if(!c)throw Error('Campaign not found');
 if(c.state==='canceled'||c.state==='completed')throw Error('Campaign has ended');
 await rpc('campaign_control',{p_id:id,p_student:studentId,p_action:action,p_note:note});
 if(action!=='resume'){
  const children=checked(await db().from('agent_tasks').select('id').eq('student_id',studentId).contains('context',{campaignId:id}).neq('context->>mode','study').neq('context->>mode','audit').in('status',['queued','running','waiting']));
  for(const child of children??[])await rpc('task_control',{p_task:child.id,p_student:studentId,p_action:action,p_note:note});
 }else{
  const children=checked(await db().from('agent_tasks').select('id').eq('student_id',studentId).contains('context',{campaignId:id}).neq('context->>mode','study').neq('context->>mode','audit').eq('status','paused'));
  for(const child of children??[])await rpc('task_control',{p_task:child.id,p_student:studentId,p_action:'resume',p_note:note});
 }
 checked(await db().from('agent_tasks').update({status:action==='resume'?'waiting':action==='pause'?'paused':'canceled',next_check_at:'2100-01-01T00:00:00Z'}).eq('student_id',studentId).contains('context',{campaignId:id,mode:'study'}).not('status','in','(completed,failed,canceled)'));
 return campaignById(id,studentId);
}

import type {EveDynamicToolPart,EveMessagePart} from 'eve/react';
import {containerOperationLink} from '../container-policy/links.ts';

export function toolActivityStatus(part:EveDynamicToolPart,active:boolean){
  switch(part.state){
    case 'output-error':return 'Failed';
    case 'output-denied':return 'Declined';
    case 'output-available':return part.partial?(active?'In progress':'Not completed'):'Done';
    case 'approval-requested':return 'Needs approval';
    case 'approval-responded':return part.approval.approved===false?'Declined':active?'Resuming':'Not completed';
    case 'input-streaming':return active?'Preparing':'Not completed';
    default:return active?'In progress':'Not completed';
  }
}

export function sessionActivityParts(parts:readonly EveMessagePart[]){
  return parts.flatMap((part,index)=>part.type==='dynamic-tool'||part.type==='reasoning'?[{part,key:part.type==='dynamic-tool'?part.toolCallId:`reasoning-${index}`}]:[]);
}

export function activityValue(value:unknown){
  if(value===undefined)return '';
  return typeof value==='string'?value:JSON.stringify(value,null,2);
}

const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const text=(value:unknown)=>typeof value==='string'?value.trim():'';
const short=(value:unknown)=>{const s=text(value);return s.length>240?`${s.slice(0,237)}…`:s;};
export function hasActivityValue(value:unknown):boolean{
 if(value===undefined||value===null)return false;
 if(typeof value==='string')return !!value.trim();
 if(Array.isArray(value))return value.length>0;
 if(typeof value==='object')return Object.keys(value).length>0;
 return true;
}
const actions:Record<string,[string,string]>={
 list_policy_versions:['policy','Read saved policies'],read_policy:['policy','Read the policy'],policy_status:['policy','Check the policy'],
 inspect_episode:['evidence','Read replay evidence'],live_league:['evidence','Check league performance'],league_status:['evidence','Check league performance'],read_file:['evidence','Read evidence'],research_evidence:['evidence','Explore replay evidence'],
 autoresearch:['research','Check autoresearch'],research_campaign:['research','Manage research'],task_status:['research','Check research sessions'],start_task:['research','Start a session'],
 select_tufte_chart:['workspace','Choose an evidence chart'],compose_workspace:['workspace','Update the workspace'],create_view:['workspace','Prepare findings'],present_view:['workspace','Open evidence'],
 research_terminal:['terminal','Use the coding workspace'],bash:['terminal','Run a command'],
 container_policy_source:['container','Save or read policy source'],container_policy_build:['container','Request a policy build'],container_policy_upload:['container','Request a policy upload'],container_policy_practice:['container','Run a hosted practice game'],container_policy_status:['container','Check policy operation'],container_policy_cancel:['container','Stop policy operation'],
};
const groupTitles:Record<string,string>={policy:'Policy history',container:'Policy operations',evidence:'League & replay evidence',research:'Research sessions',workspace:'Workspace updates',terminal:'Coding workspace',other:'Other actions',reasoning:'Model notes'};
export function describeActivity(part:EveDynamicToolPart,active:boolean){
 const input=object(part.input),output=part.state==='output-available'?object(part.output):{};
 const [category,defaultTitle]=actions[part.toolName]??['other',part.toolName.replaceAll('_',' ')];
 let title=defaultTitle;
 if(part.toolName==='research_terminal')title=({setup:'Prepare the coding environment',run:'Run a command',inspect:'Read workspace files',start_loop:'Start autoresearch',resume_loop:'Resume autoresearch',loop_status:'Check autoresearch progress',stop_loop:'Stop autoresearch'} as Record<string,string>)[text(input.action)]??title;
 if(part.toolName==='research_campaign'||part.toolName==='task_status')title=({start:'Start research',status:'Check research progress',list:'Check research sessions',pause:'Pause research',resume:'Resume research',cancel:'Cancel research',artifacts:'Find saved findings',read_artifact:'Read saved findings',steer:'Update research direction'} as Record<string,string>)[text(input.action)]??title;
 const receiptFailed=part.state==='output-available'&&(output.ok===false||output.success===false||(part.toolName==='research_terminal'&&output.phase==='completed'&&typeof output.exitCode==='number'&&output.exitCode!==0));
 const operationState=part.state==='output-available'&&category==='container'?text(output.outcome):'';
 const status=receiptFailed||operationState==='failed'||category==='container'&&output.state==='failed'?'Failed':operationState==='uncertain'?'Unconfirmed':toolActivityStatus(part,active);
 const running=['Preparing','In progress','Resuming'].includes(status);
 const attention=['Failed','Unconfirmed','Declined','Needs approval','Not completed'].includes(status);
 const facts:string[]=[];
 let summary='';
 if(part.state==='output-error')summary=short(part.errorText)||'This action failed.';
 else if(part.state==='output-denied')summary=short(part.approval.reason)||'This action was not approved.';
 else if(receiptFailed){summary=short(output.error)||short(output.message)||short(output.stderr)||'The action reported a failure.';}
 else if(part.state==='output-available'){
  if(category==='container'){
   if(part.toolName==='container_policy_source'){
    summary=output.action==='save'?'Policy source revision saved':'Saved policy source read';
    if(typeof output.fileCount==='number')facts.push(`${output.fileCount} ${output.fileCount===1?'file':'files'}`);
   }else{
    const kind=output.kind??(part.toolName==='container_policy_build'?'build':part.toolName==='container_policy_upload'?'upload':part.toolName==='container_policy_practice'?'practice':input.kind);
    const state=text(output.state),outcome=text(output.outcome),receipt=object(output.receipt);
    if(kind==='build'){
     summary=outcome==='artifact_ready'?'Build completed; archive retained and builder stopped.'
      :outcome==='cleanup_pending'?`${state==='failed'?'Build failed; builder':'Builder'} shutdown is awaiting confirmation.`
      :outcome==='failed'?'Build failed; builder shutdown confirmed.'
      :outcome==='canceled'?'Build canceled; builder shutdown confirmed.'
      :`Build ${['queued','provisioning','building','retaining','stopping'].includes(state)?state:'status recorded'}.`;
     if(outcome==='artifact_ready')facts.push('Packaging verified; gameplay has not been tested.');
    }else if(kind==='practice'){
     summary=outcome==='completed'?'Hosted practice completed; results recorded.'
      :outcome==='uncertain'?'Practice outcome unconfirmed. Keep the original request.'
      :outcome==='cleanup_pending'?'Practice stopped locally; remote cancellation is awaiting confirmation.'
      :outcome==='canceled'?'Practice stopped; any recorded results remain available.'
      :outcome==='failed'?'Hosted practice failed.'
      :outcome==='expired'?'The original practice deadline ended.'
      :`Practice ${['queued','submitting','running'].includes(state)?state:'status recorded'}.`;
     facts.push('Private self-play provides execution evidence, not a comparison of policy strength.');
    }else{
     summary=outcome==='registered'&&text(receipt.policyVersionId)?'Policy version registered; league entry is separate.'
      :outcome==='uncertain'?'Registration is unconfirmed. Keep the original upload; do not resubmit.'
      :outcome==='canceled'?'Upload canceled; any accepted registration remains recorded.'
      :outcome==='image_uploaded'?'Image uploaded; policy registration is not confirmed.'
      :`Upload ${['queued','uploading','image_ready','registering'].includes(state)?state:'status recorded'}.`;
     if(text(receipt.policyVersionId))facts.push(`Recorded policy version: ${text(receipt.policyVersionId)}`);
    }
    facts.push('Recorded at this check. Open the operation for its latest status.');
   }
  }else if(part.toolName==='list_policy_versions'&&Array.isArray(output.revisions)){
   const revisions=output.revisions.map(object);
   summary=`${revisions.length} saved ${revisions.length===1?'revision':'revisions'}`;
   facts.push(...revisions.slice(-3).reverse().map(r=>[`Revision ${r.revision}`,short(r.uploaded_as),short(r.summary)].filter(Boolean).join(' · ')));
   const best=object(output.best_league_revision_72h);
   if(typeof best.revision==='number')facts.unshift(`Best 72-hour policy score: revision ${best.revision}. This is separate from player MMR.`);
   if(!revisions.length&&text(output.note))facts.push(short(output.note));
  }else if(part.toolName==='live_league'&&Array.isArray(output.ourPolicies)){
   const rows=output.ourPolicies.map(object);
   summary=rows.length?`${rows.length} ranked ${rows.length===1?'player':'players'}`:'No ranked players returned';
   facts.push(...rows.slice(0,3).map(r=>[short(r.player),typeof r.rank==='number'?`#${r.rank}`:'',typeof r.score==='number'?`${r.score} ${text(r.metric)||'MMR'}`:''].filter(Boolean).join(' · ')));
   const record=object(output.record);
   if(['wins','losses','time_limits'].every(k=>typeof record[k]==='number'))facts.push(`${record.wins} wins · ${record.losses} losses · ${record.time_limits} time limits (${output.recordWindowHours??72}h)`);
  }else if(part.toolName==='compose_workspace'&&Array.isArray(object(output.workspace).tabs)){
   const tabs=(object(output.workspace).tabs as unknown[]).map(object);
   summary=`${tabs.length} workspace ${tabs.length===1?'tab':'tabs'} prepared`;
   facts.push(...tabs.slice(0,4).map(tab=>short(tab.title)).filter(Boolean));
  }else if(part.toolName==='create_view'){
   summary=short(object(output.presentation).reason)||'Finding saved';
  }else if(part.toolName==='present_view'){
   summary=short(object(output.presentation).reason)||'Evidence prepared for the workspace';
  }else if(part.toolName==='research_terminal'){
   const loop=object(output.loop);
   summary=text(loop.status)?`Autoresearch ${text(loop.status)}${typeof loop.turn==='number'?` · turn ${loop.turn}`:''}`:output.phase==='preparing'?'Preparing the environment':output.phase==='completed'?`Command finished · exit ${output.exitCode??'unknown'}`:'Command is running';
   if(text(loop.reason))facts.push(short(loop.reason));
   if(Array.isArray(output.files))facts.push(`${output.files.length} workspace files available`);
  }else{
   summary=short(output.summary)||short(output.message)||short(output.note)||short(output.title);
   if(text(output.status))facts.push(`Status: ${text(output.status).replaceAll('_',' ')}`);
   if(!summary&&Array.isArray(part.output))summary=`${part.output.length} ${part.output.length===1?'item':'items'} returned`;
   if(!summary&&typeof part.output==='string')summary=short(part.output);
  }
 }
 if(!summary)summary=status==='Needs approval'?'Waiting for your approval':running?short(input.query)||short(input.file)||short(input.path)||'':status==='Not completed'?'No completion was recorded.':'';
 const url=text(output.url);
 const operationLink=category==='container'?containerOperationLink(output):null;
 const link=operationLink??(/^\/(sessions|s)\/[a-zA-Z0-9_-]+$/.test(url)?url:null);
 return {title,category,status,running,attention,summary,facts,link,linkLabel:operationLink?'Open operation':'Open session'};
}

export type ActivityGroup={key:string;title:string;category:string;items:ReturnType<typeof sessionActivityParts>;running:boolean;attention:boolean};
/** Adjacent actions share a stable group from their first call, while new calls stream in. */
export function sessionActivityGroups(parts:readonly EveMessagePart[],active:boolean){
 const groups:ActivityGroup[]=[];
 for(const item of sessionActivityParts(parts)){
  if(item.part.type==='reasoning'&&!item.part.text.trim())continue;
  const detail=item.part.type==='dynamic-tool'?describeActivity(item.part,active):null;
  const category=detail?.category??'reasoning';
  let group=groups.at(-1);
  if(!group||group.category!==category){group={key:item.key,title:groupTitles[category],category,items:[],running:false,attention:false};groups.push(group);}
  group.items.push(item);
  group.running ||= detail?.running??(active&&item.part.type==='reasoning'&&item.part.state==='streaming');
  group.attention ||= detail?.attention??false;
 }
 return groups;
}

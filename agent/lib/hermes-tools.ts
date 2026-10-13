import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {db} from '../../lib/db';
import {userPreferences} from '../../lib/preferences-store';
import {defaultLeagueId} from '../../lib/league-catalog';

/** The eve tools Hermes may call through the harness MCP server. Hermes has its
 * own shell and file tools, so the eve sandbox tools are left out, along with
 * eve-internal runners and tools that only work inside an eve turn (human
 * questions, durable waits, attachments, the nested Hermes terminal). */
import * as autoresearch from '../tools/autoresearch';
import * as campaign_submission from '../tools/campaign_submission';
import * as cloud_browser from '../tools/cloud_browser';
import * as cloud_desktop from '../tools/cloud_desktop';
import * as coaching_feedback from '../tools/coaching_feedback';
import * as companion_evidence from '../tools/companion_evidence';
import * as companion_finding from '../tools/companion_finding';
import * as companion_status from '../tools/companion_status';
import * as compose_workspace from '../tools/compose_workspace';
import * as consult_expert from '../tools/consult_expert';
import * as container_policy_build from '../tools/container_policy_build';
import * as container_policy_cancel from '../tools/container_policy_cancel';
import * as container_policy_compare from '../tools/container_policy_compare';
import * as container_policy_comparison_status from '../tools/container_policy_comparison_status';
import * as container_policy_practice from '../tools/container_policy_practice';
import * as container_policy_source from '../tools/container_policy_source';
import * as container_policy_status from '../tools/container_policy_status';
import * as container_policy_upload from '../tools/container_policy_upload';
import * as create_view from '../tools/create_view';
import * as desktop_replay from '../tools/desktop_replay';
import * as enter_league from '../tools/enter_league';
import * as game_contract from '../tools/game_contract';
import * as game_workspace from '../tools/game_workspace';
import * as goal_completion from '../tools/goal_completion';
import * as hosted_game_status from '../tools/hosted_game_status';
import * as inspect_episode from '../tools/inspect_episode';
import * as league_replays from '../tools/league_replays';
import * as league_standing from '../tools/league_standing';
import * as learned_skill from '../tools/learned_skill';
import * as learning_study from '../tools/learning_study';
import * as list_policy_versions from '../tools/list_policy_versions';
import * as live_league from '../tools/live_league';
import * as opponent_research from '../tools/opponent_research';
import * as policy_representation from '../tools/policy_representation';
import * as present from '../tools/present';
import * as present_view from '../tools/present_view';
import * as recall_memory from '../tools/recall_memory';
import * as request_hosted_game from '../tools/request_hosted_game';
import * as research_authority from '../tools/research_authority';
import * as research_campaign from '../tools/research_campaign';
import * as research_method from '../tools/research_method';
import * as research_partner from '../tools/research_partner';
import * as select_tufte_chart from '../tools/select_tufte_chart';
import * as shared_work from '../tools/shared_work';
import * as softmax_cli from '../tools/softmax_cli';
import * as start_task from '../tools/start_task';
import * as task_status from '../tools/task_status';
import * as upload_policy from '../tools/upload_policy';
import * as uploaded_policies from '../tools/uploaded_policies';
import * as web_fetch from '../tools/web_fetch';

type Module={tool?:unknown;default?:unknown};
const modules:Record<string,Module>={autoresearch,campaign_submission,cloud_browser,cloud_desktop,coaching_feedback,companion_evidence,companion_finding,companion_status,compose_workspace,consult_expert,container_policy_build,container_policy_cancel,container_policy_compare,container_policy_comparison_status,container_policy_practice,container_policy_source,container_policy_status,container_policy_upload,create_view,desktop_replay,enter_league,game_contract,game_workspace,goal_completion,hosted_game_status,inspect_episode,league_replays,league_standing,learned_skill,learning_study,list_policy_versions,live_league,opponent_research,policy_representation,present,present_view,recall_memory,request_hosted_game,research_authority,research_campaign,research_method,research_partner,select_tufte_chart,shared_work,softmax_cli,start_task,task_status,upload_policy,uploaded_policies,web_fetch};

type Decision='user-approval'|'not-applicable'|'approved'|'denied'|{type:'approved'|'denied';reason?:string}|boolean;
type ToolDefinition={description?:string;inputSchema?:z.ZodType;approval?:unknown;execute:(input:unknown,ctx:unknown)=>unknown};
function definition(module:Module):ToolDefinition|null{
 for(const candidate of [module.tool,module.default]){
  const value=candidate as Partial<ToolDefinition>|undefined;
  if(value&&typeof value.execute==='function')return value as ToolDefinition;
 }
 return null;
}
export const hermesTools:Record<string,ToolDefinition>=Object.fromEntries(Object.entries(modules).map(([name,module])=>[name,definition(module)]).filter((entry):entry is [string,ToolDefinition]=>entry[1]!==null));

const conversationProperty={type:'string',description:'The conversation_id given in your instructions for this conversation. Required on every call.'};
function jsonSchema(tool:ToolDefinition){
 let schema:Record<string,unknown>={type:'object',properties:{}};
 try{if(tool.inputSchema)schema=z.toJSONSchema(tool.inputSchema,{io:'input',unrepresentable:'any'}) as Record<string,unknown>;}catch{}
 const properties={...(schema.properties as Record<string,unknown>|undefined),conversation_id:conversationProperty};
 const required=[...new Set([...(Array.isArray(schema.required)?schema.required as string[]:[]),'conversation_id'])];
 const {$schema:_drop,...rest}=schema;
 return {...rest,type:'object',properties,required};
}
export function hermesToolList(){
 return Object.entries(hermesTools).map(([name,tool])=>({name,description:(tool.description??name).slice(0,4000),inputSchema:jsonSchema(tool)}));
}

export type HermesConversation={student:string;eveSessionId:string;leagueId:string};
/** Resolves the conversation Hermes names, and checks it belongs to the
 * account whose MCP token made the call. */
export async function hermesConversation(student:string,conversationId:unknown):Promise<HermesConversation>{
 if(typeof conversationId!=='string'||!conversationId)throw Error('conversation_id is required. Use the conversation_id from your instructions.');
 const row=await db().from('hermes_conversations').select('eve_session_id,student_id,league_id').eq('eve_session_id',conversationId).maybeSingle();
 if(row.error||!row.data||row.data.student_id!==student)throw Error('Unknown conversation_id for this account.');
 return {student,eveSessionId:row.data.eve_session_id,leagueId:row.data.league_id||defaultLeagueId};
}

/** The session context eve tools expect, built for the signed-in owner of the
 * conversation. The account's saved permission mode and model decide approvals
 * and model-dependent behavior exactly as in a Preston conversation. */
async function toolContext(conversation:HermesConversation,signal:AbortSignal){
 const preferences=await userPreferences(conversation.student);
 const identity={authenticator:'student-harness',issuer:'softmax',principalId:conversation.student,principalType:'user' as const,subject:conversation.student,
  attributes:{leagueId:conversation.leagueId,model:preferences.chatModel,effort:preferences.reasoningEffort,modelDefaultsVersion:'1',permissionMode:preferences.permissionMode,surface:'hermes'}};
 return {session:{id:conversation.eveSessionId,auth:{initiator:identity,current:identity},turn:{id:`hermes-${randomUUID()}`}},
  callId:`hermes_${randomUUID()}`,abortSignal:signal,cancel(){},addIssue(){}};
}

function approvalDecision(tool:ToolDefinition,ctx:Awaited<ReturnType<typeof toolContext>>,input:unknown):Decision{
 const approval=tool.approval as ((args:unknown)=>Decision)|{request?:(args:unknown)=>Decision}|undefined;
 const args={session:ctx.session,toolInput:input,toolName:'',approvedTools:new Set<string>(),callId:ctx.callId,abortSignal:ctx.abortSignal};
 if(typeof approval==='function')return approval(args);
 if(approval&&typeof approval.request==='function')return approval.request(args);
 return approval?'user-approval':'not-applicable';
}

export type HermesToolResult={status:'ok';result:unknown}|{status:'approval_required';tool:string;input:unknown;message:string}|{status:'denied';message:string};
/** Runs one eve tool for Hermes. In Ask mode an approval-gated call is not
 * executed: it returns approval_required, and the Hermes turn hands it to the
 * Preston conversation, which shows the normal approval card. */
export async function runHermesTool(name:string,rawInput:Record<string,unknown>,student:string,signal:AbortSignal):Promise<HermesToolResult>{
 const tool=hermesTools[name];if(!tool)throw Error(`Unknown harness tool: ${name}`);
 const {conversation_id,...input}=rawInput;
 const conversation=await hermesConversation(student,conversation_id);
 const ctx=await toolContext(conversation,signal);
 const parsed=tool.inputSchema?tool.inputSchema.parse(input):input;
 const decision=await approvalDecision(tool,ctx,parsed);
 const verdict=typeof decision==='object'?decision.type:decision===true?'user-approval':decision===false?'not-applicable':decision;
 if(verdict==='denied')return {status:'denied',message:typeof decision==='object'&&decision.reason?decision.reason:'This action is not allowed.'};
 if(verdict==='user-approval'){
  // Held for the Preston conversation; it becomes a normal approval card there.
  const row=await db().from('hermes_conversations').select('pending_approvals').eq('eve_session_id',conversation.eveSessionId).maybeSingle();
  const list=Array.isArray(row.data?.pending_approvals)?row.data.pending_approvals as unknown[]:[];
  await db().from('hermes_conversations').update({pending_approvals:[...list,{tool:name,input:parsed}].slice(-10),updated_at:new Date().toISOString()}).eq('eve_session_id',conversation.eveSessionId).eq('student_id',student);
  return {status:'approval_required',tool:name,input:parsed,message:'This action needs the human’s approval. Stop here and say what you want to do and why; the conversation will show an approval card and report the result back to you.'};
 }
 let output=await tool.execute(parsed,ctx);
 if(output&&typeof (output as AsyncIterable<unknown>)[Symbol.asyncIterator]==='function'){let last:unknown;for await(const value of output as AsyncIterable<unknown>)last=value;output=last;}
 return {status:'ok',result:output};
}

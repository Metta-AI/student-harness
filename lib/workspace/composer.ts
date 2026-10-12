import {codingWorkspaceInstructions} from './coding-workspace';
import {viewRequestInstructions} from '../views/request';

export const composerModes=[
  {value:'auto',label:'Ask Preston',placeholder:'Ask, learn, or give Preston a direction…'},
  {value:'learn',label:'Learn',placeholder:'What would you like to understand?'},
  {value:'do',label:'Do',placeholder:'What should Preston work on?'},
  {value:'view',label:'Create a view',placeholder:'What would help you see and understand?'},
  {value:'research',label:'Autoresearch',placeholder:'What should Preston investigate and improve?'},
] as const;
export type ComposerMode=typeof composerModes[number]['value'];
const hints:Record<ComposerMode,string>={
  auto:'Respond to the human’s intent: explain, show evidence, or execute the requested work using your existing tools. Surface only useful results and questions. Keep orchestration in the Lab.',
  learn:'Help the human understand using current policy, league and replay evidence. Explain simply and use a concrete example. This mode is for learning; do not change policies or launch research.',
  do:'Carry out the human’s requested work with your existing tools. Read current state first and avoid duplicating active tasks. Delegate substantial work through the existing task workflow, then report what actually started or finished and where the human can help.',
  view:viewRequestInstructions,
  research:codingWorkspaceInstructions,
};
export function composerContext(mode:ComposerMode,requestId:string,leagueId:string,policyId:string):Record<string,string> {
  return {kind:mode==='view'?'workspace-view':'workspace-command',mode,leagueId,...policyId?{policyId}:{},...mode==='view'?{viewRequestId:requestId}:{},hint:hints[mode]};
}

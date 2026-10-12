import type {SandboxSession} from 'eve/sandbox';
import type {TerminalOutput} from './workspace';
import {inspectTerminal} from './workspace';

export const researchRoot='/workspace/autoresearch/runtime';
export const supervisorPath='/workspace/.preston/research_supervisor.py';
export type LoopAction='start_loop'|'resume_loop'|'loop_status'|'stop_loop';
const actionNames={start_loop:'start',resume_loop:'resume',loop_status:'status',stop_loop:'stop'};

export function loopConfiguration(objective:string,model:string){
 return {objective,model,cwd:'/workspace',max_turns:8,max_seconds:2700,gateway_spend_limit_usd:5,
  command:['/opt/hermes-bin/hermes','chat','--provider','ai-gateway','--model',model],
  env:{HERMES_HOME:'/workspace/autoresearch/.hermes',AI_GATEWAY_API_KEY:'preston-gateway-placeholder',
   AI_GATEWAY_BASE_URL:'https://ai-gateway.vercel.sh/v1',TERMINAL_CWD:'/workspace'},
 };
}

export async function controlResearchLoop(sandbox:SandboxSession,action:LoopAction,options?:{
 objective:string;model:string;supervisor:string;instructions:string;
}):Promise<TerminalOutput>{
 if(action==='start_loop'){
  if(!options)throw Error('An objective and prepared harness are required');
  const ready=await sandbox.run({command:'test -x /opt/hermes-bin/hermes && test -f /workspace/.preston/hermes-version'});
  if(ready.exitCode!==0)throw Error('This session predates the Hermes environment. Start a new Autoresearch workspace with the prepared environment.');
  await sandbox.writeTextFile({path:supervisorPath,content:options.supervisor});
  // Do not overwrite an existing configuration, history, working policy or objective on redelivery.
  const configured=await sandbox.readTextFile({path:`${researchRoot}/config.json`});
  if(configured===null){
   await sandbox.run({command:'mkdir -p /workspace/autoresearch/.hermes /workspace/autoresearch/runtime'});
   await sandbox.writeTextFile({path:'/workspace/autoresearch/.hermes/SOUL.md',content:options.instructions});
   await sandbox.writeTextFile({path:'/workspace/autoresearch/.hermes/config.yaml',content:JSON.stringify({
    model:{default:options.model,provider:'ai-gateway'},fallback_providers:[],
    terminal:{backend:'local',cwd:'/workspace'},agent:{max_turns:100,run_budget_seconds:2700},
    approvals:{mode:'off',deny:['coworld submit*','coworld player use*','coworld download*','coworld run-episode*','softmax login*']},
    auxiliary:{background_review:{enabled:false}},updates:{check:false},
   })});
   await sandbox.writeTextFile({path:`${researchRoot}/launch.json`,content:JSON.stringify(loopConfiguration(options.objective,options.model))});
  }
 }
 const command=`python3 ${supervisorPath} ${actionNames[action]} --root ${researchRoot}${action==='start_loop'?` --config ${researchRoot}/launch.json`:''}`;
 const result=await sandbox.run({command,workingDirectory:'/workspace',abortSignal:AbortSignal.timeout(15000)});
 if(result.exitCode!==0)throw Error(`Could not ${actionNames[action]} research harness: ${result.stderr.slice(-1000)}`);
 const state=JSON.parse(result.stdout);
 return {phase:'completed',command,cwd:'/workspace',stdout:state.stdout??'',stderr:'',exitCode:0,
  loop:{status:state.status,turn:state.turn??0,reason:state.reason??null},
  ...await inspectTerminal(sandbox,'autoresearch/PLAN.md')};
}

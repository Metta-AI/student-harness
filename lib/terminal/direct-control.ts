import {Sandbox} from '@vercel/sandbox';
import {terminalInspectionScript,terminalOutputSchema} from './workspace';
import {researchRoot,supervisorPath} from './research-loop';

/** Caller verifies ownership. Never create a replacement for a missing VM. */
export async function existingTerminal(sessionId:string,resume=false){
 const list=await Sandbox.list({tags:{sessionId},limit:10,signal:AbortSignal.timeout(10000)});
 const matches=list.sandboxes.filter(vm=>vm.tags?.sessionId===sessionId);
 if(matches.length!==1)throw Error(matches.length?'Multiple workspaces found; inspect in Lab.':'This session has no prepared terminal.');
 const vm=await Sandbox.get({name:matches[0].name,resume,signal:AbortSignal.timeout(20000)});
 if(vm.status!=='running')throw Error('The VM is stopped. Resume this workspace to inspect it.');
 return vm;
}

export async function inspectExistingTerminal(sessionId:string,file:string){
 const script=terminalInspectionScript(file);
 const vm=await existingTerminal(sessionId);
 const result=await vm.runCommand({cmd:'python3',args:['-c',script],signal:AbortSignal.timeout(15000)});
 if(result.exitCode!==0)throw Error('Could not read workspace files.');
 return terminalOutputSchema.parse({phase:'completed',command:`Inspect ${file}`,cwd:'/workspace',stdout:'',stderr:'',exitCode:0,...JSON.parse(await result.stdout())});
}

export async function controlExistingTerminal(vm:Sandbox,action:'stop'|'resume'){
 const run=async(command:string)=>{
  const result=await vm.runCommand({cmd:'python3',args:[supervisorPath,command,'--root',researchRoot],signal:AbortSignal.timeout(15000)});
  if(result.exitCode!==0)throw Error(`Could not ${action} research. Inspect the saved terminal output.`);
  return JSON.parse(await result.stdout());
 };
 let state=await run(action);
 for(let attempt=0;action==='stop'&&['starting','running','stopping'].includes(state.status)&&attempt<24;attempt++){
  await new Promise(resolve=>setTimeout(resolve,250));state=await run('status');
 }
 return terminalOutputSchema.parse({phase:'completed',command:'Autoresearch',cwd:'/workspace',stdout:state.stdout??'',stderr:'',exitCode:0,loop:{status:state.status,turn:state.turn??0,reason:state.reason??null}});
}

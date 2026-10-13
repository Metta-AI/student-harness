import {Sandbox} from '@vercel/sandbox';
import {terminalOutputSchema} from './workspace';

/** Observe existing compute only: opening a page never restarts a stopped worker. */
export async function readTerminalStatus(sessionId:string) {
 const listed=await Sandbox.list({tags:{sessionId},limit:10,signal:AbortSignal.timeout(10000)});
 const matches=listed.sandboxes.filter(vm=>vm.tags?.sessionId===sessionId);
 if(matches.length===0)return {vmStatus:'not_created',observedAt:Date.now(),output:null};
 if(matches.length!==1)throw Error('This session has multiple workspaces; inspect it in Lab.');
 const record=matches[0];
 if(record.status!=='running')return {vmStatus:record.status,observedAt:Date.now(),output:null};
 const vm=await Sandbox.get({name:record.name,signal:AbortSignal.timeout(10000)});
 if(vm.status!=='running')return {vmStatus:vm.status,observedAt:Date.now(),output:null};
 const result=await vm.runCommand({cmd:'python3',args:['-c',`
import json, pathlib, subprocess
root=pathlib.Path('/workspace/autoresearch/runtime')
supervisor=pathlib.Path('/workspace/.preston/research_supervisor.py')
if not supervisor.is_file() or not (root/'config.json').is_file():
 print('null')
else:
 result=subprocess.run(['python3',str(supervisor),'status','--root',str(root)],capture_output=True,text=True,check=True)
 state=json.loads(result.stdout)
 print(json.dumps(dict(phase='completed',command='Autoresearch',cwd='/workspace',stdout=state.get('stdout',''),stderr='',exitCode=0,loop=dict(status=state['status'],turn=state.get('turn',0),reason=state.get('reason')))))
`],signal:AbortSignal.timeout(15000)});
 if(result.exitCode!==0)throw Error('Could not read the terminal process.');
 const raw=JSON.parse(await result.stdout());
 return {vmStatus:'running',observedAt:Date.now(),output:raw===null?null:terminalOutputSchema.parse(raw)};
}

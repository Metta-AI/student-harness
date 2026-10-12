import type {SandboxSession} from 'eve/sandbox';
import {z} from 'zod';

export const terminalFileSchema=z.string().regex(/^(hero\.bas|autoresearch\/[a-zA-Z0-9_.\/-]+)$/).refine(p=>!p.split('/').some(part=>['..','.hermes'].includes(part)));
export const terminalInputSchema=z.object({
 action:z.enum(['setup','run','inspect','start_loop','resume_loop','loop_status','stop_loop']),
 releaseAllowance:z.boolean().default(false).describe('On stop_loop, release this session’s allowance when ending research. Keep false when pausing to inspect or resume in the same turn.'),
 objective:z.string().trim().min(10).max(8000).optional(),
 command:z.string().trim().min(1).max(16000).optional(),
 file:terminalFileSchema.default('hero.bas'),
 timeoutSeconds:z.number().int().min(1).max(180).default(60),
}).refine(input=>input.action!=='run'||!!input.command,'Run needs a command')
 .refine(input=>input.action!=='start_loop'||!!input.objective,'Starting a loop needs an objective');
export const terminalOutputSchema=z.object({
 phase:z.enum(['preparing','running','completed']),command:z.string(),cwd:z.literal('/workspace'),
 stdout:z.string(),stderr:z.string(),exitCode:z.number().nullable(),
 loop:z.object({status:z.enum(['not_started','starting','running','stopping','paused','blocked','completed','interrupted']),turn:z.number(),reason:z.string().nullable()}).optional(),
 files:z.array(z.string()).optional(),file:z.string().optional(),content:z.string().optional(),diff:z.string().optional(),
});
export type TerminalOutput=z.infer<typeof terminalOutputSchema>;
const quote=(s:string)=>`'${s.replaceAll("'", "'\\''")}'`;
const setup=`set -e
cd /workspace
mkdir -p autoresearch
if [ ! -f autoresearch/baseline.bas ]; then cp hero.bas autoresearch/baseline.bas; fi
if [ ! -f autoresearch/results.tsv ]; then printf 'iteration\\thypothesis\\tpolicy_version\\texperiment\\tresult\\tdecision\\n' > autoresearch/results.tsv; fi
printf 'Workspace: '; pwd
printf '\\nTools\\n'; git --version; python3 --version; coworld --help | head -6
printf '\\nWorking policy\\n'; wc -l hero.bas
printf '\\nResearch files\\n'; ls autoresearch`;
export function terminalInspectionScript(file:string){
 terminalFileSchema.parse(file);
 return `import json, pathlib, subprocess
root=pathlib.Path('/workspace').resolve()
p=(root/${JSON.stringify(file)}).resolve()
if not p.is_relative_to(root) or '.hermes' in p.parts: raise ValueError('File outside workspace')
candidates=[f for f in (root/'autoresearch').rglob('*') if f.is_file() and not f.is_symlink() and '.hermes' not in f.parts]
files=['hero.bas']+[str(f.relative_to(root)) for f in sorted(candidates,key=lambda f:(0 if f.suffix in ('.md','.tsv') else 1 if f.name in ('summary.json','outcomes.json','independent-identity-audit.json','independent-uncertainty.json') else 2 if f.suffix=='.bas' else 3,str(f)))[:100]]
content=p.read_text(errors='replace')[:65536] if p.is_file() else ''
diff=subprocess.run(['git','diff','--no-index','--','autoresearch/baseline.bas','hero.bas'],cwd=root,capture_output=True,text=True)
print(json.dumps(dict(files=files,file=${JSON.stringify(file)},content=content,diff=diff.stdout[:65536])))`;
}
export async function inspectTerminal(sandbox:SandboxSession,file:string,signal?:AbortSignal){
 const script=terminalInspectionScript(file);
 const result=await sandbox.run({command:`python3 -c ${quote(script)}`,workingDirectory:'/workspace',abortSignal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000)});
 if(result.exitCode!==0)throw Error('Could not inspect workspace files.');
 return JSON.parse(result.stdout) as Pick<TerminalOutput,'files'|'file'|'content'|'diff'>;
}
/** Stream real process output; partial snapshots replace, rather than repeat, output. */
export async function* runTerminal(sandbox:SandboxSession,input:z.infer<typeof terminalInputSchema>,signal?:AbortSignal):AsyncGenerator<TerminalOutput>{
 const command=input.action==='setup'?setup:input.action==='inspect'?`Inspect ${input.file}`:input.command!;
 const output:TerminalOutput={phase:'running',command,cwd:'/workspace',stdout:'',stderr:'',exitCode:null};
 if(input.action==='inspect'){yield {...output,phase:'completed',exitCode:0,...await inspectTerminal(sandbox,input.file,signal)};return;}
 yield {...output};
 const process=await sandbox.spawn({command,workingDirectory:'/workspace',abortSignal:signal?AbortSignal.any([signal,AbortSignal.timeout(input.timeoutSeconds*1000)]):AbortSignal.timeout(input.timeoutSeconds*1000)});
 let completedNormally=false;
 const exit=Promise.resolve(process.wait()).then(result=>({result}),error=>({error}));
 const readers=[process.stdout.getReader(),process.stderr.getReader()];
 const decoders=[new TextDecoder(),new TextDecoder()];
 const read=(index:number)=>readers[index].read().then(chunk=>({index,...chunk}));
 const pending:Array<ReturnType<typeof read>|null>=[read(0),read(1)];
 try{
  while(pending.some(Boolean)){
   const chunk=await Promise.race(pending.filter((p):p is ReturnType<typeof read>=>!!p));
   const field=chunk.index===0?'stdout':'stderr';
   output[field]=(output[field]+decoders[chunk.index].decode(chunk.value,{stream:!chunk.done})).slice(-65536);
   pending[chunk.index]=chunk.done?null:read(chunk.index);
   yield {...output};
  }
  const completed=await exit;if('error' in completed)throw completed.error;
  completedNormally=true;
  yield {...output,phase:'completed',exitCode:completed.result.exitCode,...await inspectTerminal(sandbox,input.file,signal)};
 }finally{try{if(!completedNormally)await process.kill();}finally{readers.forEach(r=>r.releaseLock());}}
}

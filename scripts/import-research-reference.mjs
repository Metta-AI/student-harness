// Explicit, read-only import of supplied research records. Never executes study scripts.
import {registerHooks} from 'node:module';
import {readFile,readdir,stat} from 'node:fs/promises';
import {resolve,join,basename,relative} from 'node:path';
registerHooks({resolve(s,c,next){try{return next(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return next(`${s}.ts`,c);throw e;}}});
const {artifact,checked}=await import('../lib/campaigns/store.ts');
const {sha}=await import('../lib/campaigns/model.ts');const {db}=await import('../lib/db.ts');
const args=Object.fromEntries(process.argv.slice(2).map((s,i,a)=>s.startsWith('--')?[s.slice(2),a[i+1]]:null).filter(Boolean));
if(!args.student||!args.research||!args.context||!args.transcript)throw Error('Required: --student SUBJECT_ID --research RESEARCH_DIRECTORY --context CONTEXT_MD --transcript TRANSCRIPT_JSONL');
const league='league_3c60897b-25cf-4b37-9d1a-8554c1198f28',root=resolve(args.research);
let artifacts=0,exclusions=0;
async function put(kind,title,content,path){await artifact(args.student,league,kind,title,content,{historical:true,provenance:{importedFrom:resolve(path),importedAt:new Date().toISOString()}});artifacts++;}
await put('session-context','Reference autoresearch handoff',{text:await readFile(args.context,'utf8')},args.context);
const transcript=(await readFile(args.transcript,'utf8')).trim().split('\n').map(s=>JSON.parse(s));
await put('session-history','Reference autoresearch conversation',{messages:transcript,note:'Transcript excludes tool results; inspect linked receipts for execution evidence.'},args.transcript);
const excluded=new Map();
function collect(value){
 if(Array.isArray(value)){for(const v of value)collect(v);return;}
 if(!value||typeof value!=='object')return;
 const id=value.ep??value.episodeId;
 if(typeof id==='string'&&/^ereq_[a-zA-Z0-9-]+$/.test(id))excluded.set(id,value.config?.seed??value.seed??null);
 for(const v of Object.values(value))collect(v);
}
async function walk(dir,depth=0){
 if(depth>4)return;
 for(const entry of await readdir(dir,{withFileTypes:true})){
  const path=join(dir,entry.name);
  if(entry.isDirectory()){
   if(!['artifacts','tooling','local','arms','mechanism','poison-mechanism','objectives','.git'].includes(entry.name))await walk(path,depth+1);
  }else if(entry.isFile()){
   if((await stat(path)).size>2000000)continue;
   if(entry.name==='policy.bas'){
    const source=await readFile(path,'utf8');await put('policy-source',`Historical source · ${relative(root,path)}`,{source,sourceHash:sha(source)},path);
   }else if(['README.md','preregistration.md','VERSION_LOG.md','closed_levers.md'].includes(entry.name)||dir===join(root,'experiments')&&entry.name.endsWith('.md')){
    await put('research-report',relative(root,path),{text:await readFile(path,'utf8')},path);
   }else if(['fixtures.json','plan.json','selection.json','completion.json','validation.json','statistics.json','result.json','manifest.json','semantic-check.json','interaction-summary.json','mechanism-summary.json'].includes(entry.name)){
    const value=JSON.parse(await readFile(path,'utf8'));collect(value);
    await put(entry.name==='fixtures.json'?'historical-fixtures':'research-receipt',relative(root,path),value,path);
   }
  }
 }
}
await walk(root);
for(const [episodeId,seed] of excluded){checked(await db().from('research_exclusions').upsert({student_id:args.student,league_id:league,episode_id:episodeId,seed_key:seed===null?null:String(seed),reason:'Consumed or inspected in imported research'},{onConflict:'student_id,league_id,episode_id',ignoreDuplicates:true}));exclusions++;}
console.log(JSON.stringify({artifacts,excludedEpisodes:exclusions,transcriptMessages:transcript.length,startedWork:false}));

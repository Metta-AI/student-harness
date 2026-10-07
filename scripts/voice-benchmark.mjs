// Run from the repo root: node --env-file=.env.local --experimental-strip-types scripts/voice-benchmark.mjs
// Read-only, using the most recently active account. Prints timings and sizes, never credentials or result data.
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return n(`${s}.ts`,c);throw e;}}});
const root=process.cwd();const {db,studentToken}=await import(`${root}/lib/db.ts`);const {runSoftmaxCli}=await import(`${root}/lib/voice/cli.ts`);const {readLiveLeague}=await import(`${root}/lib/voice/league.ts`);const {readVoiceWorkspace}=await import(`${root}/lib/voice/workspace.ts`);
const {data,error}=await db().from('students').select('subject_id').order('updated_at',{ascending:false}).limit(1);if(error||!data?.length)throw Error('No account available');const id=data[0].subject_id,token=await studentToken(id);
for(const args of [['episodes','--help'],['episodes','--help']]){const r=await runSoftmaxCli(token,{program:'coworld',args});console.log(JSON.stringify({command:'episodes --help',exitCode:r.exitCode,...r.timing,bytes:r.stdout.length}));}
const args=['divisions','--league','league_3c60897b-25cf-4b37-9d1a-8554c1198f28','--json'];
const results=await Promise.all([runSoftmaxCli(token,{program:'coworld',args}),runSoftmaxCli(token,{program:'coworld',args})]);
console.log(JSON.stringify({command:'divisions (two simultaneous requests)',requests:results.map(r=>({exitCode:r.exitCode,...r.timing,bytes:r.stdout.length}))}));
for(const [name,run] of [['league snapshot',()=>readLiveLeague(id,token)],['workspace summary',()=>readVoiceWorkspace(id)]]){const start=performance.now();const result=await run();console.log(JSON.stringify({operation:name,durationMs:Math.round(performance.now()-start),bytes:JSON.stringify(result).length}));}

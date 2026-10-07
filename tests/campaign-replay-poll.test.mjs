import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return n(`${s}.ts`,c);throw e;}}});
const {sha,releaseFingerprint}=await import('../lib/campaigns/model.ts');
let previous,audit,downloads,requests,reserved;
const manifest={game:{runnable:{source_url:'pinned'}}},replay=Buffer.from('replay');
const release={coworldId:'cow',sourceUrl:'pinned',fingerprint:releaseFingerprint(manifest)};
mock.module('../lib/db.ts',{namedExports:{db:()=>({from(table){const filters={};const q={
 select(){return q;},eq(k,v){filters[k]=v;return q;},in(){return q;},order(){return q;},limit(){return q;},
 async maybeSingle(){assert.deepEqual(filters,{'student_id':'owner','league_id':'league','kind':'replay-evidence','content->>episodeId':'ereq-test','content->>slot':'2'});return {data:previous?{content:previous}:null,error:null};},
 upsert(){return q;},then(resolve,reject){return Promise.resolve({data:table==='research_fixtures'&&reserved?[{id:'reserved'}]:[],error:null}).then(resolve,reject);}
 };return q;}})}});
mock.module('../lib/campaigns/store.ts',{namedExports:{checked:r=>r.data,readArtifact:async()=>null,artifact:async()=> 'evidence'}});
mock.module('../lib/campaigns/provider.ts',{namedExports:{sourceForHash:async()=> 'source',episodeArtifact:async(t,id,kind)=>{
 downloads++;return {spec:{coworld_id:'cow',manifest,players:Array(10).fill({content_hash:sha('source')})},results:{seed:1},'player-status':{},replay}[kind];
}}});
mock.module('../lib/campaigns/worker.ts',{namedExports:{readReplayAudit:async(r,j,e,s)=>{assert.deepEqual(r,release);assert.equal(s.studentId,'owner');return audit;},requestReplayAudit:async()=>{requests++;return {status:'queued',jobId:'a'.repeat(64)};}}});
const {inspectReplay}=await import('../lib/campaigns/evidence.ts');
const inspect=()=>inspectReplay('owner','token','league','ereq-test',2,'campaign','task');
function reset(){reserved=false;downloads=0;requests=0;previous={episodeId:'ereq-test',slot:2,release,replayHash:sha(replay),results:{seed:1},audit:{status:'queued',jobId:'a'.repeat(64)}};audit={status:'running',jobId:'a'.repeat(64)};}
test('research audit polling reuses saved inputs and still refreshes completed receipts',async()=>{
 reset();let result=await inspect();assert.equal(result.audit.status,'running');assert.equal(downloads,0);
 audit={status:'completed',result:{release:release.fingerprint,replayHash:sha(replay),vm:{source_hash:sha('source')}}};
 result=await inspect();assert.equal(result.subjectVmReexecuted,true);assert.equal(downloads,0);assert.deepEqual(result.results,{seed:1});
 previous=result;await inspect();assert.equal(downloads,4);assert.equal(requests,1);
 reset();audit=null;await inspect();assert.equal(downloads,4);assert.equal(requests,1);
});
test('research polling retains holdout protection and rejects mismatched audit receipts',async()=>{
 reset();reserved=true;await assert.rejects(inspect(),/reserved/);assert.equal(downloads,0);
 reset();audit={status:'completed',result:{release:'wrong',replayHash:sha(replay)}};
 await assert.rejects(inspect(),/identity mismatch/);assert.equal(downloads,0);
});

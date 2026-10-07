import {test} from 'node:test';import assert from 'node:assert/strict';import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return n(`${s}.ts`,c);throw e;}}});
const {verifyAudit}=await import('../lib/campaigns/provider.ts');const {hashObject,sha}=await import('../lib/campaigns/model.ts');
function sample(){const manifest={game:{version:'pinned'}},replay=Buffer.from('fake-replay'),config={seed:12,draft_mode:'open'};
 const fixture={slot:0,seed:12,hashes:Array(10).fill('hash'),config,release:{coworldId:'cow-test',fingerprint:hashObject(manifest)}};
 const spec={manifest,coworld_id:'cow-test',game_config:config,players:Array.from({length:10},()=>({content_hash:'hash'}))};
 const result={seed:12,ticks:1440,outcome:'RedTeam',total_xp:Array(10).fill(100),scores:[100,100,100,100,100,0,0,0,0,0]};
 const status={players:Array.from({length:10},(_,slot)=>({slot,exit_code:0}))};
 const native={release:fixture.release.fingerprint,replayHash:sha(replay),simulation:{ticks:1440,seed:12,winner:0,hash_mismatches:0,heroes:Array.from({length:10},()=>({xp:100}))},vm:{source_hash:'hash',validated_hashes:1440}};
 return {fixture,spec,result,status,replay,native};}
const check=x=>verifyAudit(x.fixture,'hash','ereq-test',x.spec,x.result,x.status,x.replay,x.native);
test('promotion evidence requires exact release, roster, seed, exit statuses, score and VM hashes',()=>{
 assert.equal(check(sample()).win,true);
 for(const mutate of [x=>x.spec.manifest.game.version='changed',x=>x.spec.players[1].content_hash='wrong',x=>x.result.seed=11,x=>x.status.players[9].exit_code=1,x=>x.result.scores[0]=101,x=>x.native.simulation.hash_mismatches=1,x=>x.native.vm.source_hash='wrong',x=>x.native.replayHash='wrong',x=>x.native.simulation.heroes[0].xp=99]){const x=sample();mutate(x);assert.throws(()=>check(x));}
});
test('time-limit draws are neither wins nor losses and have zero score',()=>{
 const x=sample();x.result.outcome='time_limit';x.result.scores.fill(0);x.native.simulation.winner=-1;
 const result=check(x);assert.equal(result.utility,.5);assert.equal(result.win,false);assert.equal(result.loss,false);
});
test('mirrored immutable containers match, but changed images or runtime metadata still fail',async()=>{
 const {releaseFingerprint}=await import('../lib/campaigns/model.ts');
 const x=sample(),digest='a'.repeat(64);
 x.spec.manifest.game.runnable={image:`public.ecr.aws/game@sha256:${digest}`,source_url:'pinned-source'};
 x.fixture.release.fingerprint=releaseFingerprint(x.spec.manifest);x.native.release=x.fixture.release.fingerprint;
 x.spec.manifest.game.runnable.image=`private.ecr.aws/execution/game@sha256:${digest}`;
 assert.equal(check(x).audit,'verified');
 x.spec.manifest.game.runnable.image=`private.ecr.aws/execution/game@sha256:${'b'.repeat(64)}`;
 assert.throws(()=>check(x),/release changed/);
 x.spec.manifest.game.runnable.image=`private.ecr.aws/execution/game@sha256:${digest}`;
 x.spec.manifest.game.runnable.source_url='different-source';assert.throws(()=>check(x),/release changed/);
 assert.notEqual(releaseFingerprint({game:{runnable:{image:'a:latest'}}}),releaseFingerprint({game:{runnable:{image:'b:latest'}}}));
});

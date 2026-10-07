import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return n(`${s}.ts`,c);throw e;}}});
const {extendFixtures,freshSeedFixtures}=await import('../lib/campaigns/fixtures.ts');
const {campaignInputSchema,protocolSchema}=await import('../lib/campaigns/model.ts');
const baseline={versionId:'baseline',sourceHash:'baseline-hash'};
const input=seed=>({episodeId:`ereq-${seed}`,seed,roster:Array.from({length:10},(_,i)=>`p${i}`),hashes:Array.from({length:10},(_,i)=>`h${i}`),config:{seed},release:{fingerprint:'release'}});
test('new campaigns use fresh seeds without changing explicit or legacy evaluation modes',()=>{
 const input={objective:'Improve league performance',leagueId:'league_test',requestKey:'test-start'};
 assert.equal(campaignInputSchema.parse(input).protocol.fixtureMode,'fresh-seeds');
 assert.equal(campaignInputSchema.parse({...input,protocol:{confirmationPairs:128}}).protocol.fixtureMode,'fresh-seeds');
 assert.equal(campaignInputSchema.parse({...input,protocol:{fixtureMode:'league'}}).protocol.fixtureMode,'league');
 assert.equal(protocolSchema.parse({}).fixtureMode,'league');
});
test('incremental fixture selection skips consumed/duplicate seeds without restarting valid work',()=>{
 const a=extendFixtures([], [input(1),input(2),input(1),null,input(99)],baseline,['99'],4);
 assert.deepEqual(a.map(f=>f.seed),[1,2]);
 const b=extendFixtures(a,[input(2),input(3),input(4),input(5)],baseline,['99'],4);
 assert.deepEqual(b.map(f=>f.seed),[1,2,3,4]);assert.deepEqual(b.map(f=>f.slot),[0,5,1,6]);
 assert.equal(b[0],a[0]);assert.equal(a.length,2);
});
test('fresh seeds are reproducible, exclude seen seeds, and preserve paired league settings',()=>{
 const templates=[1,2,3,4].map(input),before=structuredClone(templates);
 const fixtures=freshSeedFixtures('campaign',3,templates,baseline,[],168);
 assert.deepEqual(fixtures,freshSeedFixtures('campaign',3,templates,baseline,[],168));
 assert.equal(new Set(fixtures.map(f=>f.seed)).size,168);
 assert.ok(fixtures.every(f=>!templates.some(t=>t.seed===f.seed)&&f.seed>=0&&f.seed<2147483647));
 assert.equal(new Set(fixtures.map(f=>f.episodeId)).size,168);
 assert.deepEqual(templates,before);
 for(let i=0;i<160;i+=10)assert.equal(new Set(fixtures.slice(i,i+10).map(f=>f.slot)).size,10);
 for(const f of fixtures){
  assert.match(f.episodeId,/^generated_/);assert.ok(templates.some(t=>t.episodeId===f.templateEpisodeId));
  assert.equal(f.config.seed,f.seed);assert.equal(f.roster[f.slot],'baseline');
  for(let slot=0;slot<10;slot++)assert.equal(f.hashes[slot],slot===f.slot?'baseline-hash':`h${slot}`);
 }
 const excluded=fixtures.slice(0,10).map(f=>String(f.seed));
 assert.ok(freshSeedFixtures('campaign',3,templates,baseline,excluded,168).every(f=>!excluded.includes(String(f.seed))));
 assert.notEqual(freshSeedFixtures('campaign',4,templates,baseline,[],1)[0].seed,fixtures[0].seed);
 assert.throws(()=>freshSeedFixtures('campaign',3,[],baseline,[],1),/No compatible/);
});
test('subject placement changes exactly one source/version and leaves input metadata untouched',()=>{
 const inputs=Array.from({length:10},(_,i)=>input(i));const original=structuredClone(inputs);
 const fixtures=extendFixtures([],inputs,baseline,[],10);
 assert.equal(new Set(fixtures.map(f=>f.slot)).size,10);assert.deepEqual(inputs,original);
 for(const f of fixtures)for(let i=0;i<10;i++){
  assert.equal(f.roster[i],i===f.slot?'baseline':`p${i}`);
  assert.equal(f.hashes[i],i===f.slot?'baseline-hash':`h${i}`);
 }
});

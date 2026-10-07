import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return n(`${s}.ts`,c);throw e;}}});
const {policySourceHash}=await import('../lib/campaigns/provider.ts');
const hash='a'.repeat(64),version='our-version';
const completed=(id,roster=['other',version])=>({id,status:'completed',policy_version_ids:roster});
async function run(routes,check){
 const original=globalThis.fetch,requests=[];
 globalThis.fetch=async url=>{const path=new URL(url).pathname.replace('/api/observatory','')+new URL(url).search;requests.push(path);assert.ok(path in routes,`Unexpected request ${path}`);const r=routes[path];return new Response(JSON.stringify(r.body??r),{status:r.status??200});};
 try{await check(requests);}finally{globalThis.fetch=original;}
}
const stats=`/stats/policy-versions/${version}`,page=`/v2/policy-versions/${version}/episode-requests?limit=100`;
test('source identity scans past failed pages and uses the correct roster slot',async()=>{
 await run({[stats]:{},[page]:{entries:Array.from({length:100},(_,i)=>({id:`failed-${i}`,status:'error',policy_version_ids:[version]})),next_cursor:'next/page'},
  [`${page}&cursor=next%2Fpage`]:{entries:[completed('ereq_foreign',['foreign']),completed('ereq_good')]},
  '/v2/episode-requests/ereq_good/artifacts/spec':{players:[{content_hash:'b'.repeat(64)},{content_hash:hash}]}},async requests=>{
   assert.equal(await policySourceHash('token',version),hash);assert.equal(requests.length,4);
  });
});
test('direct source hashes need no episode reads; missing artifacts fall through to another completed record',async()=>{
 await run({[stats]:{player_file_content_hash:hash}},async requests=>{assert.equal(await policySourceHash('token',version),hash);assert.equal(requests.length,1);});
 await run({[stats]:{},[page]:{entries:[completed('ereq_missing'),completed('ereq_good')]},
  '/v2/episode-requests/ereq_missing/artifacts/spec':{status:404,body:{}},
  '/v2/episode-requests/ereq_good/artifacts/spec':{players:[{}, {content_hash:hash}]}},async()=>assert.equal(await policySourceHash('token',version),hash));
});
test('pagination cycles, transient transport failures and invalid identities fail explicitly',async()=>{
 await run({[stats]:{},[page]:{entries:[],next_cursor:'same'},[`${page}&cursor=same`]:{entries:[],next_cursor:'same'}},async()=>assert.rejects(policySourceHash('token',version),/did not advance/));
 await run({[stats]:{},[page]:{entries:[completed('ereq_bad')]},'/v2/episode-requests/ereq_bad/artifacts/spec':{status:503,body:{}}},async()=>assert.rejects(policySourceHash('token',version),/503/));
 await run({[stats]:{},[page]:{entries:[]}},async()=>assert.rejects(policySourceHash('token',version),/No source identity/));
 await run({[stats]:{},[page]:{entries:[completed('ereq_bad')]},'/v2/episode-requests/ereq_bad/artifacts/spec':{players:[{}, {content_hash:'invalid'}]}},async()=>assert.rejects(policySourceHash('token',version)));
});

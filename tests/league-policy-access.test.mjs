import assert from 'node:assert/strict';
import {test,mock} from 'node:test';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return n(`${s}.ts`,c);throw e;}}});
mock.module('../lib/db.ts',{namedExports:{policyVersionBySoftmaxId:async(student,id)=>student==='alice'&&id==='local'?{revision_number:2}:null}});
mock.module('../lib/softmax.ts',{namedExports:{listLeagueSubmissions:async token=>token==='alice-token'?[{policy_version:{id:'external'}}]:[]}});
const {leaguePolicyAccess}=await import('../lib/league-policy-access.ts');
test('local and external league policies are readable only for their owner',async()=>{
 assert.deepEqual(await leaguePolicyAccess('alice','alice-token','local'),{revision:2});
 assert.deepEqual(await leaguePolicyAccess('alice','alice-token','external'),{revision:null});
 assert.equal(await leaguePolicyAccess('bob','bob-token','external'),null);
 assert.equal(await leaguePolicyAccess('alice','alice-token','someone-else'),null);
});

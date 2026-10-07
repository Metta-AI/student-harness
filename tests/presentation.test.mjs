import assert from 'node:assert/strict';import {test,mock} from 'node:test';import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){try{return next(specifier,context);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&specifier.startsWith('.')&&!/\.[a-z]+$/i.test(specifier))return next(`${specifier}.ts`,context);throw e;}}});
const {viewSchema,presentationInputSchema,initialPresentation,showPresentation,backPresentation}=await import('../lib/workspace/presentation.ts');
const view=(name)=>viewSchema.parse({view:name,reason:'Recorded evidence'});
test('pin queues a new view without replacing evidence; back restores the previous descriptor',()=>{
 let state=showPresentation(initialPresentation,view('performance'));state={...state,pinned:true};state=showPresentation(state,view('strategy'));assert.equal(state.current.view,'performance');assert.equal(state.pending.view,'strategy');
 state=showPresentation({...state,pinned:false},state.pending);assert.equal(state.current.view,'strategy');state=backPresentation(state);assert.equal(state.current.view,'performance');assert.equal(state.pinned,false);
});
test('presentation contract rejects script/HTML/URL fields and unknown navigation',()=>{
 for(const input of [{view:'evil'},{view:'performance',html:'<script>'},{view:'strategy',url:'https://untrusted.test'},{view:'performance',last:1000}])assert.equal(viewSchema.safeParse({reason:'test',...input}).success,false);
 assert.equal(presentationInputSchema.safeParse({view:'performance',reason:'test'}).success,false);
});
let requestedStudent=null;let version={id:'our-version',ir:{strategy:[{id:'R_retreat'}]}};
mock.module('../lib/db.ts',{namedExports:{experimentByXp:async(student,id)=>student==='alice'&&id==='xreq_00000000-0000-0000-0000-000000000001'?{xp_request_id:id}:null,latestPolicyVersion:async(student)=>{requestedStudent=student;return version;},policyVersionByRevision:async(student)=>{requestedStudent=student;return version;},db:()=>({from:()=>({select:()=>({eq:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:null})})})})})})}});
const {preparePresentation}=await import('../lib/workspace/presentation-server.ts');
test('prepared views validate saved source and investigation ownership',async()=>{
 const prepared=await preparePresentation('alice',{view:'strategy',reason:'Inspect retreat',revision:2,branchId:'R_retreat',requestToken:'current-turn'});assert.equal(prepared.status,'prepared');assert.equal(requestedStudent,'alice');
 await assert.rejects(()=>preparePresentation('alice',{view:'strategy',reason:'Inspect',branchId:'R_unknown',requestToken:'current-turn'}));
 await assert.rejects(()=>preparePresentation('alice',{view:'experiments',reason:'Inspect',cycleId:'a0000000-0000-0000-0000-000000000001',requestToken:'current-turn'}));
 version=null;await assert.rejects(()=>preparePresentation('alice',{view:'strategy',revision:3,reason:'Inspect',requestToken:'current-turn'}));
});

test('experiment presentations require workspace ownership',async()=>{
 const input={view:'experiments',reason:'Inspect test',experimentId:'xreq_00000000-0000-0000-0000-000000000001',requestToken:'current-turn'};
 assert.equal((await preparePresentation('alice',input)).status,'prepared');
 await assert.rejects(()=>preparePresentation('bob',input),/unavailable/);
});

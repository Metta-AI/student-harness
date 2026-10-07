import assert from 'node:assert/strict';import {test,mock} from 'node:test';import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return n(`${s}.ts`,c);throw e;}}});
mock.module('../lib/session.ts',{namedExports:{currentSession:async()=>({subjectId:'alice',token:'token'}),sameOrigin:()=>true}});
const {createVoiceLease}=await import('../lib/voice/server.ts');const {POST}=await import('../app/api/voice/tool/route.ts');
test('server rejects GoTA worker actions from a voice session bound to another league',async()=>{
 process.env.SESSION_SECRET='c'.repeat(64);
 const lease=createVoiceLease('alice','live','league_ad6dc809-4696-46f5-99a5-fc2b1c58d082');
 const original=globalThis.fetch;let requests=0;globalThis.fetch=async()=>{requests++;throw Error('No workspace action should run');};
 try{for(const [name,args] of [['start_research',{direction:'Investigate the latest losses'}],['pause_research',{}],['research_status',{}],['read_workspace',{}]]){
  const response=await POST(new Request('http://localhost/api/voice/tool',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lease,callId:'test',name,args})}));
  assert.equal(response.status,400);assert.match(JSON.stringify(await response.json()),/default GoTA workspace/);
 }assert.equal(requests,0);}finally{globalThis.fetch=original;}
});

import assert from 'node:assert/strict';import {test,mock} from 'node:test';import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){try{return next(specifier,context);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&specifier.startsWith('.')&&!/\.[a-z]+$/i.test(specifier))return next(`${specifier}.ts`,context);throw e;}}});
let student=null,origin=true,fetches=0;
mock.module('../lib/session.ts',{namedExports:{currentSession:async()=>student,sameOrigin:()=>origin}});
mock.module('../lib/voice/transcript-store.ts',{namedExports:{recentVoiceHistory:async()=>[{role:'user',text:'How are our retreats?'}],registerVoiceSession:async()=>{}}});
mock.module('../lib/preferences-store.ts',{namedExports:{userPreferences:async()=>({preferredName:'Aaron',voice:'vesper',responseLength:'concise',reasoningEffort:'low',liveCaptions:true})}});
const {POST}=await import('../app/api/voice/session/route.ts');
const {verifyVoiceLease}=await import('../lib/voice/server.ts');
const request=(body={sdp:'test-valid-offer'})=>new Request('http://localhost:3000/api/voice/session',{method:'POST',headers:{origin:'http://localhost:3000','content-type':'application/json'},body:JSON.stringify(body)});
process.env.OPENAI_API_KEY='test-secret-not-public';process.env.SESSION_SECRET='b'.repeat(64);
test('session rejects unauthenticated, cross-origin and malformed offers before contacting OpenAI',async()=>{
 const stub=mock.method(globalThis,'fetch',async()=>{fetches++;throw Error('Should not be called');});
 try{student=null;assert.equal((await POST(request())).status,401);student={subjectId:'alice'};origin=false;assert.equal((await POST(request())).status,403);origin=true;assert.equal((await POST(request({sdp:''}))).status,400);assert.equal(fetches,0);}finally{stub.mock.restore();}
});
test('session keeps key server-side and returns only answer plus account-bound lease',async()=>{
 student={subjectId:'voice-success'};let sent;
 const stub=mock.method(globalThis,'fetch',async(url,options)=>{sent={url,options};return Response.json({session:{id:'live-123',secret:'provider-private'},transport:{sdp:'answer'}});});
 try{const result=await(await POST(request())).json();assert.equal(result.sdp,'answer');assert.equal(verifyVoiceLease(result.lease,'voice-success').session,'live-123');assert.deepEqual(Object.keys(result).sort(),['lease','sdp','sessionId']);assert(!JSON.stringify(result).includes('secret'));assert.equal(sent.options.headers.Authorization,'Bearer test-secret-not-public');assert.equal(JSON.parse(sent.options.body).session.model,'gpt-live-1');assert.equal(JSON.parse(sent.options.body).session.audio.output.voice,'vesper');assert.equal((await POST(request())).status,429);}finally{stub.mock.restore();}
});
test('provider credential errors never echo a key or upstream body',async()=>{
 student={subjectId:'voice-invalid-key'};const stub=mock.method(globalThis,'fetch',async()=>Response.json({error:{message:'Bad key test-secret-not-public'}},{status:401}));const log=mock.method(console,'error',()=>{});
 try{const response=await POST(request());assert.equal(response.status,502);const body=await response.text();assert(body.includes('server key'));assert(!body.includes('test-secret-not-public'));assert(!JSON.stringify(log.mock.calls).includes('test-secret-not-public'));}finally{stub.mock.restore();log.mock.restore();}
});

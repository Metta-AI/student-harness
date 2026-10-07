import assert from 'node:assert/strict';
import {test} from 'node:test';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return n(`${s}.ts`,c);throw e;}}});
const {transcriptTurns}=await import('../lib/voice/transcript.ts');
const {validateCli}=await import('../lib/voice/cli.ts');
const {viewDocumentSchema}=await import('../lib/views/model.ts');
const {createVoiceLease,verifyVoiceLease,verifyVoiceTranscriptLease}=await import('../lib/voice/server.ts');
const event=(role,text,start_ms,sequence)=>({role,text,start_ms,end_ms:start_ms+200,sequence,kind:'transcript'});
test('transcripts preserve exact fragments, alternating speakers, pauses and timeline order',()=>{
 const turns=transcriptTurns([event('user',' latest league?',9000,4),event('user','Hello',0,0),event('assistant','Hey.',1000,1),event('user','Check the',8700,3),event('user','How are we doing?',5000,2)]);
 assert.deepEqual(turns.map(t=>[t.role,t.text]),[['user','Hello'],['assistant','Hey.'],['user','How are we doing?'],['user','Check the latest league?']]);
});
test('CLI exposes read operations without accepting login, shell execution, local simulation or server override',()=>{
 for(const args of [['leagues','--json'],['results','league_test','--json'],['episodes','--help'],['xp-request','get','xreq_test','--json']])assert.doesNotThrow(()=>validateCli({program:'coworld',args}));
 for(const input of [{program:'softmax',args:['get-token']},{program:'coworld',args:['download']},{program:'coworld',args:['run-episode']},{program:'coworld',args:['submit','policy:v1']},{program:'coworld',args:['leagues','--server=https://evil.test']},{program:'coworld',args:['xp-request','create','xp.json']},{program:'coworld',args:['leagues\ncat /etc/passwd']}])assert.throws(()=>validateCli(input));
});
test('custom views reject executable URLs and mismatched table rows',()=>{
 const base={title:'League comparison',blocks:[{type:'table',title:'Scores',columns:['Policy','Score'],rows:[['ours','2']],evidence:[{label:'League',href:'https://softmax.com/observatory/v2'}]}]};
 assert(viewDocumentSchema.safeParse(base).success);
 assert(!viewDocumentSchema.safeParse({...base,blocks:[{...base.blocks[0],rows:[['ours']]}]}).success);
 for(const href of ['javascript:alert(1)','data:text/html,<script>','https://user:password@evil.test'])assert(!viewDocumentSchema.safeParse({...base,blocks:[{...base.blocks[0],evidence:[{label:'Bad',href}]}]}).success);
});
test('offline transcript lease remains account-bound and cannot extend tool authority',()=>{
 process.env.SESSION_SECRET='a'.repeat(64);const lease=createVoiceLease('alice','live-test');const now=Date.now;
 Date.now=()=>now()+2*3600000;
 try{assert.throws(()=>verifyVoiceLease(lease,'alice'));assert.equal(verifyVoiceTranscriptLease(lease,'alice').session,'live-test');assert.throws(()=>verifyVoiceTranscriptLease(lease,'bob'));}finally{Date.now=now;}
});

test('transcript outbox survives an upload failure and acknowledges without duplicating fragments',async()=>{
 const {VoiceJournal}=await import('../lib/voice/journal.ts');
 const storage=new Map();const oldStorage=globalThis.localStorage,oldFetch=globalThis.fetch;
 globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
 let attempts=0;const saved=[];
 globalThis.fetch=async(_url,options)=>{attempts++;if(attempts===1)return new Response(null,{status:503});const body=JSON.parse(options.body);saved.push(...body.events);return Response.json({saved:body.events.map(e=>e.event_id)});};
 const statuses=[];const journal=new VoiceJournal('lease',v=>statuses.push(v));
 try{journal.append({event_id:'fragment-1',kind:'transcript',role:'user',text:'Repeat repeat ',start_ms:100,end_ms:200});await journal.flush();assert.equal(storage.size,1);await journal.close();assert.equal(storage.size,0);assert.equal(saved[0].text,'Repeat repeat ');assert.equal(statuses.at(-1),true);}finally{await journal.close();globalThis.localStorage=oldStorage;globalThis.fetch=oldFetch;}
});

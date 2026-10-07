import assert from 'node:assert/strict';
import {test,mock} from 'node:test';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return n(`${s}.ts`,c);throw e;}}});
const league='league_3c60897b-25cf-4b37-9d1a-8554c1198f28';
let student={subjectId:'alice'},origin=true,legacy=false;
let rows={chat_sessions:[{student_id:'alice',session_id:'chat-alice'},{student_id:'bob',session_id:'chat-bob'}],voice_sessions:[{student_id:'alice',id:'voice-a',chat_session_id:null,league_id:league},{student_id:'bob',id:'voice-b',chat_session_id:null,league_id:league},{student_id:'alice',id:'voice-other',chat_session_id:null,league_id:'league_other'}],voice_events:[]};
const db={from(table){let filters=[],filterKeys=[],fields='',action=null,payload=null,single=false;const q={
 select(v){fields=v;return q;},eq(k,v){filterKeys.push(k);filters.push(r=>r[k]===v);return q;},is(k,v){filters.push(r=>(r[k]??null)===v);return q;},in(k,v){filters.push(r=>v.includes(r[k]));return q;},gt(k,v){filters.push(r=>r[k]>v);return q;},order(){return q;},limit(){return q;},maybeSingle(){single=true;return q;},update(v){action='update';payload=v;return q;},insert(v){action='insert';payload=[v];return q;},upsert(v){action='insert';payload=v;return q;},then(resolve){
 if(legacy&&(['league_id','chat_session_id','after_message_id'].some(k=>fields.includes(k)||filterKeys.includes(k)||JSON.stringify(payload??{}).includes(k))))return Promise.resolve({data:null,error:{code:'42703'}}).then(resolve);
 const data=rows[table].filter(r=>filters.every(f=>f(r)));
 if(action==='update')data.forEach(r=>Object.assign(r,payload));if(action==='insert')rows[table].push(...payload);
 return Promise.resolve({data:single?data[0]??null:data.map(r=>({...r})),error:null}).then(resolve);
 }};return q;}};
mock.module('../lib/db.ts',{namedExports:{db:()=>db}});
mock.module('../lib/session.ts',{namedExports:{currentSession:async()=>student,sameOrigin:()=>origin}});
const {GET,PATCH}=await import('../app/api/voice/transcripts/route.ts');
const {registerVoiceSession,appendVoiceEvents}=await import('../lib/voice/transcript-store.ts');
const patch=(chatSessionId,voiceSessionIds)=>PATCH(new Request('http://localhost/api/voice/transcripts',{method:'PATCH',body:JSON.stringify({chatSessionId,voiceSessionIds})}));
test('voice/text links enforce account ownership, league scope and immutable conversation assignment',async()=>{
 assert.equal((await patch('chat-bob',['voice-a'])).status,404);
 assert.equal((await patch('chat-alice',['voice-b'])).status,409);
 assert.equal((await patch('chat-alice',['voice-other'])).status,409);
 assert.equal((await patch('chat-alice',['voice-a'])).status,200);
 assert.equal((await patch('chat-alice',['voice-a'])).status,200);
 rows.chat_sessions.push({student_id:'alice',session_id:'chat-another'});
 assert.equal((await patch('chat-another',['voice-a'])).status,409);
 const result=await(await GET(new Request('http://localhost/api/voice/transcripts?chat=chat-alice'))).json();assert.deepEqual(result.sessions.map(r=>r.id),['voice-a']);
 student={subjectId:'bob'};assert.deepEqual((await(await GET(new Request('http://localhost/api/voice/transcripts?chat=chat-alice'))).json()).sessions,[]);
 student=null;assert.equal((await patch('chat-alice',['voice-a'])).status,401);student={subjectId:'alice'};origin=false;assert.equal((await patch('chat-alice',['voice-a'])).status,403);origin=true;
});
test('pre-migration database keeps voice recording and history working',async()=>{
 legacy=true;
 await registerVoiceSession('alice','legacy-call','model',league);
 assert(rows.voice_sessions.some(r=>r.id==='legacy-call'));
 await appendVoiceEvents('alice','legacy-call',[{event_id:'event-1',after_message_id:'text-1',kind:'transcript',text:'Hello',sequence:0}]);
 assert.equal(rows.voice_events.at(-1).text,'Hello');assert.equal(rows.voice_events.at(-1).after_message_id,undefined);
 assert.equal((await GET(new Request('http://localhost/api/voice/transcripts'))).status,200);
 assert.equal((await GET(new Request('http://localhost/api/voice/transcripts?session=legacy-call'))).status,200);
 const chat=await(await GET(new Request('http://localhost/api/voice/transcripts?chat=chat-alice'))).json();assert.equal(chat.linkingAvailable,false);
 assert.equal((await patch('chat-alice',['voice-a'])).status,503);
 legacy=false;
});

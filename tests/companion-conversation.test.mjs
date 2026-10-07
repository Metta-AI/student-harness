import assert from 'node:assert/strict';
import {test} from 'node:test';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){try{return next(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return next(`${s}.ts`,c);throw e;}}});
const {spokenMessages,mergeSpokenMessages,readVoiceConversation}=await import('../lib/voice/conversation.ts');
const {campaignCompanion,companionPrompts}=await import('../lib/partner/companion-summary.ts');
const fragment=(id,role,text,after,sequence,session='call-a')=>({event_id:id,kind:'transcript',role,text,after_message_id:after,session_id:session,sequence,start_ms:sequence*200,end_ms:sequence*200+100,received_at:new Date(1700000000000+sequence*200).toISOString()});
test('spoken turns preserve exact content, stable IDs and text boundaries across call reconnects',()=>{
 const events=[fragment('a','user','Hello ',null,0),fragment('b','user','Preston',null,1),fragment('c','assistant','Hi!','text-a',2),fragment('d','assistant','Yes.','text-b',3),fragment('a','user','New call','text-b',4,'call-b')];
 const spoken=spokenMessages([...events,events[0]]);
 assert.deepEqual(spoken.map(m=>m.text),['Hello Preston','Hi!','Yes.','New call']);
 assert.equal(spokenMessages(events.slice(0,1))[0].id,spoken[0].id);
 const text=[{id:'text-a',text:'Typed question'},{id:'text-b',text:'Typed follow-up'}];
 assert.deepEqual(mergeSpokenMessages(text,spoken).map(m=>m.text),['Hello Preston','Typed question','Hi!','Typed follow-up','Yes.','New call']);
});
test('voice history reads every page and fails visibly instead of returning incomplete history',async()=>{
 const prior=globalThis.fetch;const urls=[];
 try{globalThis.fetch=async url=>{urls.push(url);return Response.json({events:[fragment(String(urls.length),'user','Hi',null,urls.length)],next:urls.length===1?999:null});};
 const result=await readVoiceConversation('call/a',new AbortController().signal);assert.equal(result.length,2);assert(urls[1].includes('after=999'));assert(result.every(e=>e.session_id==='call/a'));
 globalThis.fetch=async()=>new Response(null,{status:503});await assert.rejects(readVoiceConversation('call-a',new AbortController().signal));
 }finally{globalThis.fetch=prior;}
});
test('campaign updates choose actual latest completed evidence and handle paused, stale and failed states',()=>{
 const campaign={id:'campaign',task_id:'root',objective:'Improve our policy (league_secret-id).',state:'running',phase:'screen',cycle:3};
 const tasks=[{id:'old',status:'completed',updated_at:'2026-10-06',context:{campaignId:'campaign'},result:{summary:'Old evidence'}},{id:'new',status:'completed',updated_at:'2026-10-07',context:{campaignId:'campaign'},result:{summary:'Latest evidence'}},{id:'other',status:'completed',updated_at:'2026-10-08',context:{campaignId:'other'},result:{summary:'Unrelated'}}];
 const summary=campaignCompanion(campaign,tasks);assert.equal(summary.finding,'Latest evidence');assert.equal(summary.sourceId,'new');assert(!summary.title.includes('league_'));assert.match(summary.status,/comparing/);
 assert.match(campaignCompanion({...campaign,state:'paused'},tasks).status,/paused/);
 assert.match(campaignCompanion({...campaign,state:'failed'},tasks).status,/snag/);
 assert.match(campaignCompanion(campaign,tasks,true).status,/saved findings/);
 assert.equal(campaignCompanion(undefined,tasks).finding,null);
 assert.equal(companionPrompts('episodes',true,true)[0].label,'Walk me through this replay');
 assert.equal(companionPrompts('opponents',false,false)[1].label,'Help me choose a direction');
});

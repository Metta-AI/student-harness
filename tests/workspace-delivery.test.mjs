import assert from 'node:assert/strict';
import {test,mock} from 'node:test';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){try{return next(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return next(`${s}.ts`,c);throw e;}}});

let settings={enabled:false,call_limit:12,game_limit:2};
let failure=false;const wakes=new Map();const views=[];const bootstraps=[];
mock.module('../lib/tasks/store.ts',{namedExports:{rpc:async(name,args)=>bootstraps.push({name,args})}});
mock.module('../lib/db.ts',{namedExports:{studentToken:async()=>'',db:()=>({from(table){
  let row;const query={
    select(){return query;},
    eq(column,value){assert.equal(column,'student_id');assert.equal(value,'alice');return query;},
    async maybeSingle(){assert.equal(table,'research_settings');return {data:settings,error:null};},
    async upsert(value,options){
      assert.equal(table,'research_wakes');assert.deepEqual(options,{onConflict:'student_id,event_key',ignoreDuplicates:true});
      if(failure)return {error:{message:'Database unavailable'}};
      wakes.set(value.event_key,value);return {error:null};
    },
    insert(value){assert.equal(table,'preston_views');row=value;return query;},
    async single(){if(failure)return {error:{message:'Database unavailable'}};views.push(row);return {data:{id:'f0000000-0000-4000-8000-000000000001'},error:null};},
  };return query;
}})}});
const {default:research}=await import('../agent/tools/autoresearch.ts');
const {default:createView}=await import('../agent/tools/create_view.ts');
const ctx={session:{id:'chat-1',auth:{current:{authenticator:'student-harness',principalId:'alice',attributes:{}}}},callId:'call-1'};

test('autoresearch delivery is scoped, idempotent, and preserves pause and limits',async()=>{
  const before=structuredClone(settings);
  const status=await research.execute({action:'status'},ctx);
  assert.equal(status.settings.enabled,false);
  for(let i=0;i<2;i++){
    const receipt=await research.execute({action:'investigate',direction:'Investigate missed regrouping opportunities.'},ctx);
    assert.equal(receipt.queued,true);assert.match(receipt.note,/Paused work stays paused/);
  }
  assert.equal(wakes.size,1);
  assert.deepEqual([...wakes.values()][0],{student_id:'alice',event_key:'chat:chat-1:call-1',reason:'Investigate missed regrouping opportunities.'});
  assert.deepEqual(settings,before);assert.equal(bootstraps.length,0);
  failure=true;
  await assert.rejects(research.execute({action:'investigate',direction:'Inspect replay evidence.'},{...ctx,callId:'failed'}),/Database unavailable/);
  assert.equal(wakes.size,1);failure=false;
});

test('view delivery saves grounded blocks and returns the request token; failed saves do not claim success',async()=>{
  const input={requestToken:'current-turn',title:'Where to improve',blocks:[{type:'table',title:'Results',columns:['Policy','Wins'],rows:[['hero:v8','8 of 12']],evidence:[{label:'League results',href:'https://softmax.com/observatory/v2'}]}]};
  const receipt=await createView.execute(input,ctx);
  assert.equal(receipt.presentation.requestToken,'current-turn');
  assert.equal(receipt.presentation.view,'custom');
  assert.equal(views[0].student_id,'alice');
  assert.equal(views[0].league_id,'league_3c60897b-25cf-4b37-9d1a-8554c1198f28');
  assert.equal(views[0].document.blocks[0].rows[0][1],'8 of 12');
  failure=true;await assert.rejects(createView.execute(input,ctx),/Could not save view/);failure=false;
  assert.equal(views.length,1);
  await assert.rejects(createView.execute({...input,blocks:[{type:'html',html:'<script>run()</script>'}]},ctx));
  assert.equal(views.length,1);
});

test('workspace tool execution requires the authenticated student',async()=>{
  const anonymous={...ctx,session:{...ctx.session,auth:{}}};
  await assert.rejects(research.execute({action:'investigate',direction:'Analyze a replay.'},anonymous),/No signed-in student/);
  await assert.rejects(createView.execute({},anonymous),/No signed-in student/);
});

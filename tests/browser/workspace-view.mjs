import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const baseURL = process.env.BROWSER_TEST_URL || 'http://localhost:3000';
const browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
page.setDefaultTimeout(15000);
const errors = []; page.on('pageerror', e => errors.push(e.message));
const policyId = 'e0000000-0000-4000-8000-000000000088';
let episodeFailure = false;
const outcomes = ['lost', 'time_limit', 'won', 'lost', 'won', 'won', 'time_limit', 'won', 'won', 'won', 'won', 'won'];
const episodes = outcomes.map((outcome, i) => ({ id: `episode-${i}`, status: 'completed', created_at: new Date(Date.UTC(2026, 9, 7, i)).toISOString(), completed_at: new Date(Date.UTC(2026, 9, 7, i, 5)).toISOString(), outcome, score: outcome === 'won' ? 1 : 0, round: { number: i + 100 }, opponents: [{ policy: i % 2 ? 'rival:v2' : 'challenger:v2', player: i % 2 ? 'Rival' : 'Challenger', policyVersionId: 'rival', seats: 5 }], teammates: [], seats: [0, 1, 2, 3, 4], side: 'Red', format: 'team', replay_url: 'https://softmax.com/replay', episode_id: `played-${i}` }));
await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.origin !== new URL(baseURL).origin) return route.abort();
  const send = json => route.fulfill({ json });
  if (url.pathname === '/api/session') return send({ email: 'alice@example.com', name: 'Alice', subjectId: 'alice' });
  if (url.pathname === '/api/workspace') return send({ versions: [], experiments: [], latest: null, latestUpload: null, player: null, draft: null });
  if (url.pathname === '/api/arena') return send({ league: { rounds_paused_at: null }, episodes: [] });
  if (url.pathname === '/api/policy-stats') return send({ policies: [{ policy_version_id: policyId, player_id: 'player-4', policy_label: 'hero:v8', episodes_played: 12 }], currentPolicyId: policyId, entered: [policyId], entries: [{ policyVersionId: policyId, playerId: 'player-4', playerName: 'Alice', policyLabel: 'hero:v8', active: true, status: 'active' }], standings: Array.from({ length: 12 }, (_, i) => ({ rank: i + 1, player_id: `player-${i}`, player_name: i === 4 ? 'Alice' : ['Arena Champion', 'Tower Power', 'Lane Legend', 'Fort Knox', '', 'Rival', 'Challenger'][i] ?? `Player ${i + 1}`, policy_label: i === 4 ? 'hero:v8' : `arena:v${i + 1}`, score: 24 - i * 1.35, score_label: 'MMR', rounds_played: 40 - i })), checkedAt: new Date().toISOString() });
  if (url.pathname === '/api/league-episodes') return episodeFailure ? route.fulfill({ status: 503, json: { error: 'Fixture unavailable' } }) : send({ policyVersionId: policyId, episodes: [...episodes].reverse(), nextCursor: null });
  if (url.pathname === '/api/league-record') return send({ policyVersionId: policyId, games: 12, wins: 8, losses: 2, time_limits: 2, window_hours: 72, complete: true });
  if (url.pathname === '/api/replay-session') return send({ ready: true, url: `${baseURL}/fixture-replay` });
  if (url.pathname === '/fixture-replay') return route.fulfill({ contentType: 'text/html', body: '<p>Fixture replay</p>' });
  if (url.pathname === '/api/episode-stats') return send({ steps: 100, game_stats: {}, policy_stats: [] });
  if (url.pathname === '/api/partner') return send({ available: true, claims: [] });
  if (url.pathname === '/api/research') return send({ available: true, cycles: [], events: [], plans: [], usage: [], evaluations: [] });
  if (url.pathname === '/api/tasks') return send({ tasks: [], workers: [] });
  if (url.pathname === '/api/chats') return send({ chats: [] });
  if (url.pathname === '/api/views') return send({ views: [] });
  if (url.pathname === '/api/coaching' || url.pathname === '/api/voice/transcripts') return send({ sessions: [] });
  if (url.pathname === '/api/preferences') return send({ liveCaptions: true });
  if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 404, json: { error: 'No fixture' } });
  return route.continue();
});

const artifactId='f0000000-0000-4000-8000-000000000001';
const leagueId='league_3c60897b-25cf-4b37-9d1a-8554c1198f28';
const sends=[];const reads=[];
let failSend=false;let failView=false;let noView=false;let failSettings=false;
let failSettingsRead=false;let streamGate=null;let staleView=false;let saveGate=null;
let preferences={chatModel:'claude-sonnet-5-5',reasoningEffort:'low',liveCaptions:true};
const preferenceWrites=[];
await page.route('**/api/preferences',async route=>{
 if(route.request().method()==='GET'&&failSettingsRead)return route.fulfill({status:503,json:{error:'Preferences unavailable'}});
 if(route.request().method()==='POST'){
  if(saveGate)await saveGate;
  preferenceWrites.push(route.request().postDataJSON());
  if(failSettings)return route.fulfill({status:503,json:{error:'Save failed'}});
  preferences={...preferences,...route.request().postDataJSON()};
 }
 return route.fulfill({json:preferences});
});
const blocked=Array.from({length:3},(_,i)=>({id:`blocked-${i}`,kind:'research',status:'needs_input',phase:'evaluate',objective:'Improve policy',checkpoint:{},context:{},result:null,updated_at:`2026-10-07T0${i}:00:00Z`,reason:'You have no credits remaining. Add credits to continue using the API at [Evidence](https://platform.openai.com/settings/organization/billing/).'}));
await page.route('**/api/tasks',route=>route.fulfill({json:{tasks:blocked,workers:[],campaigns:[]}}));
await page.route('**/api/views?*',route=>{
  const url=new URL(route.request().url());reads.push(Object.fromEntries(url.searchParams));
  if(failView)return route.fulfill({status:503,json:{error:'Unavailable'}});
  return route.fulfill({json:{id:artifactId,created_at:'2026-10-07T20:00:00Z',document:{title:'Your path to first place',summary:'The leader is ahead by 5.4 MMR.',blocks:[{type:'bar_chart',title:'League comparison',unit:'MMR',points:[{label:'You',value:18.6},{label:'Leader',value:24}],evidence:[]},{type:'steps',title:'Where you can help',items:[{label:'Review a retreat',detail:'Coach one loss to identify a missed chance to regroup.'}],evidence:[]}]}}});
});
const sessions=new Map();
let turnFailure=false;let askHuman=false;
await page.route('**/eve/**',async route=>{
  const url=new URL(route.request().url());
  const matched=url.pathname.match(/session\/([^/]+)/);
  if(route.request().method()==='POST'){
    const body=route.request().postDataJSON();sends.push({...body,path:url.pathname});
    if(failSend)return route.fulfill({status:503,json:{error:'Agent unavailable'}});
    const id=matched?.[1]??`view-session-${sends.length}`;
    const prior=sessions.get(id)??[];const sequence=prior.length;const turnId=`turn_${sequence}`;
    const pending=askHuman&&!body.inputResponses;
    const events=[...(body.inputResponses?[{type:'input.resolved',data:{sequence,turnId,resolutions:[{requestId:'question-1',response:body.inputResponses[0]}]}}]:[]),{type:'message.received',data:{message:body.message??'Follow-up',sequence,turnId}},
      ...(pending||noView||body.clientContext.mode!=='view'||turnFailure?[]:[{type:'action.result',data:{status:'completed',sequence,stepIndex:0,turnId,result:{kind:'tool-result',callId:`create-${sequence}`,toolName:'create_view',output:{status:'prepared',presentation:{view:'custom',artifactId,requestToken:staleView?'old-turn':body.clientContext.presentation.requestToken,last:10,reason:'Your path to first place'}}}}}]),
      ...(pending?[{type:'input.requested',data:{sequence,stepIndex:0,turnId,requests:[{requestId:'question-1',kind:'question',display:'select',allowFreeform:true,prompt:'Should the team regroup before the tower?',options:[{id:'regroup',label:'Regroup first'},{id:'push',label:'Keep pushing'}],action:{kind:'tool-call',toolName:'ask_question',callId:'question-call',input:{prompt:'Should the team regroup before the tower?'}}}]} }]:turnFailure?[{type:'turn.failed',data:{code:'MODEL_CALL_FAILED',message:'Credits unavailable',sequence,turnId}}]:[
      ...(body.clientContext.mode==='research'?[{type:'action.result',data:{status:'completed',sequence,stepIndex:0,turnId,result:{kind:'tool-result',callId:`research-${sequence}`,toolName:'autoresearch',output:{queued:true}}}}]:[]),
      {type:'message.appended',data:{messageDelta:body.clientContext.mode==='research'?'Research is queued within your workspace limits.':body.clientContext.mode==='learn'?'Your policy should regroup before approaching the tower.':'Here is the replay to review.',sequence,stepIndex:1,turnId}},
      {type:'turn.completed',data:{sequence,turnId}}]),
      {type:'session.waiting',data:{continuationToken:id,wait:pending?'input-required':'next-user-message'}}].map((event,i)=>({...event,meta:{id:`${id}-${sequence}-${i}`,at:'2026-10-07T20:00:00Z',deliveryIds:[`delivery-${sends.length}`]}}));
    sessions.set(id,[...prior,...events]);
    return route.fulfill({status:202,headers:{'x-eve-session-id':id},json:{ok:true,sessionId:id,deliveryId:`delivery-${sends.length}`,status:'accepted'}});
  }
  if(streamGate)await streamGate;
  const id=matched?.[1];const events=sessions.get(id)??[];
  return route.fulfill({status:200,headers:{'content-type':'application/x-ndjson','x-eve-stream-format':'ndjson','x-eve-stream-version':'25','x-eve-stream-tail-index':String(events.length)},body:events.map(e=>JSON.stringify(e)).join('\n')+'\n'});
});
try {
  await page.goto(baseURL,{waitUntil:'domcontentloaded'});
  const form=page.getByRole('region',{name:'Ask Preston',exact:true});
  const task=page.getByRole('region',{name:'Request workspace',exact:true});
  const result=task.getByRole('region',{name:'Request result',exact:true});
  const close=async()=>task.getByRole('button',{name:'Workspace',exact:true}).click();
  const start=async(label,text)=>{
    const count=sends.length;
    await form.getByRole('button',{name:label,exact:true}).click();
    assert.equal(sends.length,count);
    if(text)await form.getByLabel('What do you want to do?').fill(text);
    await form.getByRole('button',{name:'Send to Preston',exact:true}).click();
    await task.waitFor();
  };
  await start('Compare policies','Compare my policy with the leader');
  await result.getByRole('heading',{name:'Your path to first place'}).waitFor();
  assert.equal(sends.length,1);
  assert.equal(sends[0].clientContext.surface,'request-workspace');
  assert.equal(sends[0].clientContext.leagueId,leagueId);
  assert.equal(sends[0].clientContext.policyId,policyId);
  assert.equal(await page.locator('#present-chat').isVisible(),false);
  assert(reads.every(r=>r.league===leagueId));
  await result.getByRole('button',{name:'Ask about League comparison'}).click();
  assert.match(await task.getByLabel('Follow up with Preston').inputValue(),/League comparison/);
  assert.equal(sends.length,1,'Canvas exploration prepares a draft');
  await task.getByRole('button',{name:'Pin request',exact:true}).click();
  await task.getByLabel('Follow up with Preston').fill('Show the nearest rival too');
  await task.getByRole('button',{name:'Send follow-up',exact:true}).click();
  await task.locator('.request-message.user').filter({hasText:'Show the nearest rival too'}).waitFor();
  await page.waitForFunction(()=>document.querySelector('[aria-label="Follow up with Preston"]').value==='');
  assert.equal(sends.length,2);
  assert(sends[1].path.includes('view-session-1'),'Follow-ups use the same session');
  assert.notEqual(sends[0].clientContext.presentation.requestToken,sends[1].clientContext.presentation.requestToken);
  await mkdir('/tmp/student-harness-coaching',{recursive:true});
  await page.screenshot({path:'/tmp/student-harness-coaching/immersive-desktop.png'});
  await task.getByRole('button',{name:'Expand result',exact:true}).click();
  assert.equal(await task.getByRole('complementary',{name:'Request conversation'}).isVisible(),false);
  await task.getByRole('button',{name:'Show conversation',exact:true}).click();
  await close();
  const recent=page.getByRole('navigation',{name:'Recent requests'});
  await recent.getByRole('button',{name:/Compare my policy with the leader/}).click();
  assert.equal(sends.length,2,'Reopening does not send');
  await close();
  await page.reload({waitUntil:'domcontentloaded'});
  await recent.getByRole('button',{name:/Pinned.*Compare my policy with the leader/}).click();
  await result.getByRole('heading',{name:'Your path to first place'}).waitFor();
  assert.equal(sends.length,2,'Reload resumes without replaying work');
  await close();
  for(const [label,mode,answer] of [['Learn my policy','learn','Your policy should regroup before approaching the tower.'],['Coach a replay','do','Here is the replay to review.'],['Run autoresearch','research','Research is queued within your workspace limits.']]){
    await start(label);
    await result.getByText(answer,{exact:true}).waitFor();
    assert.equal(sends.at(-1).clientContext.mode,mode);
    assert.equal(await page.locator('#present-chat').isVisible(),false);
    if(mode==='research')await result.getByRole('heading',{name:'Research queued'}).waitFor();
    await close();
  }
  askHuman=true;
  await start('Coach a replay');
  const question=task.locator('.request-question');
  await question.getByText('Should the team regroup before the tower?',{exact:true}).waitFor();
  const beforeInput=sends.length;
  await question.getByRole('button',{name:'Regroup first'}).click();
  await result.getByText('Here is the replay to review.',{exact:true}).waitFor();
  assert.equal(sends.length,beforeInput+1);
  assert.deepEqual(sends.at(-1).inputResponses,[{requestId:'question-1',optionId:'regroup'}]);
  askHuman=false;await close();
  failSend=true;
  await start('Learn my policy');
  await task.getByRole('alert').waitFor();
  const failureCount=sends.length;
  failSend=false;
  await task.getByRole('alert').getByRole('button',{name:'Try again'}).click();
  await result.getByText('Your policy should regroup before approaching the tower.',{exact:true}).waitFor();
  assert.equal(sends.length,failureCount+1);
  await close();
  turnFailure=true;
  await start('Learn my policy');
  await task.getByRole('alert').getByText('Credits unavailable').waitFor();
  turnFailure=false;
  await close();
  staleView=true;
  await start('Compare policies');
  await result.getByText('Here is the replay to review.',{exact:true}).waitFor();
  assert.equal(await result.getByRole('heading',{name:'Your path to first place'}).count(),0);
  await close();staleView=false;failView=true;
  await start('Compare policies');
  await result.getByRole('button',{name:'Retry view'}).waitFor();
  failView=false;await result.getByRole('button',{name:'Retry view'}).click();
  await result.getByRole('heading',{name:'Your path to first place'}).waitFor();
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'/tmp/student-harness-coaching/immersive-mobile-result.png'});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await task.getByRole('button',{name:'Conversation',exact:true}).click();
  await task.getByLabel('Follow up with Preston').waitFor();
  await page.screenshot({path:'/tmp/student-harness-coaching/immersive-mobile-chat.png'});
  await close();
  failSettingsRead=true;
  await page.reload({waitUntil:'domcontentloaded'});
  await form.getByRole('alert').filter({hasText:'Settings couldn’t load'}).waitFor();
  await form.getByLabel('What do you want to do?').fill('Explain the league');
  assert(await form.getByRole('button',{name:'Send to Preston',exact:true}).isDisabled());
  failSettingsRead=false;await form.getByRole('button',{name:'Retry settings'}).click();
  await page.waitForFunction(()=>!document.querySelector('.workspace-composer-send').disabled);
  assert.deepEqual(errors,[]);
  console.log('PASS: Immersive request canvas, same-session follow-ups, pins and reload, Learn/Do/Research, failures and retry, stale output, mobile, settings guard.');
}catch(error){console.log(JSON.stringify({sends:sends.map(s=>({path:s.path,mode:s.clientContext?.mode})),errors,body:await page.locator('body').innerText()},null,2));await page.screenshot({path:'/tmp/immersive-failure.png'});throw error;}finally{await browser.close();}

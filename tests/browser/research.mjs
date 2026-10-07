import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const baseURL=process.env.BROWSER_TEST_URL || 'http://localhost:3000';
const browser=await chromium.launch({...(process.env.CHROME_EXECUTABLE ? {executablePath:process.env.CHROME_EXECUTABLE} : {}),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1050}});let available=true;const errors=[];page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
let taskReadGate=null;let releaseTaskReads;
const tasks=[{id:'task-1',objective:'Investigate early retreats',acceptance_criteria:'Find the cause and test one focused change.',status:'running',phase:'propose',checkpoint:{},result:null,reason:null,model_calls:3,max_model_calls:24,games_requested:0,max_games:1,reported_cost_usd:0,cost_reports:0,updated_at:'2026-10-02T08:00:00Z'}, {id:'task-2',objective:'Review tower positioning',acceptance_criteria:'Inspect positioning evidence.',status:'needs_input',phase:'evaluate',checkpoint:{},result:{summary:'Need a replay observation.'},reason:'Please identify the retreat moment.',model_calls:5,max_model_calls:24,games_requested:1,max_games:1,reported_cost_usd:0,cost_reports:0,updated_at:'2026-10-02T07:00:00Z'}];
const workers=[{task_id:'task-1',worker_key:'proposal:0',role:'Proposal 1',status:'completed',output:{summary:'Review retreat threshold'},updated_at:'2026-10-02T08:00:00Z'},{task_id:'task-1',worker_key:'proposal:1',role:'Proposal 2',status:'running',output:null,updated_at:'2026-10-02T08:00:00Z'}];
let claims=[{id:'claim-1',version:1,kind:'hypothesis',author:'present',createdAt:'2026-10-02T07:00:00Z',revision:null,statement:'Earlier grouping could help us defend the middle lane.',situation:'When multiple opponents are pushing the middle lane.',action:'Bring nearby heroes together before taking the fight.',expected:'Our heroes engage together instead of arriving one at a time.',falsifier:'Grouping gives up a side lane without improving the middle fight.',evidence:[{kind:'observation',ref:'',detail:'At 01:20 in our last replay, two heroes arrived after the fight ended.'}],positions:{human:'disagree',present:'open'},history:[{actor:'human',stance:'disagree',note:'I think the side lane is the bigger problem.',at:'2026-10-02T07:15:00Z'}]}];

const cycleId='e0000000-0000-0000-0000-000000000001', baseId='e0000000-0000-0000-0000-000000000002', candidateId='e0000000-0000-0000-0000-000000000003';
const research={available:true,cycles:[],events:[],plans:[],usage:[],evaluations:[],versions:[{id:baseId,revision_number:1,summary:'Starter'},{id:candidateId,revision_number:2,summary:'Retreat candidate'}],experiments:[{xp_request_id:'xreq_00000000-0000-0000-0000-000000000001',policy_version_id:baseId,title:'Baseline test',status:'completed',summary:{}},{xp_request_id:'xp-candidate',policy_version_id:candidateId,title:'Candidate test',status:'completed',summary:{}}]};
let liveCaptions=true;let externalCurrent=false;let episodeFailure=false;const externalPolicy='e0000000-0000-4000-8000-000000000088';const leagueEpisodeRequests=[];
const chatSends=[];let recoveredChat=null;
const recoveryTest=process.env.TEST_CHAT_RECOVERY==='1';
const actions=[];const voiceLog=new Map();const artifactId='f0000000-0000-4000-8000-000000000001';let artifact=null;

const opponentId='00000000-0000-4000-8000-000000000009';let opponentBook={snapshots:[],notes:[],models:[],sessions:[],tasks:[]};let opponentSessionMode=false;const opponentSends=[];const savedOpponentChats=[];
const opponentProfile={policyId:opponentId,policyLabel:'rival:v9',playerId:'rival',playerName:'Rival',rank:2,rating:15,ratingLabel:'MMR',episodes:12,own:false};
await page.route('**/*',async route=>{const u=new URL(route.request().url());if(u.origin!==new URL(baseURL).origin)return route.abort();const send=x=>route.fulfill({json:x});
if(u.pathname==='/api/opponents'){
 if(route.request().method()==='POST'){const b=route.request().postDataJSON();if(b.action==='collect')opponentBook.snapshots.push({id:'snapshot-1',collected_at:new Date().toISOString(),document:{profile:opponentProfile,collectedAt:new Date().toISOString(),source:'https://softmax.com/observatory/v2',coverage:'Sample of the latest 25 league rounds.',hasMore:false,episodes:[{id:'opponent-episode',round:3,status:'completed',createdAt:new Date().toISOString(),scores:[{position:0,score:0}],replay:true,participants:[]}]}});else opponentBook.notes.push({id:'note-1',actor:'human',created_at:new Date().toISOString(),...b.note});return send({saved:true});}
 return send(u.searchParams.has('policy')?opponentBook:{profiles:[opponentProfile],tracked:opponentBook.snapshots.map(s=>({policy_id:opponentId,collected_at:s.collected_at,profile:opponentProfile})),checkedAt:new Date().toISOString(),leagueURL:'https://softmax.com/observatory/v2'});
}
if(u.pathname==='/api/voice/transcripts'){
 if(route.request().method()==='PATCH')return send({ok:true});
 if(u.searchParams.has('chat'))return send({sessions:[]});
 if(route.request().method()==='POST'){const b=route.request().postDataJSON();for(const e of b.events)voiceLog.set(e.event_id,e);return send({saved:b.events.map(e=>e.event_id)});}
 return send(u.searchParams.has('session')?{events:[...voiceLog.values()],next:null}:{sessions:[{id:'live-test',started_at:'2026-10-05T20:00:00Z'}]});
}
if(u.pathname==='/api/views'){
 if(route.request().method()==='POST'){const {requestToken,...document}=route.request().postDataJSON();artifact={id:artifactId,title:document.title,created_at:'2026-10-05T20:00:00Z',document};return send({presentation:{view:'custom',artifactId,requestToken,last:10,reason:document.title}});}
 return send(u.searchParams.has('id')?artifact:{views:artifact?[artifact]:[]});
}
if(u.pathname==='/api/presentation')return send({status:'prepared',presentation:route.request().postDataJSON()});
if(u.pathname==='/api/research/autonomy'){
 if(route.request().method()==='GET')return send({available:true,settings:research.settings??null});
 const b=route.request().postDataJSON();actions.push(b);
 if(b.action==='investigate'){
  research.settings={enabled:true,call_limit:120,game_limit:4,calls_allocated:0,games_allocated:0,expires_at:new Date(Date.now()+86400000).toISOString(),interests:''};
  research.cycles=[{id:cycleId,question:b.direction,criteria:'Compare survival and early fight timing',baseline_id:baseId,active_version_id:baseId,state:'active'}];
  research.plans=[{id:'plan-1',cycle_id:cycleId,objective:'Test a later retreat threshold',criteria:'Survival improves without extra deaths',rationale:'Check the recorded retreat evidence',status:'proposed',task_id:null}];
 }
 if(b.action==='settings')research.settings.enabled=b.enabled;
 return send({queued:true});
}
if(u.pathname==='/api/research'){
 if(route.request().method()==='GET')return send(research);
 const b=route.request().postDataJSON();actions.push(b);
 if(b.action==='create'){const c={id:cycleId,question:b.question,criteria:b.criteria,baseline_id:b.baselineId,active_version_id:b.baselineId,state:'draft',call_limit:0,game_limit:0,calls_allocated:0,games_allocated:0,expires_at:null,autonomy:false,cost_review_usd:5};research.cycles.push(c);return send({cycle:c});}
 const c=research.cycles[0];
 if(b.action==='grant')Object.assign(c,{state:'active',call_limit:b.modelCalls,game_limit:b.hostedGames,expires_at:b.expiresAt,autonomy:b.autonomy,cost_review_usd:b.costReviewUsd});
 if(b.action==='propose')research.plans.push({id:crypto.randomUUID(),cycle_id:cycleId,objective:b.objective,criteria:b.criteria,rationale:b.rationale,max_calls:b.maxCalls,status:'proposed',task_id:null,evidence:b.evidence});
 if(b.action==='pause')c.state='paused';
 if(b.action==='resume')c.state='active';
 if(b.action==='evaluate')research.evaluations.push({id:'e0000000-0000-0000-0000-000000000005',cycle_id:cycleId,baseline_id:baseId,candidate_id:candidateId,finding:b.finding,explanation:b.explanation});
 if(b.action==='select')c.active_version_id=b.versionId;
 if(b.action==='note')research.events.push({id:'event-1',sequence:1,cycle_id:cycleId,actor:'human',kind:b.kind,payload:{text:b.text},evidence:b.evidence,created_at:new Date().toISOString()});
 return send({ok:true});
}
if(u.pathname==='/api/voice/session')return send({sdp:'fake-answer',lease:'fixture-lease',sessionId:'live-test'});
if(u.pathname==='/api/voice/tool')return send({result:{queued:true}});
if(u.pathname==='/api/session')return send({email:'tester@example.test',subjectId:'partner-test'});
if(u.pathname==='/api/workspace')return send({versions:[],experiments:[],latest:null,latestUpload:null,player:null,draft:null});
if(u.pathname==='/api/experiments')return send({id:u.searchParams.get('id'),title:'Baseline test',hypothesis:'Grouping earlier should improve survival.',status:'completed',createdAt:'2026-10-05T10:00:00Z',completedAt:'2026-10-05T10:05:00Z',loadedAt:new Date().toISOString(),meanScore:12,counts:{total:2,completed:1,failed:1,scoredSeats:1},policy:{revision:1,summary:'Unchanged starter.',label:'starter:v1',revisionId:'revision-1',parent:null,researchPlan:{hypothesis:'Observe baseline.',expected:'Record outcomes.',non_trigger:'No policy changes.'},evidence:[],receipts:{performance:'not_run'}},summary:{games_completed:1},episodes:[{id:'episode-1',job_index:0,status:'completed',our_scores:[12],participant_scores:[{position:0,score:12}],replay_url:'https://softmax.com/replay',completed_at:'2026-10-05T10:05:00Z',error:null},{id:'episode-2',job_index:1,status:'failed',our_scores:[],participant_scores:[],replay_url:null,completed_at:null,error:'Worker exited before producing results.'}]});
if(u.pathname==='/api/arena')return send({league:{rounds_paused_at:null},episodes:[{id:'episode-1',run_id:'xreq_00000000-0000-0000-0000-000000000001',run_title:'Baseline test',job_index:0,created_at:'2026-10-05T10:00:00Z',completed_at:'2026-10-05T10:05:00Z',status:'completed',scores:[{policy_version_id:baseId,score:12}],participant_scores:[],replay_url:null,episode_id:null}]});
if(u.pathname==='/api/replay-snapshot')return send({snapshot:null});
if(u.pathname==='/api/episode-stats')return send({steps:100,game_stats:{},policy_stats:[]});
if(externalCurrent&&u.pathname==='/api/policy-stats')return send({policies:[{policy_version_id:externalPolicy,player_id:'ours',policy_label:'crossbow-current:v1',episodes_played:10}],currentPolicyId:externalPolicy,entered:[externalPolicy],entries:[{policyVersionId:externalPolicy,playerId:'ours',playerName:'a-aron',policyLabel:'crossbow-current:v1',active:true,status:'active'},{policyVersionId:baseId,playerId:'ours',policyLabel:'hunter-lane:v1',active:false,status:'benched'}],standings:[{rank:1,player_id:'ours',player_name:'a-aron',policy_label:'crossbow-current:v1',score:29.53,rounds_played:30}],checkedAt:new Date().toISOString()});
if(u.pathname==='/api/policy-stats')return send({policies:[{rank:1,policy_version_id:baseId,player_id:'ours',policy_label:'hunter-lane:v1',score:0,episodes_played:20,rounds_played:3}],standings:[{rank:1,player_id:'leader',player_name:'Richard',policy_label:'richard:v340',score:19.91,score_label:'MMR',rounds_played:14},{rank:36,player_id:'ours',player_name:'a-aron',policy_label:'hunter-lane:v1',score:7.38,score_label:'MMR',rounds_played:3}],entries:[{policyVersionId:baseId,playerId:'ours'}],entered:[baseId],checkedAt:new Date().toISOString()});
if(externalCurrent&&u.pathname==='/api/league-episodes'){leagueEpisodeRequests.push(u.searchParams.get('policyVersionId'));return episodeFailure?route.fulfill({status:503,json:{error:'Fixture unavailable'}}):send({policyVersionId:u.searchParams.get('policyVersionId'),episodes:[],nextCursor:null});}
if(externalCurrent&&u.pathname==='/api/league-record')return send({policyVersionId:u.searchParams.get('policyVersionId'),games:10,wins:3,losses:5,time_limits:2,window_hours:72,complete:true});
if(u.pathname==='/api/league-episodes')return send({policyVersionId:baseId,episodes:[],nextCursor:null});
if(u.pathname==='/api/league-record')return send({policyVersionId:baseId,games:20,wins:0,losses:0,time_limits:20,window_hours:72,complete:true});
if(u.pathname==='/api/coaching')return send({sessions:[]});
if(u.pathname==='/api/chats'&&route.request().method()==='POST'){const b=route.request().postDataJSON();if(b.opponent){savedOpponentChats.push(b);opponentBook.sessions.push({session_id:b.sessionId,title:b.title,updated_at:new Date().toISOString()});}return send({saved:true});}
if(u.pathname==='/api/chats')return send({chats:recoveryTest?[{session_id:'retired-chat',title:'Previous discussion',updated_at:'2026-10-05T20:00:00Z'}]:[]});
if(u.pathname==='/api/preferences')return send({reasoningEffort:'low',liveCaptions});
if(u.pathname.startsWith('/api/tasks/')){const task=tasks.find(t=>t.id===u.pathname.split('/').pop());return task?send({task,workers:workers.filter(w=>w.task_id===task.id),history:[],sessionIds:[]}):route.fulfill({status:404,json:{error:'Session not found'}});}
if(u.pathname==='/api/tasks'){if(route.request().method()==='GET'&&taskReadGate)await taskReadGate;if(route.request().method()==='POST'){const b=route.request().postDataJSON();const task={...tasks[0],...b,context:b.context??{},id:crypto.randomUUID(),status:'queued',acceptance_criteria:b.acceptanceCriteria,checkpoint:{},model_calls:0};tasks.unshift(task);opponentBook.tasks.push(task);return send({task});}if(route.request().method()==='PATCH'){const b=route.request().postDataJSON();tasks.find(t=>t.id===b.taskId).status=b.action==='pause'?'paused':'running';} return send({tasks,workers});}
if(opponentSessionMode&&u.pathname.startsWith('/eve/')){
 if(route.request().method()==='POST'){opponentSends.push({path:u.pathname,body:route.request().postDataJSON()});const id=`opponent-session-${opponentSends.length}`;return route.fulfill({status:202,headers:{'x-eve-session-id':id},json:{ok:true,sessionId:id,status:'accepted'}});}
 const id=u.pathname.includes('opponent-session-1')?'opponent-session-1':'opponent-session-2';
 const messages=[{type:'session.started',data:{}},{type:'message.received',data:{message:'Research this opponent.',sequence:0,turnId:'turn_0'}},{type:'turn.completed',data:{sequence:0,turnId:'turn_0'}},{type:'session.waiting',data:{continuationToken:id,wait:'next-user-message'}}].map((event,i)=>({...event,meta:{id:`${id}-${i}`,at:'2026-10-06T20:00:00Z'}}));
 return route.fulfill({status:200,headers:{'content-type':'application/x-ndjson','x-eve-stream-format':'ndjson','x-eve-stream-version':'25','x-eve-stream-tail-index':String(messages.length)},body:messages.map(e=>JSON.stringify(e)).join('\n')+'\n'});
}
if(recoveryTest&&u.pathname.startsWith('/eve/')){
 if(route.request().method()==='POST'){
  const body=route.request().postDataJSON();chatSends.push({path:u.pathname,body});
  if(u.pathname.endsWith('/retired-chat'))return route.fulfill({status:409,json:{ok:false,code:'session_not_active',error:'The session is no longer active.'}});
  recoveredChat=body;
  return route.fulfill({status:202,headers:{'x-eve-session-id':'recovered-chat'},json:{ok:true,sessionId:'recovered-chat',status:'accepted'}});
 }
 const fresh=u.pathname.includes('/recovered-chat/');
 const messages=[{type:'session.started',data:{}},{type:'message.received',data:{message:fresh?'Please check our latest rank.':'We discussed retreats earlier.',sequence:0,turnId:'turn_0'}},{type:'turn.completed',data:{sequence:0,turnId:'turn_0'}},{type:'session.waiting',data:{continuationToken:fresh?'recovered-chat':'retired-chat',wait:'next-user-message'}}].map((event,i)=>({...event,meta:{id:`${fresh?'new':'old'}-${i}`,at:'2026-10-05T20:00:00Z'}}));
 return route.fulfill({status:200,headers:{'content-type':'application/x-ndjson','x-eve-stream-format':'ndjson','x-eve-stream-version':'25','x-eve-stream-tail-index':String(messages.length)},body:messages.map(e=>JSON.stringify(e)).join('\n')+'\n'});
}
if(u.pathname.startsWith('/eve/'))return route.fulfill({status:503,json:{error:'No live agent in fixture'}});
if(u.pathname==='/api/partner'){
 const method=route.request().method();if(method==='POST'){const body=route.request().postDataJSON();const c={...body,id:'claim-2',version:1,author:'human',createdAt:new Date().toISOString(),revision:null,positions:{human:'open',present:'open'},history:[]};claims.unshift(c);return send({claim:c});}
 if(method==='PATCH'){const body=route.request().postDataJSON();const c=claims.find(c=>c.id===body.id);c.positions.human=body.stance;c.version++;c.history.push({actor:'human',stance:body.stance,note:body.note,at:new Date().toISOString()});return send({claim:c});}
 return send({available,claims});}
return route.continue();});
await page.addInitScript(()=>{
 window.voiceEvents=[];
 const track={enabled:true,stop(){this.enabled=false;window.testMicActive=false;},addEventListener(){}};
 Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{track.enabled=true;window.testMicActive=true;window.testMicTrack=track;return {getTracks:()=>[track],getAudioTracks:()=>[track]};}});
 class Peer {
  iceGatheringState='complete';connectionState='connected';localDescription={sdp:'fake-offer'};
  addTrack(){} async createOffer(){return {type:'offer',sdp:'fake-offer'};} async setLocalDescription(){}
  async setRemoteDescription(){setTimeout(()=>this.dc.onmessage({data:JSON.stringify({type:'session.started'})}),0);}
  createDataChannel(){const dc={readyState:'open',send(s){const e=JSON.parse(s);window.voiceEvents.push(e);if(e.type==='session.close')setTimeout(()=>dc.onmessage({data:JSON.stringify({type:'session.closed'})}),0);},close(){this.readyState='closed';},onmessage:null,onclose:null};this.dc=dc;window.testVoiceChannel=dc;return dc;}
  close(){} addEventListener(){} removeEventListener(){}
 }
 window.RTCPeerConnection=Peer;
});
try {
 if(recoveryTest)await page.addInitScript(()=>localStorage.setItem('softmax-ide-active-chat','retired-chat'));
 await page.goto(baseURL);
 const tabs=page.getByRole('tablist',{name:'Workspace views'});
 await tabs.waitFor();
 assert.equal(await page.locator('#present-chat .aui-composer-root').isVisible(),false,'typing stays tucked away until needed');
 assert.equal(await page.locator('.game-mobile-summary').count(),0,'no game status spacer');
 await page.getByRole('button',{name:'Type instead',exact:true}).click();
 assert.equal(await page.locator('#present-chat').isVisible(),true);
 if(recoveryTest){
  await page.getByText('We discussed retreats earlier.',{exact:true}).waitFor();
  const composer=page.locator('#present-chat textarea');await composer.fill('Please check our latest rank.');await composer.press('Enter');
  await page.waitForFunction(()=>localStorage.getItem('softmax-ide-active-chat')==='recovered-chat');
  assert.equal(chatSends.filter(s=>s.path.endsWith('/retired-chat')).length,1);
  assert.equal(chatSends.filter(s=>s.path.endsWith('/session')).length,1);
  assert(JSON.stringify(recoveredChat).includes('We discussed retreats earlier.'));
  assert(JSON.stringify(recoveredChat).includes('Please check our latest rank.'));
  assert.equal(await page.getByText('Chat could not finish',{exact:true}).count(),0);
  console.log('PASS: real Eve hook recovers an inactive-session rejection once, keeps context and registers the replacement conversation.');
 }

 await page.getByRole('button',{name:'Hide keyboard',exact:true}).click();

 assert.deepEqual(await tabs.getByRole('tab').allTextContents(),['Performance','Strategy','Experiments','Episodes','Opponents','Development']);
 await tabs.getByRole('tab',{name:'Opponents',exact:true}).click();
 const opponentView=page.getByRole('region',{name:'Opponent policies',exact:true});
 await opponentView.getByRole('button',{name:'Rival',exact:true}).click();
 await opponentView.getByRole('button',{name:'View full profile ↗',exact:true}).click();
 await opponentView.getByRole('button',{name:'Collect data',exact:true}).click();
 await opponentView.getByRole('table',{name:'Opponent episodes'}).waitFor();
 await opponentView.getByText('Add an observation or hypothesis',{exact:true}).click();
 await opponentView.getByLabel('Observation type',{exact:true}).selectOption('hypothesis');
 await opponentView.getByLabel('What did you notice?',{exact:true}).fill('Rival may prioritize early grouping.');
 await opponentView.getByLabel('Evidence label',{exact:true}).fill('Round 3');
 await opponentView.getByRole('button',{name:'Save note',exact:true}).click();
 await opponentView.getByText('Rival may prioritize early grouping.',{exact:true}).waitFor();
 opponentSessionMode=true;
 const originalChat=await page.evaluate(()=>localStorage.getItem('softmax-ide-active-chat'));
 await opponentView.getByRole('button',{name:'Analyze opponent',exact:true}).click();
 await page.getByRole('region',{name:'Campaigns and sessions'}).getByRole('link',{name:/Analyze · rival:v9/}).waitFor();
 assert.equal(tasks[0].kind,'research');assert.equal(tasks[0].context.policyId,opponentId);
 assert.match(tasks[0].objective,/note action/);
 await opponentView.getByRole('button',{name:'Build semantic model',exact:true}).click();
 await page.getByRole('region',{name:'Campaigns and sessions'}).getByRole('link',{name:/Model · rival:v9/}).waitFor();
 assert.match(tasks[0].objective,/save_model/);
 assert.equal(opponentSends.length,0,'Work buttons must not send to chat');
 assert.equal(savedOpponentChats.length,0,'Work buttons must not create chat sessions');
 assert.equal(await page.evaluate(()=>localStorage.getItem('softmax-ide-active-chat')),originalChat);
 await page.getByRole('region',{name:'Campaigns and sessions'}).getByRole('link',{name:/Model · rival:v9/}).click();
 const sessionPanel=page.getByRole('region',{name:'Game work'});
 await sessionPanel.getByRole('heading',{name:'Model · rival:v9',exact:true}).waitFor();
 assert.equal(new URL(page.url()).pathname,`/sessions/${tasks[0].id}`);
 await page.getByRole('region',{name:'Campaigns and sessions'}).getByRole('link',{name:/Analyze · rival:v9/}).click();
 await sessionPanel.getByRole('heading',{name:'Analyze · rival:v9',exact:true}).waitFor();
 await page.goBack();
 await sessionPanel.getByRole('heading',{name:'Model · rival:v9',exact:true}).waitFor();
 assert.equal(new URL(page.url()).pathname,`/sessions/${tasks[0].id}`);
 await page.goForward();
 await sessionPanel.getByRole('heading',{name:'Analyze · rival:v9',exact:true}).waitFor();
 await page.goBack();
 await page.reload();
 await sessionPanel.getByRole('heading',{name:'Model · rival:v9',exact:true}).waitFor();
 await sessionPanel.getByRole('region',{name:'Session history'}).waitFor();
 console.log('PASS: session URLs survive reload and back/forward switches restore the selected session.');
 await sessionPanel.getByRole('button',{name:'Pause',exact:true}).click();
 await sessionPanel.getByRole('button',{name:'Resume',exact:true}).waitFor();
 await sessionPanel.getByRole('button',{name:'Resume',exact:true}).click();
 await sessionPanel.getByLabel('Direction or new evidence').fill('Compare the most recent league episodes.');
 await sessionPanel.getByRole('button',{name:'Update direction',exact:true}).click();
 await tabs.getByRole('tab',{name:'Opponents',exact:true}).click();
 await opponentView.getByRole('button',{name:'Rival',exact:true}).click();
 opponentBook.models=[{id:'model-1',created_at:new Date().toISOString(),actor:'preston',document:{schema:'gota-opponent-semantic-ir/1',summary:'Grouping is an untested interpretation.',evidence:[{id:'e1',snapshotId:'snapshot-1',episodeId:'opponent-episode',detail:'Round 3 evidence.'}],nodes:[{id:'strategy',kind:'strategy',label:'Early grouping',claim:'May group before fights.',status:'hypothesis',evidence:['e1'],falsifier:'Repeated isolated engagements.'}],edges:[],unknowns:['Limited replay coverage.'],nextTests:['Compare another replay.']}}];
 await page.evaluate(()=>window.dispatchEvent(new Event('opponent-research-updated')));
 await opponentView.getByRole('heading',{name:'Early grouping',exact:true}).waitFor();
 await opponentView.getByText('Semantic IR',{exact:true}).click();
 assert.match(await opponentView.locator('.opponent-ir').textContent(),/gota-opponent-semantic-ir/);
 await opponentView.getByText('Semantic IR',{exact:true}).click();
 console.log('PASS: opponent work queues background sessions without chat, supports pause/resume/steer, and displays saved semantic IR.');
 await page.screenshot({path:'/tmp/preston-opponents-desktop.png'});
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.screenshot({path:'/tmp/preston-opponents-mobile.png'});await page.setViewportSize({width:1440,height:1050});
 await opponentView.getByRole('button',{name:'← Opponents',exact:true}).click();
 await opponentView.getByLabel('Search opponent policies').fill('nobody');await opponentView.getByText('No matching policies.',{exact:true}).waitFor();
 await tabs.getByRole('tab',{name:'Performance',exact:true}).click();
 await page.getByRole('heading',{name:'Performance',exact:true}).waitFor();
 await page.getByRole('region',{name:'League summary'}).getByText('#36',{exact:true}).waitFor();
 assert.equal(await page.getByRole('region',{name:'League summary'}).getByText('7.38',{exact:true}).count(),1);
 assert.equal(await page.getByRole('region',{name:'Leaderboard',exact:true}).count(),1);
 assert.equal(await page.getByRole('region',{name:'Version comparison'}).count(),0);
 assert.equal(await page.getByRole('region',{name:'Preston presentation'}).count(),0);
 await page.screenshot({path:'/tmp/preston-performance-desktop.png'});
 await page.getByLabel('Opponent filter',{exact:true}).fill('Rival');
 await tabs.getByRole('tab',{name:'Strategy',exact:true}).click();
 await page.getByRole('region',{name:'Policy strategy overview'}).waitFor();
 const branches=page.getByRole('group',{name:'Choose a strategy branch'}).getByRole('button');await branches.nth(1).click();const selectedBranch=await branches.nth(1).textContent();
 await page.getByRole('button',{name:'Inspect source ↗',exact:true}).click();
 assert.equal(await tabs.getByRole('tab',{name:'Development',exact:true}).getAttribute('aria-selected'),'true');
 await tabs.getByRole('tab',{name:'Strategy',exact:true}).click();assert.equal(await branches.filter({hasText:selectedBranch}).getAttribute('aria-pressed'),'true');
 await tabs.getByRole('tab',{name:'Development',exact:true}).click();
 const wiki=page.getByRole('region',{name:'Policy wiki',exact:true});
 const wikiNav=wiki.getByRole('navigation',{name:'Policy wiki sections'});
 await wiki.getByRole('region',{name:'Symbolic BASIC policy'}).waitFor();
 await wikiNav.getByRole('button',{name:'Semantic ontology',exact:true}).click();
 await wiki.getByLabel('Ontology layer',{exact:true}).selectOption('strategy');
 const objects=wiki.getByRole('navigation',{name:'Ontology objects'});
 await objects.getByRole('button').first().click();
 const detail=wiki.getByRole('region',{name:'Ontology object',exact:true});
 await detail.getByRole('heading',{name:'References',exact:true}).waitFor();
 await detail.locator('.wiki-relations').first().getByRole('button').first().click();
 await detail.getByRole('heading',{name:'Used by',exact:true}).waitFor();
 await detail.locator('.wiki-relations').getByRole('button').first().click();
 await detail.getByRole('button',{name:'Inspect mapped source ↗'}).click();
 await wiki.getByRole('region',{name:'Symbolic BASIC policy'}).waitFor();
 await wikiNav.getByRole('button',{name:'Beliefs & lessons',exact:true}).click();
 await wiki.getByText('Earlier grouping could help us defend the middle lane.',{exact:true}).first().waitFor();
 await wiki.getByText('No beliefs recorded in this revision.',{exact:true}).waitFor();
 await wikiNav.getByRole('button',{name:'Evidence & verification',exact:true}).click();
 await wiki.getByText('not_run',{exact:true}).first().waitFor();
 await wikiNav.getByRole('button',{name:'Game reference',exact:true}).click();
 assert((await wiki.getByRole('link',{name:/League ↗/}).getAttribute('href')).includes('league_3c60897b-25cf-4b37-9d1a-8554c1198f28'));
 await wikiNav.getByRole('button',{name:'Semantic ontology',exact:true}).click();
 await wiki.getByLabel('Search semantic ontology').fill('STRATEGY');
 assert(await objects.getByRole('button').count()>0);
 await wiki.getByText('Complete semantic IR · JSON',{exact:true}).click();
 assert((await wiki.locator('.wiki-raw pre').textContent()).includes('source_sha256'));
 const wikiLink=new URL(await wiki.getByRole('link',{name:'Page link ↗'}).getAttribute('href'),baseURL);
 assert.equal(wikiLink.searchParams.get('wiki'),'ontology');assert(wikiLink.searchParams.get('entity'));
 await wiki.getByText('Complete semantic IR · JSON',{exact:true}).click();
 await wiki.locator('.wiki-header').scrollIntoViewIfNeeded();
 await page.screenshot({path:'/tmp/preston-policy-wiki-desktop.png'});
 await page.setViewportSize({width:390,height:844});
 await wiki.locator('.wiki-header').scrollIntoViewIfNeeded();
 await page.screenshot({path:'/tmp/preston-policy-wiki-mobile.png'});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Wiki must fit mobile viewport');
 await page.setViewportSize({width:1440,height:1050});
 console.log('PASS: policy wiki links ontology objects to source, exposes beliefs, receipts, complete IR and reference links on desktop/mobile.');
 await tabs.getByRole('tab',{name:'Performance',exact:true}).click();assert.equal(await page.getByLabel('Opponent filter',{exact:true}).inputValue(),'Rival');
 await tabs.getByRole('tab',{name:'Strategy',exact:true}).click();assert.equal(await branches.first().getAttribute('aria-pressed'),'true');
 await tabs.getByRole('tab',{name:'Experiments',exact:true}).click();
 assert.equal(await page.getByLabel('Give Preston a direction',{exact:true}).isVisible(),false);
 const experimentTable=page.getByRole('table',{name:'Experiments',exact:true});await experimentTable.getByRole('button',{name:'Baseline test',exact:true}).waitFor();
 assert.equal(await experimentTable.getByRole('row').count(),5);
 await page.screenshot({path:'/tmp/preston-experiments-desktop.png'});
 await page.getByRole('button',{name:'New experiment',exact:true}).click();
 await page.getByLabel('Give Preston a direction',{exact:true}).fill('Investigate our early retreats');await page.getByRole('button',{name:'Investigate',exact:true}).click();
 await experimentTable.getByRole('button',{name:'Test a later retreat threshold',exact:true}).click();await page.getByText('Compare survival and early fight timing',{exact:true}).waitFor();
 await page.getByText(/Research settings ·/).click();await page.getByRole('button',{name:'Pause research',exact:true}).click();await page.getByText('Research paused',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Resume research',exact:true}).click();await page.getByText('Research on',{exact:true}).waitFor();
 await page.getByText(/Research settings ·/).click();
 await page.getByRole('button',{name:'Close',exact:true}).click();
 await experimentTable.getByRole('button',{name:'Baseline test',exact:true}).click();
 const experimentDetail=page.getByRole('region',{name:'Experiment details',exact:true});
 await experimentDetail.getByRole('heading',{name:'Baseline test',exact:true}).waitFor();
 assert.equal(await tabs.getByRole('tab',{name:'Experiments',exact:true}).getAttribute('aria-selected'),'true');
 await experimentDetail.getByText('Grouping earlier should improve survival.',{exact:true}).waitFor();
 const detailEpisodes=experimentDetail.getByRole('table',{name:'Experiment episodes'});
 assert.equal(await detailEpisodes.getByRole('row').count(),3);
 await detailEpisodes.getByText('Worker exited before producing results.',{exact:true}).waitFor();
 await experimentDetail.getByText('Policy revision’s research plan',{exact:true}).click();
 await experimentDetail.getByText('Observe baseline.',{exact:true}).waitFor();
 await page.screenshot({path:'/tmp/preston-experiment-detail-desktop.png'});
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:'/tmp/preston-experiment-detail-mobile.png'});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.setViewportSize({width:1440,height:1050});
 await experimentDetail.getByRole('button',{name:'← Experiments',exact:true}).click();
 await experimentTable.getByRole('button',{name:'Baseline test',exact:true}).click();
 await experimentDetail.getByRole('button',{name:'Open replay ↗',exact:true}).click();
 assert.equal(await tabs.getByRole('tab',{name:'Episodes',exact:true}).getAttribute('aria-selected'),'true');
 await page.getByRole('region',{name:'Selected replay',exact:true}).waitFor();
 await page.getByRole('button',{name:'Analyze replay',exact:true}).click();
 await page.getByRole('region',{name:'Campaigns and sessions'}).getByRole('link',{name:/Replay analysis/}).waitFor();
 assert.equal(tasks[0].context.mode,'replay');assert.equal(tasks[0].kind,'research');
 assert.equal(opponentSends.length,0,'Replay analysis must not send to chat');
 await page.getByRole('button',{name:'Close ×',exact:true}).click();
 await tabs.getByRole('tab',{name:'Experiments',exact:true}).click();
 await experimentDetail.getByRole('button',{name:'← Experiments',exact:true}).click();
 await tabs.getByRole('tab',{name:'Episodes',exact:true}).click();
 const episodeTable=page.getByRole('table',{name:'Practice episodes',exact:true});await episodeTable.waitFor();
 assert.equal(await episodeTable.getByRole('button',{name:/Open replay for/}).count(),1);
 await episodeTable.getByRole('button',{name:/Score/}).click();assert.equal(await episodeTable.getByRole('columnheader',{name:/Score/}).getAttribute('aria-sort'),'descending');
 await page.screenshot({path:'/tmp/preston-episodes-desktop.png'});
 await tabs.getByRole('tab',{name:'Episodes',exact:true}).focus();await page.keyboard.press('End');assert.equal(await tabs.getByRole('tab',{name:'Development',exact:true}).getAttribute('aria-selected'),'true');
 await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowLeft');assert.equal(await tabs.getByRole('tab',{name:'Episodes',exact:true}).getAttribute('aria-selected'),'true');
 await page.getByRole('tab',{name:/League rounds/}).click();await page.getByText(/has not played a league round yet/).waitFor();
 await page.getByRole('tab',{name:/Practice games/}).click();await episodeTable.waitFor();
 await tabs.getByRole('tab',{name:'Strategy',exact:true}).click();
 await page.getByRole('button',{name:'Talk with Preston',exact:true}).click();await page.getByText('Listening…',{exact:true}).waitFor();
 const token=await page.evaluate(()=>JSON.parse(window.voiceEvents.find(e=>e.type==='session.thinking.append').content.split('): ')[1]).presentation.requestToken);
 async function show(view,callId,tokenOverride=token){await page.evaluate(({view,callId,requestToken})=>{const emit=event=>window.testVoiceChannel.onmessage({data:JSON.stringify({type:'response.event',delegation_id:callId,event})});emit({type:'response.created',response:{id:callId}});emit({type:'response.output_item.done',item:{type:'function_call',call_id:callId,name:'present_view',arguments:JSON.stringify({requestToken,view,last:10,reason:'Evidence for our discussion'})}});emit({type:'response.completed',response:{id:callId,output:[]}});},{view,callId,requestToken:tokenOverride});}
 await show('performance','view-1');
 const extraTabs=page.getByRole('tablist',{name:'Additional views'});
 await extraTabs.getByRole('tab',{name:'Performance · Preston',exact:true}).waitFor();
 const pane=page.getByRole('region',{name:'Preston presentation'});
 assert.equal(await pane.count(),0,'new views do not crowd or replace the human workspace');
 assert.equal(await tabs.getByRole('tab',{name:'Strategy',exact:true}).getAttribute('aria-selected'),'true');
 await extraTabs.getByRole('tab',{name:'Performance · Preston',exact:true}).click();
 await pane.getByRole('heading',{name:'Recent outcomes'}).waitFor();
 assert.equal(await page.locator('#workspace-strategy').isVisible(),false);
 assert.equal(await page.locator('#present-panel .preston-presentation').count(),0);
 await show('experiments','view-2');await extraTabs.getByRole('tab',{name:'Experiments · Preston',exact:true}).waitFor();
 assert.equal(await pane.getByRole('heading',{name:'Recent outcomes'}).count(),1,'a new analysis leaves the selected view stable');
 await extraTabs.getByRole('tab',{name:'Experiments · Preston',exact:true}).click();
 await pane.getByRole('heading',{name:'Investigate our early retreats'}).waitFor();
 await show('development','view-stale','outdated');await page.waitForTimeout(100);
 assert.equal(await extraTabs.getByRole('tab',{name:'Development · Preston',exact:true}).count(),0);
 await pane.getByRole('button',{name:'Open in workspace ↗',exact:true}).click();
 assert.equal(await tabs.getByRole('tab',{name:'Experiments',exact:true}).getAttribute('aria-selected'),'true');
 assert.equal(await pane.count(),0);
 await extraTabs.getByRole('tab',{name:'Performance · Preston',exact:true}).click();
 await pane.getByLabel('Follow Preston',{exact:true}).check();await show('strategy','view-3');
 await page.waitForFunction(()=>document.getElementById('tab-strategy').getAttribute('aria-selected')==='true');
 await tabs.getByRole('tab',{name:'Performance',exact:true}).click();
 await show('episodes','view-episodes');await extraTabs.getByRole('tab',{name:'Episodes · Preston',exact:true}).click();
 await pane.getByRole('table',{name:'Presented episodes'}).waitFor();
 await pane.getByRole('button',{name:'Open in workspace ↗',exact:true}).click();await episodeTable.waitFor();
 await show('development','view-wiki');
 await extraTabs.getByRole('tab',{name:'Development · Preston',exact:true}).click();
 await pane.getByRole('heading',{name:'Overview · starter',exact:true}).waitFor();
 await pane.getByRole('button',{name:'Semantic ontology ↗',exact:true}).click();
 await wiki.getByRole('heading',{name:'Semantic ontology',exact:true}).waitFor();
 assert.equal(await tabs.getByRole('tab',{name:'Development',exact:true}).getAttribute('aria-selected'),'true');
 await tabs.getByRole('tab',{name:'Episodes',exact:true}).click();await episodeTable.waitFor();
 await page.evaluate(({token})=>{
  const emit=event=>window.testVoiceChannel.onmessage({data:JSON.stringify(event)});
  for(const [role,delta,start_ms] of [['input','Hey Preston',0],['output','Hello.',2000],['input',' Check the latest league.',4000]])emit({type:`session.${role}_transcript.delta`,event_id:`speech-${role}-${start_ms}`,delta,start_ms,end_ms:start_ms+1000});
  const event=event=>emit({type:'response.event',delegation_id:'custom-view',event});
  event({type:'response.created',response:{id:'custom-view'}});
  event({type:'response.output_item.done',item:{type:'function_call',call_id:'custom-view',name:'create_view',arguments:JSON.stringify({requestToken:token,title:'Path to the top',summary:'Measured scores and a next test.',blocks:[{type:'table',title:'Comparison',columns:['Policy','Score'],rows:[['Our policy','12'],['Leader','20']],evidence:[{label:'League snapshot',href:'https://softmax.com/observatory/v2'}]},{type:'text',title:'Next test',text:'<script>window.badView=true</script>',evidence:[]}]})}});
  event({type:'response.completed',response:{id:'custom-view',output:[]}});
 },{token});
 await extraTabs.getByRole('tab',{name:'Path to the top',exact:true}).waitFor();
 assert.equal(await pane.count(),0,'generated analysis is available without hijacking Episodes');
 await extraTabs.getByRole('tab',{name:'Path to the top',exact:true}).click();
 await pane.getByRole('heading',{name:'Path to the top'}).waitFor();assert.equal(await page.evaluate(()=>window.badView),undefined);
 await tabs.getByRole('tab',{name:'Performance',exact:true}).click();
 assert.equal(await pane.count(),0);
 await extraTabs.getByRole('tab',{name:'Path to the top',exact:true}).click();await pane.getByRole('heading',{name:'Path to the top'}).waitFor();
 await show('strategy','view-4');
 await page.getByRole('button',{name:'Pause microphone',exact:true}).click();assert.equal(await page.evaluate(()=>window.testMicTrack.enabled),false);await page.getByRole('button',{name:'Resume microphone',exact:true}).click();assert.equal(await page.evaluate(()=>window.testMicTrack.enabled),true);
 await page.getByRole('button',{name:'End voice conversation',exact:true}).click();assert.equal(await page.evaluate(()=>window.testMicActive),false);
 await page.getByText('Saving our spoken conversation…',{exact:true}).waitFor({state:'hidden'});
 assert.deepEqual([...voiceLog.values()].filter(e=>e.kind==='transcript').map(e=>e.text),['Hey Preston','Hello.',' Check the latest league.']);
 assert([...voiceLog.values()].some(e=>e.kind==='tool'&&e.text.includes('create_view')));
 await page.getByRole('button',{name:'Conversation history',exact:true}).click();await page.getByRole('navigation',{name:'Conversations',exact:true}).getByRole('button',{name:/Voice conversation/}).click();await page.locator('[data-slot=aui_spoken-message-root]').filter({hasText:'Check the latest league.'}).waitFor();
 await page.getByRole('button',{name:'New chat',exact:true}).click();
 liveCaptions=false;
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 assert.equal(await page.locator('[data-slot=aui_spoken-message-root]').count(),0);
 assert.equal([...voiceLog.values()].filter(e=>e.kind==='transcript').length,3,'hiding captions retains logged speech');
 await page.getByRole('button',{name:/Account menu for/}).click();
 assert.equal(await page.getByRole('menuitem',{name:'Settings',exact:true}).getAttribute('href'),'/settings');
 await page.keyboard.press('Escape');
 await page.screenshot({path:'/tmp/preston-workspace-desktop.png'});
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await tabs.getByRole('tab',{name:'Experiments',exact:true}).click();await experimentTable.waitFor();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:'/tmp/preston-experiments-mobile.png'});
 await page.getByRole('button',{name:'Open Preston',exact:true}).click();assert.equal(await page.locator('#present-chat').isVisible(),false);await page.getByRole('button',{name:'Back to workspace',exact:true}).click();await extraTabs.getByRole('tab',{name:'Strategy · Preston',exact:true}).click();await pane.getByRole('button',{name:'Open in workspace ↗',exact:true}).click();
 assert.equal(await tabs.getByRole('tab',{name:'Strategy',exact:true}).getAttribute('aria-selected'),'true');
 await page.screenshot({path:'/tmp/preston-workspace-mobile.png'});assert.deepEqual(errors,[]);
 await page.reload();
 await page.getByRole('tablist',{name:'Additional views'}).getByRole('tab',{name:'Path to the top',exact:true}).waitFor();
 assert.equal(await pane.count(),0,'saved custom tabs restore without taking over the workspace');
 await page.getByRole('tablist',{name:'Additional views'}).getByRole('tab',{name:'Path to the top',exact:true}).click();
 await pane.getByRole('heading',{name:'Path to the top'}).waitFor();
 await page.setViewportSize({width:1440,height:1050});
 await tabs.getByRole('tab',{name:'Performance',exact:true}).click();
 const workspaceTab=page.locator('#workspace-performance');
 const extraTabList=page.getByRole('tablist',{name:'Additional views'});if(await extraTabList.isVisible())await extraTabList.getByRole('tab',{name:'Workspace',exact:true}).click();
 externalCurrent=true;episodeFailure=true;
 await workspaceTab.getByRole('button',{name:'Refresh',exact:true}).click();
 await workspaceTab.locator('.league-overview-heading').getByText('a-aron · crossbow-current:v1',{exact:true}).waitFor();
 await workspaceTab.getByRole('region',{name:'Recent outcome trend'}).getByText('Recent episodes could not load. Use Refresh to retry.',{exact:true}).waitFor();
 assert(leagueEpisodeRequests.includes(externalPolicy));
 await workspaceTab.getByRole('region',{name:'League summary'}).getByText('30%',{exact:true}).waitFor();
 episodeFailure=false;await workspaceTab.getByRole('button',{name:'Refresh',exact:true}).click();
 await workspaceTab.getByRole('region',{name:'Recent outcome trend'}).getByText('No completed league episodes in this selection.',{exact:true}).waitFor();
 assert.equal(await workspaceTab.getByText('Loading results…',{exact:true}).count(),0);
 await page.getByRole('button',{name:'New campaign',exact:true}).click();
 const newSession=page.getByRole('region',{name:'Game work'});
 const creator=newSession.getByRole('region',{name:'Create a campaign'});
 await creator.getByRole('button',{name:/Learn from opponents/}).click();
 await creator.getByLabel('Your direction').fill('Model the top opponents and test policies that improve our league performance.');
 await creator.getByRole('button',{name:'See the plan'}).click();
 await creator.getByRole('heading',{name:'Here’s how Preston will work'}).waitFor();
 assert.equal(await creator.getByLabel('Keep learning across research cycles').isChecked(),true);
 assert.equal(await creator.getByLabel('Submit candidates that pass validation to the league').isChecked(),true);
 await creator.getByRole('button',{name:'Adjust direction'}).click();
 assert.equal(await creator.getByLabel('Your direction').inputValue(),'Model the top opponents and test policies that improve our league performance.');
 await newSession.getByRole('button',{name:'One-off session',exact:true}).click();
 await newSession.getByLabel('What should Preston work on?').fill('Compare our most recent league results.');
 await newSession.getByLabel('What would count as done?').fill('Summarize verified outcomes and evidence gaps.');
 assert.equal(await newSession.getByLabel('Session type').count(),0);
 assert.equal(await newSession.getByText('Model call limit',{exact:true}).count(),0);
 assert.equal(await newSession.getByLabel('AI budget target',{exact:true}).count(),0);
 await newSession.getByRole('link',{name:'Research usage & spending settings'}).waitFor();
 taskReadGate=new Promise(resolve=>{releaseTaskReads=resolve;});
 await newSession.getByRole('button',{name:'Start session',exact:true}).click();
 await newSession.getByRole('heading',{name:'Compare our most recent league results.',exact:true}).waitFor({timeout:3000});
 assert.equal(tasks[0].maxCostUsd,25);assert.equal(tasks[0].context.mode,'auto');
 taskReadGate=null;releaseTaskReads();
 assert.equal(tasks[0].kind,'research');assert.equal(opponentSends.length,0);
 await page.screenshot({path:'/tmp/preston-background-session-desktop.png'});
 console.log('PASS: Performance selects the external current policy, keeps name/stats/episode requests aligned, and recovers from episode errors.');
 console.log('PASS: six tabs and persistent opponent research, compact experiments, episode evidence links and sorting, keyboard navigation, retained human filters and branch selection, research direction/pause/resume, official MMR instead of policy win-rate rank, compact performance, dynamic analysis tabs, stable human view, stale rejection/open/follow/manual exit, live mic controls, persisted ordered transcripts, custom view generation/open/reopen/safe rendering, mobile.');
} catch(e){if(recoveryTest)console.log(JSON.stringify({chatSends,errors,active:await page.evaluate(()=>localStorage.getItem('softmax-ide-active-chat'))}));await page.screenshot({path:'/tmp/preston-workspace-error.png',fullPage:true});throw e;}finally{releaseTaskReads?.();await browser.close();}

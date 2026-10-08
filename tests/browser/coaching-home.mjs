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

const sessionId = 'csn_11111111-1111-4111-8111-111111111111';
const clipReads = [];
let failClips = false;
let coachRequests = 0;
const recording = await page.evaluate(async()=>{
  const canvas = document.createElement('canvas');canvas.width=320;canvas.height=180;
  const ctx=canvas.getContext('2d');
  const stream=canvas.captureStream(10);
  const recorder=new MediaRecorder(stream,{mimeType:'video/webm'});
  const chunks=[];recorder.ondataavailable=event=>chunks.push(event.data);
  const finished=new Promise(resolve=>recorder.onstop=resolve);
  recorder.start();
  let frame=0;const timer=setInterval(()=>{ctx.fillStyle='#304d38';ctx.fillRect(0,0,320,180);ctx.fillStyle='white';ctx.font='20px sans-serif';ctx.fillText('Coaching fixture '+frame++,20,90);},100);
  await new Promise(resolve=>setTimeout(resolve,2400));recorder.stop();await finished;clearInterval(timer);stream.getTracks().forEach(track=>track.stop());
  return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
});
await page.route('**/fixture-recording.webm',route=>route.fulfill({contentType:'video/webm',body:Buffer.from(recording)}));
await page.route('**/api/workspace',route=>route.fulfill({json:{versions:[
  {id:'version-1',revision:1,summary:'Stay with the team',created_at:'2026-10-05T00:00:00Z',policyVersionId:policyId,label:'hero:v8',player:'Alice',games:8,completedGames:8,scored:8,hostedMean:42.5},
  {id:'version-2',revision:2,summary:'Try a safer retreat threshold',created_at:'2026-10-06T00:00:00Z',policyVersionId:null,label:null,player:'Alice',games:0,completedGames:0,scored:0,hostedMean:null}
],experiments:[],latest:null,latestUpload:null,player:null,draft:null}}));
await page.route('**/api/coaching',route=>route.fulfill({json:{available:true,sessions:[
  {id:sessionId,episode_id:'played-1',created_at:'2026-10-07T00:00:00Z',duration_ms:2000,latest_analysis:{id:'analysis-1',status:'complete'},policy_reference:{policy_version_id:policyId}},
  {id:'other-league-session',episode_id:'unrelated',created_at:'2026-10-08T00:00:00Z',duration_ms:1000,latest_analysis:{id:'other',status:'complete'},policy_reference:{policy_version_id:'unrelated'}}
]}}));
await page.route('**/api/coaching/*',route=>{
  clipReads.push(new URL(route.request().url()).pathname.split('/').pop());
  return failClips?route.fulfill({status:503,json:{error:'Fixture failure'}}):route.fulfill({json:{session:{id:sessionId,duration_ms:2000,recording_url:baseURL+'/fixture-recording.webm',timeline:[]},analysis:{moments:[{start_ms:500,observation:'The team splits near the tower',coaching_intent:'Should we regroup before moving forward?'}],questions:['What would you do differently?']}}});
});
await page.route('**/api/tasks',route=>route.fulfill({json:{tasks:[{id:'needs-human',kind:'research',status:'needs_input',phase:'evaluate',objective:'Review retreat behavior',checkpoint:{},reason:'Should the team regroup before approaching the tower?',context:{},result:null,updated_at:'2026-10-07T00:00:00Z'}],workers:[],campaigns:[]}}));
await page.route('**/eve/**',route=>{if(route.request().method()==='POST')coachRequests++;return route.fulfill({status:503,json:{error:'No agent in fixture'}});});
try {
  await page.goto(baseURL,{waitUntil:'domcontentloaded'});
  const home=page.locator('#workspace-performance');
  await home.getByRole('region',{name:'Current policy and standing'}).getByText('#5',{exact:true}).waitFor();
  assert.equal(await page.getByRole('tab').count(),0,'Shared workspace has no secondary navigation');
  assert.equal(await page.getByRole('region',{name:'Latest policies'}).count(),0);
  assert.equal(await page.getByRole('navigation',{name:'Workspace mode'}).evaluate(el=>!!el.closest('header.partner-header')),true);
  assert.equal(await page.getByText('THE COMPETITION',{exact:true}).count(),0);
  await home.getByRole('heading',{name:'The team splits near the tower',exact:true}).waitFor();
  await home.getByRole('region',{name:'Preston needs your input'}).getByText('Should the team regroup before approaching the tower?',{exact:true}).waitFor();
  assert(clipReads.every(id=>id===sessionId),'Only selected policy/league recordings are loaded');
  assert.equal(await home.getByRole('button',{name:'Watch & coach ↗',exact:true}).count(),1);
  await mkdir('/tmp/student-harness-coaching',{recursive:true});
  await page.screenshot({path:'/tmp/student-harness-coaching/home.png'});
  const clips=home.getByRole('region',{name:'Saved coaching clips'});
  await clips.getByRole('button',{name:/Play clip at/}).click();
  const video=clips.getByLabel('Coaching clip player');await video.waitFor();
  await page.waitForFunction(()=>{const video=document.querySelector('.home-clip-player video');return video?.currentTime>=.5;});
  await page.waitForFunction(()=>{const video=document.querySelector('.home-clip-player video');return video?.paused&&video.currentTime>=2;});
  await clips.getByRole('button',{name:'Close clip ×'}).click();
  await home.getByRole('region',{name:'Suggested coaching'}).scrollIntoViewIfNeeded();
  await page.screenshot({path:'/tmp/student-harness-coaching/moments.png'});
  assert.equal(coachRequests,0,'Loading and watching do not start agent work');
  await home.getByRole('button',{name:'Watch & coach ↗',exact:true}).first().click();
  await page.getByRole('region',{name:'Selected league replay'}).waitFor();
  assert.equal(await page.getByRole('table').count(),0,'Shared coaching shows no episode browser');
  await page.getByRole('button',{name:'← Back',exact:true}).click();
  await home.getByRole('button',{name:'Answer Preston ↗'}).click();
  await page.locator('#present-chat').waitFor({state:'visible'});
  await page.getByRole('button',{name:'Hide chat',exact:true}).click();
  await page.getByRole('button',{name:'Preston’s Lab',exact:true}).click();
  await page.getByRole('tab',{name:'Performance',exact:true}).click();
  await page.getByRole('region',{name:'Leaderboard'}).waitFor();
  await page.getByRole('button',{name:'Workspace',exact:true}).click();
  assert.equal(await page.getByRole('region',{name:'Leaderboard'}).count(),0);
  await page.setViewportSize({width:390,height:844});
  await home.getByRole('region',{name:'Suggested coaching'}).scrollIntoViewIfNeeded();
  await page.screenshot({path:'/tmp/student-harness-coaching/mobile.png'});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  failClips=true;await page.reload();
  await home.getByRole('button',{name:'Retry clips',exact:true}).waitFor();
  failClips=false;await home.getByRole('button',{name:'Retry clips',exact:true}).click();
  await home.getByRole('heading',{name:'The team splits near the tower',exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS: minimal shared workspace, navbar switch, Lab-only detail navigation, scoped clip playback, coaching actions, mobile, retry.');
} finally {await browser.close();}

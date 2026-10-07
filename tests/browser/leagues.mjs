import {chromium} from 'playwright';import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const main='league_3c60897b-25cf-4b37-9d1a-8554c1198f28',other='league_ad6dc809-4696-46f5-99a5-fc2b1c58d082',third='league_428e91e5-ee25-4f9c-be5e-a4fc4f993f17';
const leagues=[{id:main,name:'Gods of the Arena',game:{id:'gota',name:'Gods of the Arena'}},{id:other,name:'Competition A',game:{id:'chess',name:'Chess'}},{id:third,name:'Competition B',game:{id:'chess',name:'Chess'}}];
const queries=[];
await page.route('**/api/**',async route=>{const u=new URL(route.request().url());queries.push(u.pathname+u.search);const send=data=>route.fulfill({json:data});
 if(u.pathname==='/api/session')return send({email:'tester@test.test',subjectId:'alice',name:'Alice'});
 if(u.pathname==='/api/preferences')return send({liveCaptions:true});
 if(u.pathname==='/api/leagues')return send({leagues});
 if(u.pathname==='/api/views')return send({views:[{id:'f0000000-0000-4000-8000-000000000001',title:u.searchParams.get('league')===other?'Chess A findings':'Chess B findings'}]});
 if(u.pathname==='/api/voice/transcripts')return send({sessions:[]});
 if(u.pathname==='/api/league-overview'){const league=leagues.find(l=>l.id===u.searchParams.get('league'));assert(league);const division=u.searchParams.get('division')||'div-main';return send({league:{...league,url:'https://softmax.com',rounds_paused_at:null},division:{id:division,name:division==='div-main'?'Competition':'Training'},divisions:[{id:'div-main',name:'Competition'},{id:'div-training',name:'Training'}],standings:[{rank:2,player_id:'mine',player_name:'Alice',score:0.6,score_label:'Success',score_value_type:'percent',rounds_played:10}],ownPlayers:['mine'],rounds:[{id:'round-1',round_number:123,status:'completed',created_at:'2026-10-05T20:00:00Z'}],checkedAt:new Date().toISOString()});}
 return route.fulfill({status:404,json:{error:'Unexpected fixture endpoint'}});
});
try{
 await page.goto(`http://localhost:3000/?league=${other}`);await page.getByText('Competition A · Competition',{exact:true}).waitFor();
 await page.getByRole('cell',{name:/60(?:\.0)?%/}).waitFor();assert.equal(await page.getByText('hero.bas').count(),0);
 await page.getByRole('tab',{name:'Chess A findings'}).waitFor();
 await page.getByRole('tab',{name:'Rounds',exact:true}).click();await page.getByRole('table',{name:'League rounds'}).getByText('#123 ↗').waitFor();
 await page.getByRole('combobox',{name:'League division'}).click();await page.getByRole('option',{name:'Training',exact:true}).click();await page.getByText('Competition A · Training',{exact:true}).waitFor();
 await page.getByRole('button',{name:/Choose game and league:/}).click();await page.getByRole('textbox',{name:'Search games and leagues'}).fill('Chess');
 const results=page.getByLabel('Games and leagues');await results.getByRole('link',{name:/Competition B/}).waitFor();assert.equal(await results.getByRole('link').count(),2);
 await results.getByRole('link',{name:/Competition B/}).click();await page.getByText('Competition B · Competition',{exact:true}).waitFor();
 await page.getByRole('tab',{name:'Chess B findings'}).waitFor();assert.equal(await page.getByRole('tab',{name:'Chess A findings'}).count(),0);
 assert(queries.some(q=>q.includes('league-overview?league='+third)));assert(queries.some(q=>q.includes('views?league='+third)));
 assert(!queries.some(q=>q.startsWith('/api/workspace')||q.startsWith('/api/tasks')||q.startsWith('/api/research')));
 await page.screenshot({path:'/tmp/preston-other-league-desktop.png'});
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.getByRole('button',{name:'Open Preston',exact:true}).click();await page.getByRole('button',{name:'Back to workspace',exact:true}).click();
 await page.screenshot({path:'/tmp/preston-other-league-mobile.png'});
 await page.getByRole('button',{name:/Choose game and league:/}).click();await page.getByRole('textbox',{name:'Search games and leagues'}).fill('Gods');await page.getByLabel('Games and leagues').getByRole('link',{name:/Gods/}).waitFor();assert.equal(await page.getByLabel('Games and leagues').getByRole('link').getAttribute('href'),'/');
 assert.deepEqual(errors,[]);console.log('PASS: live catalog picker, separate same-game leagues, division switching, server score labels, scoped saved views, no GoTA workspace reads, mobile companion and default GoTA link.');
}finally{await browser.close();}

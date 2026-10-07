import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base=process.env.BROWSER_TEST_URL||'http://localhost:3000';
const browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
let mode='server-error',release;let sessionCalls=0;
await page.route('**/api/session',async route=>{
 sessionCalls++;
 if(mode==='stalled'){await new Promise(resolve=>release=resolve);return route.fulfill({json:{email:null}}).catch(()=>{});}
 if(mode==='network-error')return route.abort();
 if(mode==='server-error')return route.fulfill({status:503,body:'Unavailable'});
 if(mode==='malformed')return route.fulfill({json:{error:'Unexpected response'}});
 return route.fulfill({json:{email:null}});
});
try {
 for(const failure of ['server-error','network-error','malformed','stalled']){
  mode=failure;await page.goto(base);
  const session=page.getByRole('region',{name:'Account session'});
  await session.getByRole('button',{name:'Retry',exact:true}).waitFor({timeout:15000});
  assert.equal(await page.getByText('Loading your session…',{exact:true}).count(),0);
  assert.equal(await page.getByLabel('User token',{exact:true}).count(),0,'A lookup failure must not be treated as signed out');
  mode='success';release?.();release=null;
  const previous=sessionCalls;
  await session.getByRole('button',{name:'Retry',exact:true}).click();
  await page.getByLabel('User token',{exact:true}).waitFor();
  assert(sessionCalls>previous);
  console.log(`PASS: ${failure} leaves loading state and Retry recovers without a reload.`);
 }
 assert.deepEqual(errors,[]);
}finally{release?.();await browser.close();}

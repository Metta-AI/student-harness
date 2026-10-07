import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attemptBatch,transportCooldownUntil} from '../lib/campaigns/attempt-queue.ts';
const now=Date.parse('2026-10-07T10:00:00Z');
const a=(id,state='created',patch={})=>({id,state,xp_id:['requested','auditing'].includes(state)?`xp-${id}`:null,next_at:new Date(now-1000).toISOString(),...patch});
test('transport bursts cool submissions without stopping issued games or native audits',()=>{
 const failed=Array.from({length:3},(_,i)=>a(`failed-${i}`,'infra_failed',{updated_at:new Date(now-1000).toISOString(),attempt:0}));
 assert.equal(transportCooldownUntil(failed.slice(0,2),now),null);
 assert.equal(transportCooldownUntil(failed,now),now-1000+180000);
 const rows=[...failed,a('retry'),a('issued','requested'),a('audit','auditing')];
 assert.deepEqual(attemptBatch(rows,24,!transportCooldownUntil(rows,now),now).map(r=>r.id),['issued','audit']);
 const later=now+180000;
 assert.equal(transportCooldownUntil(rows,later),null);
 assert.deepEqual(attemptBatch(rows,24,!transportCooldownUntil(rows,later),later).map(r=>r.id),['retry','issued','audit']);
});
test('repeated infrastructure failures back off further; unrelated, invalid and stale records do not trigger cooldown',()=>{
 const failures=Array.from({length:3},()=>({state:'infra_failed',updated_at:new Date(now-1000).toISOString(),attempt:1}));
 assert.equal(transportCooldownUntil(failures,now),now-1000+360000);
 assert.equal(transportCooldownUntil(failures.map(a=>({...a,state:'invalid'})),now),null);
 assert.equal(transportCooldownUntil(failures.map(a=>({...a,updated_at:'invalid'})),now),null);
 assert.equal(transportCooldownUntil(failures.map(a=>({...a,updated_at:new Date(now-16*60_000).toISOString()})),now),null);
 assert.equal(transportCooldownUntil(failures.map(a=>({...a,updated_at:new Date(now+60_000).toISOString()})),now),null);
});
test('native audit backlog does not occupy hosted slots; both queues remain bounded',()=>{
 const rows=[...Array.from({length:30},(_,i)=>a(`audit-${i}`,'auditing')),...Array.from({length:30},(_,i)=>a(`new-${i}`))];
 const batch=attemptBatch(rows,24,true,now);
 assert.equal(batch.filter(r=>r.state==='created').length,24);assert.equal(batch.filter(r=>r.state==='auditing').length,24);
 assert.equal(new Set(batch.map(r=>r.id)).size,48);
});
test('all active hosted requests reserve capacity, including future polls and uncertain submissions',()=>{
 const rows=[a('new'),a('requested','requested'),a('later','requested',{next_at:new Date(now+10000).toISOString()}),a('uncertain','submitting')];
 assert.deepEqual(attemptBatch(rows,3,true,now).map(r=>r.id),['uncertain','requested']);
 assert.deepEqual(attemptBatch(rows,4,true,now).map(r=>r.id),['uncertain','new','requested']);
});
test('paused or invalid studies drain issued games and audits without submitting new games',()=>{
 const rows=[a('new'),a('uncertain','submitting'),a('existing','requested'),a('audit','auditing')];
 assert.deepEqual(attemptBatch(rows,24,false,now).map(r=>r.id),['existing','audit']);
});
test('terminal and not-yet-due attempts are excluded; partial hosted capacity is respected',()=>{
 const rows=[a('done','complete'),a('bad','invalid'),a('failed','infra_failed'),a('later','created',{next_at:new Date(now+1000).toISOString()}),a('audit','auditing'),a('existing','requested'),a('new1'),a('new2')];
 assert.deepEqual(attemptBatch(rows,2,true,now).map(r=>r.id),['new1','existing','audit']);
 assert.throws(()=>attemptBatch(rows,0,true,now),/Concurrency/);
});

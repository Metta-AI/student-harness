import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ReplayGrounding,validAnchor} from '../lib/research/grounding.ts';
const version='10000000-0000-0000-0000-000000000001';
test('replay grounding: delayed words retain speech-onset tick, stale anchors rejected',()=>{
 const g=new ReplayGrounding();g.update('episode',version,{src:'coworld-replay',type:'tick',tick:25,playing:true},1000);
 const onset=g.capture(1200);g.update('episode',version,{src:'coworld-replay',type:'tick',tick:90,playing:true},2000);
 assert.equal(onset.tick,25);assert.equal(g.capture(2100).tick,90);assert.ok(validAnchor(onset,9000));
 assert.equal(g.capture(5100),null);assert.equal(validAnchor(onset,130000),false);
 g.clear('episode');assert.equal(g.capture(2200),null);
});
test('replay grounding: invalid viewer payload does not manufacture a playhead',()=>{
 const g=new ReplayGrounding();
 for(const data of [{src:'elsewhere',type:'tick',tick:2,playing:true},{src:'coworld-replay',type:'tick',tick:-1,playing:true},{src:'coworld-replay',type:'ready'}]) g.update('e',version,data,1000);
 assert.equal(g.capture(1001),null);
});

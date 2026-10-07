import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mapConcurrent} from '../lib/campaigns/batch.ts';

test('parallel fixture reads preserve selection order and respect the concurrency bound',async()=>{
 let active=0,peak=0;
 const result=await mapConcurrent([4,3,2,1,0],2,async(value,index)=>{peak=Math.max(peak,++active);await new Promise(r=>setTimeout(r,value));active--;return index;});
 assert.deepEqual(result,[0,1,2,3,4]);assert.equal(peak,2);assert.equal(active,0);
});
test('failed batches settle remaining work before releasing the campaign lease',async()=>{
 let finished=false;
 await assert.rejects(mapConcurrent([0,1],2,async value=>{if(!value)throw Error('transport');await new Promise(r=>setTimeout(r,5));finished=true;}),/transport/);
 assert.equal(finished,true);
});

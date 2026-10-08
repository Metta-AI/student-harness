import assert from 'node:assert/strict';
import {test} from 'node:test';
import {reviewSuggestions,performanceAssessment} from '../lib/workspace/coaching-home.ts';

test('coaching offers contrasting completed outcomes without inventing events',()=>{
  const replays = ['won','lost','lost','time_limit','won'].map((outcome,i)=>({id:String(i),label:`Round ${i}`,kind:'league',outcome,createdAt:`2026-10-0${i+1}`,opponents:'Rival'}));
  const suggestions = reviewSuggestions(replays);
  assert.deepEqual(suggestions.map(item=>item.id),['2','3','4']);
  assert.match(suggestions[0].question,/Where would you/);
  assert.match(suggestions[1].question,/Did we miss/);
  assert.deepEqual(reviewSuggestions([]),[]);
});
test('assessment preserves window, incomplete data and time-limit distinction',()=>{
  const report = performanceAssessment(2,14,{games:268,wins:48,losses:51,time_limits:169,window_hours:72,complete:false});
  assert.match(report,/#2 among 14/);
  assert.match(report,/51 losses, and 169 time limits/);
  assert.match(report,/72 hours \(partial sample\)/);
  assert.match(report,/reviewing a time-limit replay/);
  assert.doesNotMatch(performanceAssessment(undefined,0,null),/wins|improv/);
});

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {opponentSemanticSchema} from '../lib/opponents/semantic-model.ts';
import {opponentAnalysisRequest} from '../lib/opponents/analysis.ts';
const model={schema:'gota-opponent-semantic-ir/1',summary:'A testable interpretation.',evidence:[{id:'e1',snapshotId:'00000000-0000-4000-8000-000000000001',detail:'Episode evidence.'}],nodes:[{id:'s1',kind:'strategy',label:'Group early',claim:'May group early.',status:'hypothesis',evidence:['e1'],falsifier:'Repeatedly fights alone.'}],edges:[],unknowns:['Coverage is limited.'],nextTests:['Compare another replay.']};
test('opponent IR rejects dangling links, duplicate IDs and certainty about internal beliefs',()=>{
 assert(opponentSemanticSchema.safeParse(model).success);
 for(const invalid of [
 {...model,edges:[{from:'s1',to:'missing',relation:'uses'}]},
 {...model,nodes:[model.nodes[0],model.nodes[0]]},
 {...model,evidence:[model.evidence[0],model.evidence[0]]},
 {...model,nodes:[{...model.nodes[0],evidence:['missing']}]},
 {...model,nodes:[{...model.nodes[0],falsifier:undefined}]},
 {...model,nodes:[{...model.nodes[0],status:'observed'}]},
 {...model,nodes:[{...model.nodes[0],kind:'belief',status:'observed'}]},
 {...model,nodes:[{...model.nodes[0],kind:'goal',status:'observed'}]},
 ])assert.equal(opponentSemanticSchema.safeParse(invalid).success,false);
});
test('research buttons create scoped distinct analysis and semantic-model instructions',()=>{
 const analyze=opponentAnalysisRequest('policy','rival:v2','league','analyze');
 const build=opponentAnalysisRequest('policy','rival:v2','league','model');
 assert.deepEqual(build.opponent,{policyId:'policy',leagueId:'league'});
 assert.equal(build.title,'Model · rival:v2');
 assert.match(build.text,/save_model/);assert.match(build.text,/empty nodes/);assert.match(analyze.text,/note action/);
 assert.match(build.text,/Do not reconstruct private source/);
});

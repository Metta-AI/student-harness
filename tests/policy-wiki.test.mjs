import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {importPolicy,reconcilePolicy} from '../lib/semantic-ir.ts';
import {policyWikiEntries,searchWikiEntries} from '../lib/workspace/policy-wiki.ts';
import {viewSchema,presentationRoute} from '../lib/workspace/presentation.ts';

const source=readFileSync(new URL('../hero.bas',import.meta.url),'utf8');
const parent=importPolicy(source,true);
const revision=reconcilePolicy(parent,{
  before:'sub chooseHero()',after:"' Draft test\nsub chooseHero()",summary:'Record draft intent.',
  semantic:{condition:'During draft.',action:'Choose a team role.',goal:'Balance the team.',hypothesis:'Balanced roles improve survival.',expected:'Fewer early deaths.',non_trigger:'After drafting ends.'},
},['coaching-session:csn_wiki']);

test('wiki exposes every stored layer and preserves exact source bindings and evidence',()=>{
  const before=JSON.stringify(revision),entries=policyWikiEntries(revision);
  assert.deepEqual(new Set(entries.map(e=>e.kind)),new Set(['situation','belief','goal','skill','strategy','execution','update']));
  const byKey=new Map(entries.map(e=>[e.key,e]));
  for(const rule of revision.ir.strategy){
    const entry=byKey.get(`strategy:${rule.id}`);
    assert.deepEqual(entry.fields,rule);
    for(const link of entry.links)assert(byKey.has(link.key),`Missing ${link.key}`);
    assert.equal(entry.ruleId,rule.id);
  }
  for(const [id,belief] of Object.entries(revision.ir.belief.claims)){
    assert.deepEqual(byKey.get(`belief:${id}`).fields,belief);
    assert.deepEqual(byKey.get(`belief:${id}`).links,[],'Do not invent belief-to-rule relationships');
  }
  assert.deepEqual(entries.find(e=>e.kind==='update').fields.evidence,['coaching-session:csn_wiki']);
  assert.equal(JSON.stringify(revision),before);
});

test('wiki search finds nested evidence and source identities without combining unrelated objects',()=>{
  const entries=policyWikiEntries(revision);
  assert(searchWikiEntries(entries,'COACHING-SESSION:CSN_WIKI').length>0);
  assert(searchWikiEntries(entries,revision.ir.execution.source_sha256).some(e=>e.kind==='execution'));
  assert.equal(searchWikiEntries(entries,'strategy R_setup').length,1);
  assert.equal(searchWikiEntries(entries,'R_setup R_chooseHero').length,0);
  assert.equal(searchWikiEntries(entries,'  ').length,entries.length);
});

test('wiki links preserve page, entity and revision, and reject unknown wiki sections',()=>{
  const view=viewSchema.parse({view:'development',wikiPage:'ontology',entityId:'strategy:R_setup',revision:2,reason:'Inspect exact policy object'});
  const url=new URL(presentationRoute(view),'http://localhost');
  assert.equal(url.searchParams.get('wiki'),'ontology');
  assert.equal(url.searchParams.get('entity'),'strategy:R_setup');
  assert.equal(url.searchParams.get('revision'),'2');
  assert.equal(viewSchema.safeParse({...view,wikiPage:'unknown'}).success,false);
});

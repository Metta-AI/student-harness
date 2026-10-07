import "eve/tools";
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {registerHooks} from 'node:module';
import {readFileSync,readdirSync} from 'node:fs';
// Match the app bundler's JSON and BASIC imports without starting the server.
registerHooks({resolve(s,c,next){
 if(s.endsWith('/league.json')||s.endsWith('/hero.bas')||s.endsWith('/hero.bas?raw')) {const resolved=next(s,c);const content=readFileSync(new URL(resolved.url),'utf8');return {url:'data:text/javascript,'+encodeURIComponent(`export default ${JSON.stringify(s.endsWith('.json')?JSON.parse(content):content)};`),shortCircuit:true,importAttributes:{}};}
 if(s==='next/server')return next('next/server.js',c);if(s==='next/headers')return next('next/headers.js',c);
 try{return next(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return next(`${s}.ts`,c);throw e;}
}});
// Use Eve's actual serializer, which is what is handed to the model adapter.
const {serializeInputSchema}=await import('../node_modules/eve/dist/src/tools/schema.js');
const definitions=new Map();
for(const file of readdirSync(new URL('../agent/tools/',import.meta.url)).filter(f=>f.endsWith('.ts'))){definitions.set(file,(await import(`../agent/tools/${file}`)).default);}
test('every authored chat tool serializes to a provider-compatible object schema',()=>{
 for(const [name,tool] of definitions){
   const wire=serializeInputSchema(tool.inputSchema);
   assert.equal(wire.type,'object',`${name} must emit type: object at the root`);
   assert(wire.properties&&typeof wire.properties==='object',`${name} properties`);
   assert.equal(wire.oneOf,undefined,`${name} cannot be a root union`);
   assert.equal(wire.anyOf,undefined,`${name} cannot be a root union`);
 }
});
test('object tool schemas still enforce action-specific requirements before execution',()=>{
 const research=definitions.get('autoresearch.ts').inputSchema;
 assert.equal(research.safeParse({action:'investigate'}).success,false);
 assert.equal(research.safeParse({action:'investigate',direction:'Compare retreat behavior.'}).success,true);
 for(const action of ['status','pause'])assert.equal(research.safeParse({action}).success,true);
 const authority=definitions.get('research_authority.ts').inputSchema;
 for(const action of ['record','review','create','grant','control','select'])assert.equal(authority.safeParse({action}).success,false,action);
 const cycleId='00000000-0000-4000-8000-000000000001';
 assert.equal(authority.safeParse({action:'control',cycleId,control:'pause'}).success,true);
 assert.equal(authority.safeParse({action:'select',cycleId,versionId:cycleId,reason:'Reviewed evidence.'}).success,true);
 assert.equal(authority.safeParse({action:'select',cycleId,versionId:cycleId}).success,false);
});

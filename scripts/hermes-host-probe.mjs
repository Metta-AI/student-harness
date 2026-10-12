// Live probe for Hermes mode: builds the base image if needed, starts the
// caller's shared Hermes gateway, then runs one session turn through it.
// Usage: node --env-file=.env.local scripts/hermes-host-probe.mjs <student_subject_id> [model]
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return n(s+'.ts',c);throw e;}}});
const student=process.argv[2];const model=process.argv[3]??'anthropic/claude-sonnet-5.5';
if(!student)throw Error('student id required');
const {ensureHermesHost}=await import('../lib/hermes/host.ts');
const t0=Date.now();const host=await ensureHermesHost(student);
console.log(JSON.stringify({event:'host_ready',name:host.name,url:host.url,seconds:Math.round((Date.now()-t0)/1000)}));
const h={authorization:`Bearer ${host.key}`,'content-type':'application/json'};
const caps=await (await fetch(`${host.url}/v1/capabilities`,{headers:h})).json();
console.log(JSON.stringify({event:'capabilities',features:Object.keys(caps.features??{}).slice(0,30),endpoints:Object.keys(caps.endpoints??{}).slice(0,30)}));
const session=await (await fetch(`${host.url}/api/sessions`,{method:'POST',headers:h,body:JSON.stringify({title:'probe'})})).json();
console.log(JSON.stringify({event:'session',session}));
const id=session.id??session.session_id??session.session?.id;
const r=await fetch(`${host.url}/api/sessions/${id}/chat/stream`,{method:'POST',headers:h,body:JSON.stringify({input:'Reply with exactly: HERMES-OK. Then list the names of MCP tools you have from the "preston" server, comma separated, max 10.',model,provider:'ai-gateway'})});
console.log(JSON.stringify({event:'stream_status',status:r.status}));
const text=await r.text();console.log(text.slice(0,4000));

import {registerHooks} from 'node:module';registerHooks({resolve(s,c,n){try{return n(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return n(`${s}.ts`,c);throw e;}}});
const {db}=await import(process.cwd()+'/lib/db.ts');
let query=db().from('research_campaigns').select('*').order('created_at',{ascending:false}).limit(3);
const id=process.argv[2];if(id){if(!/^[0-9a-f-]{36}$/i.test(id))throw Error('Expected campaign UUID');query=query.eq('id',id);}
const {data:cs,error}=await query;if(error)throw error;
for(const c of cs){
console.log(JSON.stringify({campaign:{id:c.id,task:c.task_id,state:c.state,phase:c.phase,cycle:c.cycle,message:c.checkpoint.message,next:c.next_at,lease:c.lease_until,protocol:c.protocol,candidateId:c.checkpoint.candidateId,candidateVersion:c.checkpoint.candidate?.versionId,lastResult:c.checkpoint.lastResult}}));
const currentIds=[...(c.checkpoint.researchTasks??[]),c.checkpoint.builderId].filter(Boolean);
if(currentIds.length){const {data:sessions,error}=await db().from('agent_tasks').select('id,status,objective,model_calls,progress:checkpoint->research_progress->>summary,reason').in('id',currentIds);if(error)throw error;console.log(JSON.stringify({sessions}));}
const {data:ss,error}=await db().from('research_studies').select('id,task_id,cohort,state,result,next_at,lease_until').eq('campaign_id',c.id);if(error)throw error;console.log(JSON.stringify({studies:ss}));
if(ss.length){const {data:as,error}=await db().from('research_attempts').select('state,error,xp_id,episode_id,study_id,hostStatus:receipt->episode->>status').in('study_id',ss.map(s=>s.id));if(error)throw error; console.log(JSON.stringify({attempts:as.reduce((o,a)=>(o[a.state]=(o[a.state]??0)+1,o),{}),errors:as.filter(a=>a.error).slice(0,8),submitted:as.filter(a=>a.xp_id&&a.state!=='complete').slice(0,6)}));}
}

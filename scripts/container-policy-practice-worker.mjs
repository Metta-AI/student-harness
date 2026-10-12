import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';

/** Explicit, bounded background scheduling. Importing starts no work. Status and
 * cleanup continue when new practice admission is disabled. */
export async function main(args=process.argv.slice(2)){
 if(args.length>1||args.length===1&&!/^--duration-minutes=\d+$/.test(args[0]))throw Error('Use --duration-minutes=N');
 const minutes=args.length?Number(args[0].split('=')[1]):120;
 if(!Number.isSafeInteger(minutes)||minutes<1||minutes>1440)throw Error('Worker duration must be 1–1440 minutes');
 const env=process.env;
 if(!(env.SUPABASE_URL??env.NEXT_PUBLIC_SUPABASE_URL)||!(env.SUPABASE_SERVICE_ROLE_KEY??env.SUPABASE_SECRET_KEY)||!/^([0-9a-f]{2}){32}$/i.test(env.SESSION_SECRET??''))throw Error('Practice worker is not configured');
 const hooks=registerHooks({resolve(s,c,next){try{return next(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return next(s+'.ts',c);throw e;}}});
 const controller=new AbortController(),stop=()=>controller.abort();process.on('SIGINT',stop);process.on('SIGTERM',stop);
 try{const {runContainerPracticeWorker}=await import('../lib/container-policy/practice-worker.ts');await runContainerPracticeWorker({signal:controller.signal,deadlineAt:Date.now()+minutes*60000});}
 finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);hooks.deregister();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{await main();}catch{console.error(JSON.stringify({event:'container_practice_worker_failed'}));process.exitCode=1;}}

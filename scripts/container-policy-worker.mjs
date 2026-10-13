import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';

/** Off on import; explicitly run from the repository root with Node >=24:
 * node --env-file-if-exists=.env.local scripts/container-policy-worker.mjs
 * Optional --duration-minutes=N bounds scheduling (default 120, maximum 1440).
 */
export async function main(args=process.argv.slice(2)){
 if(args.length>1||args.length===1&&!/^--duration-minutes=\d+$/.test(args[0]))throw Error('Use --duration-minutes=N');
 const minutes=args.length?Number(args[0].split('=')[1]):120;
 if(!Number.isSafeInteger(minutes)||minutes<1||minutes>1440)throw Error('Worker duration must be 1–1440 minutes');
 const hooks=registerHooks({resolve(s,c,next){try{return next(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return next(s+'.ts',c);throw e;}}});
 const controller=new AbortController(),deadlineAt=Date.now()+minutes*60000;
 const stop=()=>controller.abort();process.on('SIGINT',stop);process.on('SIGTERM',stop);
 try{
  const {containerStorageFromEnvironment,runContainerBuildWorker}=await import('../lib/container-policy/worker.ts');
  const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(minutes*60000)]);
  const storage=containerStorageFromEnvironment(process.env,signal);
  await runContainerBuildWorker({storage,signal,deadlineAt});
 }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);hooks.deregister();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{await main();}catch{console.error(JSON.stringify({event:'container_build_worker_failed'}));process.exitCode=1;}
}

import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';

/** Explicit background process; inert on import. Run from the repository root:
 * node --env-file-if-exists=.env.local scripts/container-policy-upload-worker.mjs
 * --duration-minutes=N bounds scheduling (default120, maximum1440). */
export async function main(args=process.argv.slice(2)){
 if(args.length>1||args.length===1&&!/^--duration-minutes=\d+$/.test(args[0]))throw Error('Use --duration-minutes=N');
 const minutes=args.length?Number(args[0].split('=')[1]):120;
 if(!Number.isSafeInteger(minutes)||minutes<1||minutes>1440)throw Error('Worker duration must be 1–1440 minutes');
 const hooks=registerHooks({resolve(s,c,next){try{return next(s,c);}catch(e){if(e.code==='ERR_MODULE_NOT_FOUND'&&s.startsWith('.')&&!/\.[a-z]+$/i.test(s))return next(s+'.ts',c);throw e;}}});
 const controller=new AbortController(),deadlineAt=Date.now()+minutes*60000;
 const stop=()=>controller.abort();process.on('SIGINT',stop);process.on('SIGTERM',stop);
 try{
  const {runContainerUploadWorker,validateContainerUploadWorkerEnvironment}=await import('../lib/container-policy/upload-worker.ts');
  validateContainerUploadWorkerEnvironment(process.env);
  await runContainerUploadWorker({signal:controller.signal,deadlineAt});
 }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);hooks.deregister();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{await main();}catch{console.error(JSON.stringify({event:'container_upload_worker_failed'}));process.exitCode=1;}
}

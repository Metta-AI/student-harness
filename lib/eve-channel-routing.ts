import type {NextConfig} from 'next';
import {readFile,writeFile,rename,rm,stat} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';

// Eve 0.68 withEve mounts only its framework API. Authored channel paths
// also need explicit routing to that same service, in development and Vercel.
const paths=['/task-execution/health','/task-execution/wake','/extreme-research/health','/extreme-research/wake','/hermes/mcp','/conversation-control/status','/conversation-control/stop'];
const sources=['^/task-execution/(health|wake)$','^/extreme-research/(health|wake)$','^/hermes/mcp$','^/conversation-control/(status|stop)$'];

async function outputFile(root:string){
 // Match Eve's shared/vercel-output-directory discovery: hosted multi-service
 // builds write beside the closest ancestor output/builds.json, rather than
 // the source checkout's .vercel/output directory.
 for(let directory=root;;directory=dirname(directory)){
  try{if((await stat(join(directory,'output/builds.json'))).isFile())return join(directory,'output/config.json');}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(dirname(directory)===directory)return join(root,'.vercel/output/config.json');
 }
}

export function taskChannelOutput(config:Record<string,any>){
 const service=config.services?.eve;
 if(service?.framework!=='eve'||service.routePrefix||service.mount)
  throw Error('Task channel routing requires the unnamed Eve service');
 const routes=config.routes??[];
 const existing=routes.filter((route:Record<string,any>)=>sources.includes(route.src));
 if(existing.some((route:Record<string,any>)=>route.destination?.type!=='service'||route.destination.service!=='eve'))
  throw Error('Task channel route is already owned by another service');
 return {...config,routes:[...sources.map(src=>({src,destination:{service:'eve',type:'service'}})),...routes.filter((route:Record<string,any>)=>!sources.includes(route.src))]};
}

export async function exposeTaskChannel(config:NextConfig,root=process.cwd(),vercel=Boolean(process.env.VERCEL)):Promise<NextConfig>{
 // withEve has already written the service manifest. Preserve every other
 // service/route and add no catch-all or framework namespace alias.
 const file=await outputFile(root);
 let raw:string|undefined;
 try{raw=await readFile(file,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT'||vercel)throw error;}
 if(raw!==undefined){
  const updated=JSON.stringify(taskChannelOutput(JSON.parse(raw)),null,2)+'\n';
  if(updated!==raw){const temporary=file+'.'+randomUUID();try{await writeFile(temporary,updated);await rename(temporary,file);}finally{await rm(temporary,{force:true});}}
 }
 if(vercel)return config;
 const rewrites=config.rewrites;
 return {...config,async rewrites(){
  const current=await rewrites?.();
  const sections=Array.isArray(current)?{beforeFiles:[],afterFiles:current,fallback:[]}:current;
  const route=sections?.beforeFiles?.find(rule=>rule.source==='/eve/v1/:path+');
  const suffix='/eve/v1/:path+';
  if(!route?.destination.endsWith(suffix))throw Error('Task channel routing requires the generated Eve rewrite');
  const destination=route.destination.slice(0,-suffix.length);
  return {...sections,beforeFiles:[...paths.map(source=>({source,destination:destination+source})),...sections?.beforeFiles??[]],afterFiles:sections?.afterFiles??[],fallback:sections?.fallback??[]};
 }};
}

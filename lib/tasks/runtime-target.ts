/** Runtime configuration is server-owned. Never derive this origin from an
 * incoming Host header, task text, or a model tool argument. */
export function runtimeRecoveryTarget(env:NodeJS.ProcessEnv=process.env) {
 const configured=env.PRESTON_RUNTIME_URL?.trim();
 const deployment=env.VERCEL==='1'?env.VERCEL_URL?.trim():undefined;
 if(!configured&&deployment&&!/^[a-z0-9.-]+(?::\d+)?$/i.test(deployment))throw Error('Invalid Vercel runtime hostname');
 const origin=configured||(deployment?`https://${deployment}`:env.NODE_ENV!=='production'?'http://localhost:3000':null);
 if(!origin)throw Error('Runtime recovery requires PRESTON_RUNTIME_URL on self-hosted production');
 let url:URL;
 try {url=new URL(origin);}catch{throw Error('Invalid runtime recovery origin');}
 const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
 if((url.protocol!=='https:'&&!(local&&url.protocol==='http:'))||url.username||url.password||url.pathname!=='/'||url.search||url.hash)
  throw Error('Runtime recovery requires an HTTPS origin (HTTP loopback allowed), without credentials, path, query or fragment');
 const headers:Record<string,string>={};
 // Deployment protection is distinct from app authorization; the caller must
 // still supply the owned, sealed student session for Eve's auth walk.
 if(url.protocol==='https:'&&env.VERCEL_AUTOMATION_BYPASS_SECRET)
  headers['x-vercel-protection-bypass']=env.VERCEL_AUTOMATION_BYPASS_SECRET;
 return {host:url.origin,headers,redirect:'error' as const};
}

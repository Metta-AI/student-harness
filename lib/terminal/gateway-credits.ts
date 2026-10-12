import {createGateway} from 'ai';

export class GatewayCreditError extends Error {
 readonly status=402;
 constructor(){super('Vercel AI Gateway has no credits remaining. Add credits, then resume this same workspace. Your files and results are saved.');}
}

/** Do not restart a durable worker into an already-known billing failure. */
export async function requireGatewayCredits(){
 const gateway=createGateway({
  apiKey:process.env.AI_GATEWAY_API_KEY||process.env.VERCEL_OIDC_TOKEN,
  fetch:(input,init)=>fetch(input,{...init,signal:init?.signal?AbortSignal.any([init.signal,AbortSignal.timeout(8000)]):AbortSignal.timeout(8000)}),
 });
 let balance:number;
 try{balance=Number((await gateway.getCredits()).balance);}
 catch{throw Error('Could not check Vercel AI Gateway credits. Retry when the connection recovers; the research process has not been restarted.');}
 if(!Number.isFinite(balance))throw Error('Vercel AI Gateway returned an unreadable balance. The research process has not been restarted.');
 if(balance<=0)throw new GatewayCreditError();
}

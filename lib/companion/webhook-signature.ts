import {createHmac,timingSafeEqual} from 'node:crypto';
import {IntegrationError} from './integrations';

export const webhookBodyLimit=16384;
export function verifyWebhook(headers:Headers,body:Uint8Array,secret:string,now=Date.now()){
 const id=headers.get('webhook-id')??'',timestamp=headers.get('webhook-timestamp')??'',signatures=headers.get('webhook-signature')??'';
 if(!/^[A-Za-z0-9_-]{1,160}$/.test(id)||!/^\d{10,11}$/.test(timestamp)||Math.abs(now/1000-Number(timestamp))>300||signatures.length>1024)
  throw new IntegrationError('Invalid webhook signature or timestamp',401);
 if(!/^whsec_[A-Za-z0-9+/]{43}=$/.test(secret))throw new Error('Webhook key unavailable');
 const expected=createHmac('sha256',Buffer.from(secret.slice(6),'base64')).update(`${id}.${timestamp}.`).update(body).digest();
 const valid=signatures.split(' ').some(part=>{
  if(!/^v1,[A-Za-z0-9+/]{43}=$/.test(part))return false;
  const received=Buffer.from(part.slice(3),'base64');return received.length===expected.length&&timingSafeEqual(received,expected);
 });
 if(!valid)throw new IntegrationError('Invalid webhook signature or timestamp',401);
 return id;
}
export async function webhookBody(request:Request){
 const size=request.headers.get('content-length');if(size&&(!/^\d+$/.test(size)||Number(size)>webhookBodyLimit))throw new IntegrationError('Webhook body exceeds 16 KiB',413);
 if(request.headers.get('content-encoding')&&!['identity'].includes(request.headers.get('content-encoding')!))throw new IntegrationError('Compressed webhook bodies are not accepted',415);
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw new IntegrationError('Send application/json',415);
 const reader=request.body?.getReader();if(!reader)throw new IntegrationError('Webhook body required',400);
 const chunks:Uint8Array[]=[];let length=0;const deadline=AbortSignal.timeout(10000);
 const abort=()=>{void reader.cancel().catch(()=>{});};deadline.addEventListener('abort',abort,{once:true});
 try{while(true){const {done,value}=await reader.read();if(deadline.aborted)throw new IntegrationError('Webhook body timed out',408);if(done)break;length+=value.length;if(length>webhookBodyLimit)throw new IntegrationError('Webhook body exceeds 16 KiB',413);chunks.push(value);}return Buffer.concat(chunks,length);}
 finally{deadline.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock();}
}

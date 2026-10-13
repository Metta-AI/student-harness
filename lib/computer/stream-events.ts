import type {BrowserStreamEvent} from '../browser/stream-events';
export function desktopStreamParser(){
 let buffer='';const decoder=new TextDecoder();
 return (chunk:Uint8Array):BrowserStreamEvent[]=>{
  buffer+=decoder.decode(chunk,{stream:true});if(buffer.length>8*1024*1024)throw Error('Desktop stream exceeded its limit');
  const events:BrowserStreamEvent[]=[];
  for(;;){const end=buffer.indexOf('\n\n');if(end<0)break;const record=buffer.slice(0,end);buffer=buffer.slice(end+2);
   if(record.length>7*1024*1024)throw Error('Desktop frame exceeded its limit');
   const kind=record.match(/^event: (frame|state)$/m)?.[1];if(!kind)continue;
   const raw=record.match(/^data: (.+)$/m)?.[1];if(!raw)continue;
   const data=JSON.parse(raw),o=data.observation;
   if(data.kind!=='desktop'||!['human','agent','handoff','stopped'].includes(data.owner)||!Number.isInteger(data.epoch)||!Number.isInteger(data.view)||!Number.isFinite(data.expiresAt))continue;
   events.push({type:'state',data});
   if(kind==='frame'&&o?.mediaType==='image/png'&&o.width===1280&&o.height===720&&typeof o.image==='string'&&o.image.length<7*1024*1024&&/^iVBOR[A-Za-z0-9+/=]+$/.test(o.image)&&Number.isFinite(data.capturedAt))events.push({type:'frame',data:{image:o.image,mediaType:'image/png',capturedAt:data.capturedAt,receivedAt:Date.now()}});
  }
  return events;
 };
}

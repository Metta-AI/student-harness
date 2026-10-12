export type BrowserWorkerState={owner:'human'|'agent'|'handoff'|'stopped';epoch:number;view:number;expiresAt:number;shutdown:string|null};
export type BrowserFrame={image:string;mediaType:'image/jpeg'|'image/png';capturedAt:number;receivedAt:number};
export type BrowserStreamEvent={type:'state';data:BrowserWorkerState}|{type:'frame';data:BrowserFrame};
// Bounded incremental SSE parsing. Incomplete UTF-8/records may cross chunks;
// only the two explicit read-only message types reach the component.
export function browserStreamParser(){
 let buffer='';const decoder=new TextDecoder();
 return (chunk:Uint8Array):BrowserStreamEvent[]=>{
  buffer+=decoder.decode(chunk,{stream:true});if(buffer.length>800000)throw Error('Browser stream exceeded its limit');
  const events:BrowserStreamEvent[]=[];
  for(;;){const end=buffer.indexOf('\n\n');if(end<0)break;const record=buffer.slice(0,end);buffer=buffer.slice(end+2);if(record.length>400000)throw Error('Browser frame exceeded its limit');
   const kind=record.match(/^event: (\w+)$/m)?.[1],raw=record.match(/^data: (.+)$/m)?.[1];if(!raw)continue;
   const data=JSON.parse(raw);
   if(kind==='state'&&['human','agent','handoff','stopped'].includes(data.owner)&&Number.isInteger(data.epoch)&&Number.isInteger(data.view)&&Number.isFinite(data.expiresAt))events.push({type:'state',data});
   if(kind==='frame'&&data.mediaType==='image/jpeg'&&typeof data.image==='string'&&data.image.length<=350000&&/^\/9j\/[A-Za-z0-9+/=]+$/.test(data.image)&&Number.isFinite(data.capturedAt)&&Number.isFinite(data.receivedAt))events.push({type:'frame',data});
  }
  return events;
 };
}

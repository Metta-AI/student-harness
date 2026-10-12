import type { VoiceEvent } from './transcript';
const prefix='preston-transcript-outbox:';
const activeKeys=new Set<string>();
const recoveryBackoff=new Map<string,{failures:number;after:number}>();
const encoder=new TextEncoder();
const maxBatches=20;
let recovering:Promise<void>|null=null;

function batchBody(lease:string,events:VoiceEvent[]) {
  const batch=events.slice(0,25);
  // keepalive has a byte budget, not a JavaScript string-length budget.
  while(batch.length){
    const body=JSON.stringify({lease,events:batch});
    if(encoder.encode(body).byteLength<=60_000)return {batch,body};
    batch.pop();
  }
  return null;
}
async function deliver(lease:string,events:VoiceEvent[]):Promise<Set<string>> {
  const request=batchBody(lease,events);
  if(!request)return new Set();
  try{
    const response=await fetch('/api/voice/transcripts',{method:'POST',headers:{'Content-Type':'application/json'},body:request.body,keepalive:true,signal:AbortSignal.timeout(10_000)});
    if(!response.ok)return new Set();
    const {saved}=await response.json();
    if(!Array.isArray(saved))return new Set();
    const sent=new Set(request.batch.map(e=>e.event_id));
    // Only acknowledge IDs actually sent, even if a response is malformed.
    return new Set(saved.filter((id:unknown):id is string=>typeof id==='string'&&sent.has(id)));
  }catch{return new Set();}
}
function readStored(key:string):{lease:string;events:VoiceEvent[]}|null {
  try{
    const value=JSON.parse(localStorage.getItem(key)??'null');
    return typeof value?.lease==='string'&&Array.isArray(value.events)&&
      value.events.every((event:unknown)=>event!==null&&typeof event==='object'&&'event_id' in event&&typeof event.event_id==='string')?value:null;
  }catch{return null;}
}

/** Persist before sending; acknowledge by ID so retries cannot lose fragments. */
export class VoiceJournal {
  private events:VoiceEvent[]=[];
  private sequence=0;
  private pending:Promise<void>|null=null;
  private closePromise:Promise<void>|null=null;
  private timer?:ReturnType<typeof setInterval>;
  private key=prefix+crypto.randomUUID();
  private lease:string;
  private status:(saved:boolean)=>void;
  private failures=0;
  private nextAttempt=0;
  constructor(lease:string,status:(saved:boolean)=>void) {
    this.lease=lease;this.status=status;activeKeys.add(this.key);
    this.timer=setInterval(()=>{if(Date.now()>=this.nextAttempt)void this.flush();},1500);
    void VoiceJournal.retryStored();
  }
  append(event:Omit<VoiceEvent,'sequence'|'received_at'>) {
    if(this.events.some(e=>e.event_id===event.event_id))return;
    this.events.push({...event,sequence:this.sequence++,received_at:new Date().toISOString()});
    this.persist();this.status(false);
    // Late fragments stay durable. Once closed, the companion recovery service
    // owns retries; a retired journal must not create another permanent timer.
  }
  private persist() {
    try{
      if(this.events.length)localStorage.setItem(this.key,JSON.stringify({lease:this.lease,events:this.events}));
      else localStorage.removeItem(this.key);
    }catch{console.warn('Voice transcript local buffer unavailable');}
  }
  flush():Promise<void> {
    if(this.pending)return this.pending;
    if(!this.events.length)return Promise.resolve();
    this.pending=this.flushBatch().finally(()=>{this.pending=null;});
    return this.pending;
  }
  private async flushBatch() {
    const ids=await deliver(this.lease,this.events);
    if(!ids.size){
      this.failures++;this.nextAttempt=Date.now()+Math.min(60_000,1500*2**Math.min(this.failures,6));return;
    }
    this.failures=0;this.nextAttempt=0;
    this.events=this.events.filter(e=>!ids.has(e.event_id));this.persist();this.status(!this.events.length);
  }
  close():Promise<void> {
    if(this.closePromise)return this.closePromise;
    clearInterval(this.timer);
    this.closePromise=(async()=>{
      const deadline=Date.now()+10_000;
      try{
        // Wait for an existing request before draining. Bound the close pass,
        // and stop at the first failure instead of retrying forever after hangup.
        await this.pending;
        for(let i=0;i<maxBatches&&this.events.length&&Date.now()<deadline;i++){
          await this.flush();if(this.failures)break;
        }
      }finally{activeKeys.delete(this.key);}
    })();
    return this.closePromise;
  }
  static retryStored():Promise<void> {
    // Companion refreshes, online events and new calls can all request recovery.
    // Coalesce them and exclude in-memory journals from stale-storage uploads.
    if(recovering)return recovering;
    recovering=VoiceJournal.recover().finally(()=>{recovering=null;});
    return recovering;
  }
  private static async recover() {
    let keys:string[];
    try{keys=Object.keys(localStorage).filter(k=>k.startsWith(prefix));}catch{return;}
    for(const key of recoveryBackoff.keys())if(!keys.includes(key))recoveryBackoff.delete(key);
    let attempts=0;const deadline=Date.now()+10_000;
    for(const key of keys){
      if(activeKeys.has(key)||(recoveryBackoff.get(key)?.after??0)>Date.now())continue;
      while(attempts<maxBatches&&Date.now()<deadline&&!activeKeys.has(key)){
        const stored=readStored(key);if(!stored?.events.length)break;
        attempts++;
        const ids=await deliver(stored.lease,stored.events);
        if(!ids.size){
          const failures=(recoveryBackoff.get(key)?.failures??0)+1;
          recoveryBackoff.set(key,{failures,after:Date.now()+Math.min(60_000,10_000*2**Math.min(failures-1,3))});break;
        }
        recoveryBackoff.delete(key);
        // Another tab may have appended while the upload was in flight.
        const current=readStored(key);if(!current||current.lease!==stored.lease)break;
        current.events=current.events.filter(e=>!ids.has(e.event_id));
        try{
          if(current.events.length)localStorage.setItem(key,JSON.stringify(current));
          else localStorage.removeItem(key);
        }catch{break;}
      }
      if(attempts>=maxBatches||Date.now()>=deadline)break;
    }
  }
}

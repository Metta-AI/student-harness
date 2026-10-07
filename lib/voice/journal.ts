import type { VoiceEvent } from './transcript';
const prefix='preston-transcript-outbox:';
/** Persist before sending; acknowledge by ID so retries and late arrivals cannot lose fragments. */
export class VoiceJournal {
  private events:VoiceEvent[]=[];
  private sequence=0;
  private busy=false;
  private closing=false;
  private timer?:ReturnType<typeof setInterval>;
  private key=prefix+crypto.randomUUID();
  private lease:string;
  private status:(saved:boolean)=>void;
  constructor(lease:string,status:(saved:boolean)=>void) {
    this.lease=lease;this.status=status;
    this.timer=setInterval(()=>void this.flush(),1500);
    void VoiceJournal.retryStored();
  }
  append(event:Omit<VoiceEvent,'sequence'|'received_at'>) {
    if(this.events.some(e=>e.event_id===event.event_id))return;
    this.events.push({...event,sequence:this.sequence++,received_at:new Date().toISOString()});
    this.persist();this.status(false);if(this.closing)void this.flush();
  }
  private persist() {try{if(this.events.length)localStorage.setItem(this.key,JSON.stringify({lease:this.lease,events:this.events}));else localStorage.removeItem(this.key);}catch{console.warn('Voice transcript local buffer unavailable');}}
  async flush() {
    if(this.busy||!this.events.length)return;this.busy=true;
    try {
      const batch=this.events.slice(0,25);
      while(batch.length>1&&JSON.stringify(batch).length>45000)batch.pop();
      const r=await fetch('/api/voice/transcripts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lease:this.lease,events:batch}),keepalive:true});
      if(!r.ok)return;
      const {saved}=await r.json();const ids=new Set(saved);
      this.events=this.events.filter(e=>!ids.has(e.event_id));this.persist();this.status(!this.events.length);
    }catch{/* Keep the outbox for the next connection or page load. */}finally{this.busy=false;if(this.closing&&this.events.length)setTimeout(()=>void this.flush(),3000);}
  }
  async close() {this.closing=true;clearInterval(this.timer);await this.flush();}
  static async retryStored() {
    let keys:string[];try{keys=Object.keys(localStorage).filter(k=>k.startsWith(prefix));}catch{return;}
    for(const key of keys) {
      try {
        const raw=localStorage.getItem(key);if(!raw)continue;
        const stored=JSON.parse(raw);if(!Array.isArray(stored.events)||!stored.events.length)continue;
        // Do not overwrite concurrently appended fragments when acknowledging a recovered batch.
        const batch=stored.events.slice(0,25);
        const r=await fetch('/api/voice/transcripts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lease:stored.lease,events:batch})});
        if(!r.ok)continue;
        const {saved}=await r.json();const current=JSON.parse(localStorage.getItem(key)??'null');if(!current)continue;
        current.events=current.events.filter((e:VoiceEvent)=>!saved.includes(e.event_id));
        if(current.events.length)localStorage.setItem(key,JSON.stringify(current));else localStorage.removeItem(key);
      }catch{/* Retry on the next tick or visit. */}
    }
  }
}

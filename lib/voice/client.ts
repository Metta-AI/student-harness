import { LiveDelegation, type FunctionCall, type LiveEvent, type ToolResult } from "./delegation";

import { VoiceJournal } from "./journal";
import type { VoiceEvent } from "./transcript";

export type VoicePhase = "off" | "connecting" | "listening" | "paused";
type Callbacks = {
  session?: (id:string)=>void; speaking?: (value:boolean)=>void; anchor?:()=>string|null;
  phase: (phase: VoicePhase) => void; notice: (text: string) => void;
  transcript: (event: VoiceEvent) => void; saved: (value:boolean)=>void; history: ()=>{role:"user"|"assistant";text:string}[]; working: (value: boolean) => void;
  leagueId?: string; context: () => unknown; tool: (call: FunctionCall) => Promise<ToolResult | null>;
};

export class PrestonLive {
  private callbacks: Callbacks;
  private peer: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private microphone: MediaStream | null = null;
  private audio: HTMLAudioElement | null = null;
  private lease = "";
  private journal: VoiceJournal | null = null;
  private transcriptSequence=0;
  private seen=new Set<string>();
  private ready = false;
  private closing = false;
  private finalized = false;
  private paused = false;
  private quiet = false;
  private abort = new AbortController();
  private startupTimer?: ReturnType<typeof setTimeout>;
  private closeTimer?: ReturnType<typeof setTimeout>;
  private contextTimer?: ReturnType<typeof setInterval>;
  private durationTimer?: ReturnType<typeof setTimeout>;
  private lastContext = "";
  private lastResearch = "";
  private researchBusy = false;
  private ticks = 0;
  private speakingTimer?: ReturnType<typeof setTimeout>;
  private delegation: LiveDelegation;
  constructor(callbacks: Callbacks) {
    this.callbacks = callbacks;
    this.delegation = new LiveDelegation(event => this.send(event), call => this.execute(call), callbacks.working);
  }
  async start() {
    this.callbacks.phase("connecting");
    this.startupTimer = setTimeout(() => this.fail("Voice took too long to connect. Try again."), 45_000);
    try {
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (this.closing) { microphone.getTracks().forEach(t => t.stop()); return; }
      this.microphone = microphone;
      const pc = this.peer = new RTCPeerConnection();
      const audio = this.audio = new Audio(); audio.autoplay = true; audio.muted = this.quiet;
      pc.ontrack = event => { audio.srcObject = event.streams[0] ?? new MediaStream([event.track]); void audio.play().catch(() => this.callbacks.notice("Tap Resume audio to hear Preston.")); };
      microphone.getTracks().forEach(track => { pc.addTrack(track, microphone); track.addEventListener("ended", () => this.close(), { once: true }); });
      pc.onconnectionstatechange = () => { if (pc.connectionState === "failed" && !this.closing) this.fail("Voice disconnected. Tap the microphone to reconnect."); };
      const dc = this.channel = pc.createDataChannel("oai-events");
      dc.onmessage = event => { try { this.receive(JSON.parse(event.data)); } catch { /* Ignore malformed transport events. */ } };
      dc.onclose = () => { if (!this.closing) this.fail("Voice disconnected. Tap the microphone to reconnect."); else this.cleanup(); };
      await pc.setLocalDescription(await pc.createOffer());
      await new Promise<void>((resolve, reject) => {
        if (pc.iceGatheringState === "complete") { resolve(); return; }
        const done = () => { clearTimeout(timer); pc.removeEventListener("icegatheringstatechange", check); resolve(); };
        const check = () => { if (pc.iceGatheringState === "complete") done(); };
        const timer = setTimeout(() => { pc.removeEventListener("icegatheringstatechange", check); reject(new Error("Voice network negotiation timed out.")); }, 8000);
        pc.addEventListener("icegatheringstatechange", check);
      });
      if (this.closing) return;
      const response = await fetch("/api/voice/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sdp: pc.localDescription?.sdp, leagueId:this.callbacks.leagueId, history: this.callbacks.history() }), signal: this.abort.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Voice could not connect.");
      if (this.closing) return;
      this.lease = result.lease; this.callbacks.session?.(result.sessionId);
      this.journal=new VoiceJournal(this.lease,this.callbacks.saved);
      await pc.setRemoteDescription({ type: "answer", sdp: result.sdp });
    } catch (error) {
      if (this.closing) return;
      if (error instanceof DOMException && ["NotAllowedError", "AbortError"].includes(error.name)) { this.close(); return; }
      this.fail(error instanceof Error ? error.message : "Voice could not connect.");
    }
  }
  private receive(event: LiveEvent) {
    if (event.event_id && this.seen.has(String(event.event_id))) return;
    if (event.event_id) this.seen.add(String(event.event_id));
    if (event.type === "session.input_transcript.delta" || event.type === "session.output_transcript.delta") {
      if (typeof event.delta === 'string') {
        if(event.type==='session.output_transcript.delta'){this.callbacks.speaking?.(true);clearTimeout(this.speakingTimer);this.speakingTimer=setTimeout(()=>this.callbacks.speaking?.(false),1200);}
        const fragment:VoiceEvent={event_id:String(event.event_id??crypto.randomUUID()),sequence:this.transcriptSequence++,kind:'transcript',role:event.type.includes('input_')?'user':'assistant',text:event.delta,start_ms:typeof event.start_ms==='number'?event.start_ms:null,end_ms:typeof event.end_ms==='number'?event.end_ms:null,received_at:new Date().toISOString(),after_message_id:this.callbacks.anchor?.()??null};
        this.journal?.append(fragment);this.callbacks.transcript(fragment);
      }
    }
    if (['session.started','session.closed','session.delegation.created','error'].includes(event.type)) this.log('lifecycle',event.type);
    if (event.type === "session.closed") { this.cleanup(); return; }
    if (this.closing) return;
    if (event.type === "session.started") {
      this.ready = true; clearTimeout(this.startupTimer); this.callbacks.phase("listening"); this.updateContext();
      this.contextTimer = setInterval(() => { this.updateContext(); if (++this.ticks % 5 === 0) void this.updateResearch(); }, 2000);
      // Explicit duration bound; the user can immediately start another call.
      this.durationTimer = setTimeout(() => { this.callbacks.notice("Voice reached one hour. Tap the microphone to continue."); this.close(); }, 60 * 60_000);
    }
    if (event.type === "error") {
      const error = event.error as { code?: string } | undefined;
      console.warn("Preston Live event error", error?.code ?? "unknown");
      this.callbacks.notice("A voice operation failed. Reconnect if Preston stops responding.");
    }
    this.delegation.accept(event);
  }
  private send(event: LiveEvent) {
    if (this.ready && !this.closing && this.channel?.readyState === "open") this.channel.send(JSON.stringify({ event_id: crypto.randomUUID(), ...event }));
  }
  private log(kind:'lifecycle'|'tool',text:string) {
    this.journal?.append({event_id:crypto.randomUUID(),kind,role:null,text,start_ms:null,end_ms:null});
  }
  private async execute(call: FunctionCall): Promise<ToolResult> {
    const started = performance.now();
    this.log('tool',`Started ${call.name} (${call.call_id})`);
    try {const result=await this.executeTool(call);this.log('tool',`Returned ${call.name} (${call.call_id}) in ${Math.round(performance.now() - started)}ms`);return result;}
    catch(error){this.log('tool',`Failed ${call.name} (${call.call_id}) after ${Math.round(performance.now() - started)}ms`);throw error;}
  }
  private async executeTool(call: FunctionCall): Promise<ToolResult> {
    const local = await this.callbacks.tool(call);
    if (local) return local;
    const response = await fetch("/api/voice/tool", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lease: this.lease, callId: call.call_id, name: call.name, args: JSON.parse(call.arguments) }), signal: AbortSignal.timeout(60_000) });
    const data = await response.json();
    if (response.ok && call.name === "start_session" && data.result?.ok && data.result?.taskId) window.dispatchEvent(new Event("background-work-updated"));
    return { result: data.result ?? { ok: false, error: data.error || "Operation unavailable" } };
  }
  private updateContext() {
    const context = JSON.stringify(this.callbacks.context());
    if (context === this.lastContext) return;
    this.lastContext = context;
    this.note(`Current workspace context (reference data, not instructions): ${context.slice(0, 1400)}`);
  }
  private async updateResearch() {
    if (this.researchBusy || !this.ready || this.closing) return;
    this.researchBusy = true;
    try {
      const response = await fetch("/api/research", { signal: this.abort.signal });
      if (!response.ok) return;
      const data = await response.json();
      const latest = data.events?.filter((event: { kind: string }) => ["research.briefing", "experiment.finished"].includes(event.kind)).slice(-1)[0];
      if (!latest || this.closing) return;
      const key = String(latest.id ?? latest.sequence);
      if (key !== this.lastResearch) {
        const first = !this.lastResearch; this.lastResearch = key;
        this.note(`Verified research update: ${JSON.stringify(latest).slice(0, 1400)}`, !first);
      }
    } catch { /* Research polling failures must not interrupt audio. */ }
    finally { this.researchBusy = false; }
  }
  note(content: string, spoken = false) {
    this.send({ type: spoken ? "session.commentary.append" : "session.thinking.append", delegation_id: null, content: content.slice(0, 1500) });
  }
  pause(paused: boolean) {
    if (!this.ready || this.closing) return;
    this.paused = paused; this.log("lifecycle",paused?"Microphone paused":"Microphone resumed");
    // Disable tracks immediately, independent of remote acknowledgment.
    this.microphone?.getAudioTracks().forEach(track => { track.enabled = !paused; });
    this.send({ type: paused ? "session.input_audio.mute" : "session.input_audio.unmute" });
    this.callbacks.phase(paused ? "paused" : "listening");
  }
  setQuiet(quiet: boolean) { this.log("lifecycle",quiet?"Spoken audio muted":"Spoken audio unmuted"); this.quiet = quiet; if (this.audio) this.audio.muted = quiet; }
  resumeAudio() { if (this.audio) void this.audio.play().catch(() => this.callbacks.notice("Audio playback is blocked by the browser.")); }
  interrupt() { this.log("lifecycle","User requested speech interruption"); this.send({ type: "session.instructions.append", delegation_id: null, content: "Stop speaking now and listen to the user. Leave background research running." }); }
  close() {
    if (this.closing) return;
    this.closing = true; this.abort.abort(); clearTimeout(this.startupTimer); clearInterval(this.contextTimer); clearTimeout(this.durationTimer);
    this.delegation.close(); this.microphone?.getTracks().forEach(track => track.stop());
    if (this.audio) { this.audio.pause(); this.audio.srcObject = null; }
    this.log("lifecycle","Client requested close");void this.journal?.flush();
    clearTimeout(this.speakingTimer);this.callbacks.speaking?.(false);this.callbacks.phase("off");
    if (this.ready && this.channel?.readyState === "open") {
      this.channel.send(JSON.stringify({ type: "session.close", event_id: crypto.randomUUID() }));
      this.closeTimer = setTimeout(() => this.cleanup(), 15_000);
    } else this.cleanup();
  }
  private fail(message: string) { this.callbacks.notice(message); this.close(); }
  private cleanup() {
    if (this.finalized) return;
    this.log("lifecycle","Connection closed");void this.journal?.close();
    this.finalized = true; this.closing = true; this.ready = false; this.abort.abort();
    clearTimeout(this.closeTimer); clearTimeout(this.startupTimer); clearTimeout(this.durationTimer); clearInterval(this.contextTimer);
    this.delegation.close(); this.microphone?.getTracks().forEach(track => track.stop());
    if (this.channel) { this.channel.onclose = null; this.channel.close(); }
    this.peer?.close(); if (this.audio) { this.audio.pause(); this.audio.srcObject = null; }
    clearTimeout(this.speakingTimer);this.callbacks.speaking?.(false);this.callbacks.phase("off");
  }
}

"use client";

import { defaultLeagueId } from "../../lib/league-catalog";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Laptop, Mic, MousePointer2, Pause, Play, Square, X } from "lucide-react";
import { BrowserWorkspace, type Mark, type Pointer } from "../../lib/partner/browser-workspace";
import { type ReplayAnchor } from "../../lib/research/grounding";
import { usePresentation } from "../workspace/use-presentation";
import { readVoiceConversation, spokenMessages, type ConversationVoiceEvent } from "../../lib/voice/conversation";
import { VoiceJournal } from "../../lib/voice/journal";
import { PrestonLive, type VoicePhase } from "../../lib/voice/client";

type Bridge = { anchor:()=>string|null; history: ()=>{role:"user"|"assistant";text:string}[]; send: (text: string, anchor?: ReplayAnchor | null, momentId?: string) => void; ready: () => boolean; cancel: () => void };

function useCompanionController(leagueId=defaultLeagueId) {
  const presentation = usePresentation();
  const presentationRef = useRef(presentation); presentationRef.current = presentation;
  const [pointer, setPointer] = useState<Pointer | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [screen, setScreen] = useState(false);
  const [control, setControl] = useState(false);
  const [sharingPending, setSharingPending] = useState(false);
  const [phase, setPhase] = useState<VoicePhase>("off");
  const [micPaused, setMicPaused] = useState(false);

  const [notice, setNotice] = useState("");
  const [capabilities, setCapabilities] = useState({ voice: false, screen: false });
  useEffect(() => {
    setCapabilities({ voice: !!window.RTCPeerConnection && !!navigator.mediaDevices?.getUserMedia, screen: !!navigator.mediaDevices?.getDisplayMedia });
  }, []);
  const [liveCaptions, setLiveCaptions] = useState(true);
  const refreshPreferences = useCallback(() => {
    void fetch("/api/preferences", { cache: "no-store" }).then(response => response.ok ? response.json() : null).then(value => { if (value && typeof value.liveCaptions === "boolean") setLiveCaptions(value.liveCaptions); }).catch(() => {});
  }, []);
  useEffect(() => { refreshPreferences(); window.addEventListener("focus", refreshPreferences); return () => window.removeEventListener("focus", refreshPreferences); }, [refreshPreferences]);
  const [quiet, setQuiet] = useState(false);
  const [transcripts,setTranscripts]=useState<ConversationVoiceEvent[]>([]);
  const [voiceSessionIds,setVoiceSessionIds]=useState<string[]>([]);
  const [speaking,setSpeaking]=useState(false);
  const [historyLoading,setHistoryLoading]=useState(false);
  const historyAbort=useRef<AbortController|null>(null);
  const conversationEpoch=useRef(0);
  const [transcriptSaved,setTranscriptSaved]=useState(true);
  const [backgroundWorking, setBackgroundWorking] = useState(false);
  const workspace = useRef<BrowserWorkspace | null>(null);
  if (!workspace.current) workspace.current = new BrowserWorkspace(setPointer, mark => setMarks(previous => mark ? [...previous.slice(-7), mark] : []));
  const bridge = useRef<Bridge | null>(null);
  const live = useRef<PrestonLive | null>(null);
  const captureEpoch = useRef(0);
  const capturePending = useRef(false);
  const stopTalk = useCallback(() => {
    const call = live.current; live.current = null; call?.close();
    workspace.current!.setControl(false); setControl(false);
    setMicPaused(false); setSpeaking(false); setPhase("off"); setBackgroundWorking(false);
  }, []);
  const toggleTalk = useCallback(() => {
    if (live.current) { stopTalk(); return; }
    refreshPreferences();
    setNotice(""); setTranscriptSaved(true); setQuiet(false); presentationRef.current.begin();
    workspace.current!.setControl(true); setControl(true);
    let voiceSessionId='';
    const epoch=conversationEpoch.current;
    const call = new PrestonLive({
      session:id=>{voiceSessionId=id;if(epoch===conversationEpoch.current)setVoiceSessionIds(ids=>[...new Set([...ids,id])]);},
      anchor:()=>bridge.current?.anchor()??null,
      speaking:value=>{if(live.current===call)setSpeaking(value);},
      leagueId,
      phase: value => { if (live.current !== call) return; setPhase(value); if (value === "off") { live.current = null; setMicPaused(false); workspace.current!.setControl(false); setControl(false); } },
      notice: text => { if (live.current === call) setNotice(text); },
      working: value => { if (live.current === call) setBackgroundWorking(value); },
      transcript: event => { if(epoch===conversationEpoch.current && voiceSessionId) setTranscripts(previous=>[...previous,{...event,session_id:voiceSessionId}]); },
      saved: saved=>{if(epoch===conversationEpoch.current)setTranscriptSaved(saved);},
      history: ()=>bridge.current?.history()??[],
      context: () => ({ leagueId, presentation: presentationRef.current.context(), navigationOnly: true, camera: "Camera preview is local only. No camera images are sent; never claim to see the user.", view: document.querySelector('.preview-card [role="tab"][aria-selected="true"]')?.textContent, screen: workspace.current!.context() }),
      tool: async command => {
        if (live.current !== call) return { result: { ok: false, error: "Call ended" } };
        if (["present_view","create_view"].includes(command.name)) {
          if(leagueId!==defaultLeagueId && command.name==="present_view") {
            const view=JSON.parse(command.arguments);
            if(!["performance","episodes"].includes(view.view))return {result:{status:"unsupported",detail:"This league offers performance, episodes, and generated views."}};
            return {result:presentationRef.current.present(view)};
          }
          const response = await fetch(command.name === "create_view"?`/api/views?league=${encodeURIComponent(leagueId)}`:"/api/presentation", { method: "POST", headers: { "Content-Type": "application/json" }, body: command.arguments });
          const prepared = await response.json();
          if (live.current !== call) return { result: { ok: false, error: "Call ended" } };
          return { result: response.ok ? presentationRef.current.present(prepared.presentation) : { status: "rejected", error: prepared.error } };
        }
        if (command.name === "inspect_view") return { result: { presentation: presentationRef.current.context(), screen: workspace.current!.context(), workspace: JSON.parse(workspace.current!.snapshot()) } };
        if (command.name === "workspace_screen") {
          const { image, ...result } = await workspace.current!.execute(JSON.parse(command.arguments));
          return { result, image };
        }
        return null;
      },
    });
    live.current = call; void call.start();
  }, [stopTalk, refreshPreferences, leagueId]);
  const toggleMicPause = useCallback(() => {
    setMicPaused(previous => { live.current?.pause(!previous); return !previous; });
  }, []);
  // Completed chat work is context for the live partner; it never gates microphone input.
  const updateVoice = useCallback((_running: boolean, reply?: string) => {
    if (reply) live.current?.note(`A separate chat response just completed: ${reply.slice(0, 1200)}`);
  }, []);
  const interrupt = useCallback(() => { live.current?.interrupt(); }, []);
  const toggleQuiet = useCallback(() => { setQuiet(previous => { live.current?.setQuiet(!previous); return !previous; }); }, []);
  const resumeAudio = useCallback(() => { live.current?.resumeAudio(); setNotice(""); }, []);

  const stopScreen = useCallback(() => {
    captureEpoch.current++; capturePending.current = false;
    const local = workspace.current!; const navigating = local.control && !!live.current;
    local.revoke(); local.setControl(navigating); setScreen(false); setControl(navigating); setSharingPending(false);
  }, []);
  const share = useCallback(async () => {
    if (workspace.current!.stream) { stopScreen(); return; }
    if (capturePending.current) return;
    if (!navigator.mediaDevices?.getDisplayMedia) return;
    setNotice(""); setSharingPending(true); capturePending.current = true;
    const epoch = ++captureEpoch.current;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: "browser" }, audio: false });
      if (captureEpoch.current !== epoch) { stream.getTracks().forEach(track => track.stop()); return; }
      const screenView = document.createElement("video"); screenView.muted = true; screenView.srcObject = stream;
      const local = workspace.current!; local.stream = stream; local.video = screenView;
      stream.getVideoTracks()[0].addEventListener("ended", stopScreen, { once: true });
      await screenView.play();
      if (captureEpoch.current !== epoch) return;
      local.grant = crypto.randomUUID(); setScreen(true);
    } catch (error) {
      if (captureEpoch.current !== epoch) return;
      stopScreen();
      if (!(error instanceof DOMException && ["NotAllowedError", "AbortError", "InvalidStateError", "NotFoundError"].includes(error.name))) {
        setNotice("Screen sharing failed. Try again.");
      }
    } finally { if (captureEpoch.current === epoch) { setSharingPending(false); capturePending.current = false; } }
  }, [stopScreen]);
  const toggleControl = useCallback(() => {
    const local = workspace.current!;
    local.setControl(!local.control); setControl(local.control);
  }, []);
  const bind = useCallback((next: Bridge) => {
    bridge.current = next;
    return () => { if (bridge.current === next) { bridge.current = null; stopScreen(); } };
  }, [stopScreen]);

  useEffect(() => {
    const stop = () => { stopTalk(); stopScreen(); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector("dialog[open]")) stop(); };
    const clear = () => { setPointer(null); setMarks([]); };
    window.addEventListener("keydown", escape); window.addEventListener("pagehide", stop);
    window.addEventListener("resize", clear); document.addEventListener("scroll", clear, true);
    return () => { stop(); window.removeEventListener("keydown", escape); window.removeEventListener("pagehide", stop); window.removeEventListener("resize", clear); document.removeEventListener("scroll", clear, true); };
  }, [stopTalk, stopScreen]);

  useEffect(()=>{void VoiceJournal.retryStored();const retry=()=>void VoiceJournal.retryStored();const timer=setInterval(retry,10000);window.addEventListener('online',retry);return()=>{clearInterval(timer);window.removeEventListener('online',retry);};},[]);
  const resetConversation=useCallback((chatId?:string,voiceId?:string)=>{
    conversationEpoch.current++;stopTalk();historyAbort.current?.abort();setTranscripts([]);setVoiceSessionIds([]);setTranscriptSaved(true);setNotice('');setHistoryLoading(false);
    if(!chatId&&!voiceId)return;
    const abort=new AbortController();historyAbort.current=abort;setHistoryLoading(true);
    void(async()=>{
      let ids=voiceId?[voiceId]:[];
      if(chatId){const response=await fetch(`/api/voice/transcripts?chat=${encodeURIComponent(chatId)}`,{signal:abort.signal});if(!response.ok)throw Error();ids=(await response.json()).sessions.map((s:{id:string})=>s.id);}
      const batches=await Promise.all(ids.map(id=>readVoiceConversation(id,abort.signal)));
      if(!abort.signal.aborted){setTranscripts(batches.flat());setVoiceSessionIds(ids);}
    })().catch(()=>{if(!abort.signal.aborted)setNotice('The spoken part of this conversation could not load. Reopen it from history to retry.');}).finally(()=>{if(!abort.signal.aborted)setHistoryLoading(false);});
  },[stopTalk]);
  useEffect(()=>()=>historyAbort.current?.abort(),[]);
  const recentTranscript=useCallback(()=>spokenMessages(transcripts).slice(-10).map(t=>({role:t.role,text:t.text.slice(-1500)})),[transcripts]);
  return { resetConversation, voiceSessionIds, historyLoading, speaking, liveCaptions, presentation, phase, capabilities, micPaused, toggleMicPause, notice, transcripts, transcriptSaved, recentTranscript, backgroundWorking, resumeAudio, quiet, toggleQuiet, interrupt, screen, control, sharingPending, pointer, marks, workspace: workspace.current, bind, updateVoice, toggleTalk, stopTalk, share, stopScreen, toggleControl, dismiss: () => setNotice(""), clear: () => { setMarks([]); setPointer(null); } };
}

const CompanionContext = createContext<ReturnType<typeof useCompanionController> | null>(null);
export function useCompanion() {
  const value = useContext(CompanionContext);
  if (!value) throw new Error("Preston needs its companion provider.");
  return value;
}
export function CompanionProvider({ children, leagueId=defaultLeagueId }: { children: ReactNode; leagueId?:string }) {
  const controller = useCompanionController(leagueId);
  return <CompanionContext.Provider value={controller}>{children}<CompanionOverlay /></CompanionContext.Provider>;
}

export function TalkButton({ disabled }: { disabled: boolean }) {
  const { phase, speaking, toggleTalk, capabilities } = useCompanion();
  const label=phase==='off'?'Talk with Preston':phase==='connecting'?'Connecting…':phase==='paused'?'Microphone paused':speaking?'Speaking…':'Listening…';
  return <button id="present-talk-toggle" type="button" className={`companion-talk-button${phase !== "off" ? " active" : ""}${phase === "paused" ? " is-paused" : ""}`} onClick={toggleTalk} disabled={disabled || (!capabilities.voice && phase === "off")} aria-label={phase === "off" ? "Talk with Preston" : "End voice conversation"} aria-pressed={phase !== "off"} title={!capabilities.voice ? "Voice isn’t supported in this browser" : phase === "off" ? "Talk with Preston" : "End voice conversation"}>{phase === "off" ? <Mic size={18} /> : <span className="companion-wave" aria-hidden="true"><i/><i/><i/></span>}<span>{label}</span>{phase!=='off'?<Square size={12}/>:null}</button>;
}

export function ScreenShareButton({ disabled }: { disabled: boolean }) {
  const { screen, sharingPending, share, capabilities } = useCompanion();
  const label = screen ? "Stop sharing" : sharingPending ? "Choose a screen…" : "Share screen";
  return <button type="button" className={`companion-share-button${screen ? " active" : ""}`} onClick={() => void share()} disabled={sharingPending || ((disabled || !capabilities.screen) && !screen)} aria-label={label} title={capabilities.screen ? label : "Screen sharing isn’t supported in this browser"} aria-pressed={screen} aria-busy={sharingPending}><Laptop size={20} strokeWidth={1.6} /></button>;
}

export function CompanionControls({showTranscript=false}:{showTranscript?:boolean}) {
  const c = useCompanion();

  return <section className="companion-controls" aria-label="Preston voice and screen access">
    {c.phase !== "off" ? <div className="companion-access"><button type="button" aria-label={c.micPaused?"Resume microphone":"Pause microphone"} aria-pressed={c.micPaused} onClick={c.toggleMicPause}>{c.micPaused?<Play size={12}/>:<Pause size={12}/>} {c.micPaused?'Resume mic':'Pause mic'}</button><button type="button" aria-pressed={c.quiet} onClick={c.toggleQuiet}>{c.quiet?'Hear replies':'Quiet replies'}</button><button type="button" onClick={c.interrupt}>Let me jump in</button></div> : null}
    {c.backgroundWorking ? <p className="companion-access-note" role="status">I’m looking into that. We can keep talking.</p> : null}
    {showTranscript&&c.liveCaptions&&c.transcripts.length?<div className="voice-transcript live-transcript" aria-label="Live voice transcript">{spokenMessages(c.transcripts).slice(-8).map(turn=><p key={turn.id}><strong>{turn.role==='user'?'You':'Preston'}</strong><span>{turn.text}</span></p>)}</div>:null}
    {c.notice.includes("Resume audio") ? <button type="button" onClick={c.resumeAudio}>Resume audio</button> : null}
    {c.screen || c.phase !== "off" ? <div className="companion-access"><button type="button" onClick={c.toggleControl} aria-pressed={c.control}><MousePointer2 size={14} />{c.control ? "Preston can navigate · Pause" : "Let Preston navigate"}</button></div> : null}
    {c.screen ? <p className="companion-access-note">{c.control ? "Preston can point, draw, and navigate here. Esc stops access." : "Screen shared. Preston can request frames in this conversation."}</p> : null}
    {c.control && !c.screen ? <p className="companion-access-note">We can explore tabs and results together. You can take over anytime.</p> : null}
    {c.notice ? <div className="companion-notice" role="alert"><span>{c.notice}</span><button type="button" onClick={c.dismiss} aria-label="Dismiss access notice"><X size={13} /></button></div> : null}
  </section>;
}

function CompanionOverlay() {
  const c = useCompanion();
  return <>
    {c.screen ? <div className="present-sharing-indicator"><span />Screen shared with Preston<button type="button" onClick={c.stopScreen}><Square size={11} />Stop</button>{c.marks.length ? <button type="button" onClick={c.clear}>Clear drawings</button> : null}</div> : null}
    <div className="present-screen-overlay" aria-hidden="true">
      <svg width="100%" height="100%" viewBox="0 0 1000 1000" preserveAspectRatio="none">{c.marks.map((mark, i) => <polyline key={i} points={mark.points.map(p => `${p.x * 1000},${p.y * 1000}`).join(" ")} fill="none" stroke="#ce7842" strokeWidth="3" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />)}</svg>
      {c.marks.map((mark, i) => mark.label ? <span key={i} className="present-drawing-label" style={{ left: `${mark.points[0].x * 100}%`, top: `${mark.points[0].y * 100}%` }}>{mark.label}</span> : null)}
      {c.pointer ? <div className="present-cursor" style={{ left: `${c.pointer.x * 100}%`, top: `${c.pointer.y * 100}%` }}><MousePointer2 size={24} fill="currentColor" /><span>{c.pointer.label}</span></div> : null}
    </div>
  </>;
}

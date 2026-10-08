"use client";

import { useEffect, useRef, useState } from "react";
import { Play, MessageCircle } from "lucide-react";

export type CoachingDiscussion = (text:string, context?:Record<string,string>)=>void;
export type CoachingRecording = { id: string; episode_id: string; created_at: string; duration_ms: number | null; latest_analysis: {id:string;status:string} | null; policy_reference?: {policy_version_id:string|null} };
type ClipDetail = {
  session: { id:string; recording_url?:string|null; duration_ms:number|null; timeline?:{id:string;kind:string;at_ms:number;payload:{text?:string}}[] };
  analysis: { moments:{start_ms:number;observation:string;coaching_intent:string}[]; questions:string[] } | null;
};
const time = (ms:number) => `${Math.floor(ms/60000)}:${String(Math.floor(ms/1000)%60).padStart(2,"0")}`;

export function CoachingClips({ sessions, onDiscuss }: { sessions: CoachingRecording[]; onDiscuss:CoachingDiscussion }) {
  const [details,setDetails] = useState<ClipDetail[]>([]);
  const [error,setError] = useState("");
  const [loading,setLoading] = useState(false);
  const [retry,setRetry] = useState(0);
  const [selected,setSelected] = useState<string|null>(null);
  const [playError,setPlayError] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  // Stable keys avoid restarting reads when the account's coaching feed refreshes.
  const key = JSON.stringify([...sessions].sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,3).map(s=>[s.id,s.latest_analysis?.id,s.latest_analysis?.status]));
  useEffect(()=>{
    const ids = (JSON.parse(key) as string[][]).map(row=>row[0]);
    const abort = new AbortController();
    setDetails([]);setSelected(null);setError("");setLoading(ids.length>0);
    if (!ids.length) return ()=>abort.abort();
    void Promise.allSettled(ids.map(async id=>{
      const response = await fetch(`/api/coaching/${encodeURIComponent(id)}`, {signal:AbortSignal.any([abort.signal,AbortSignal.timeout(15000)])});
      if (!response.ok) throw Error("Could not load saved coaching.");
      return await response.json() as ClipDetail;
    })).then(results=>{
      if (abort.signal.aborted) return;
      setDetails(results.flatMap(result=>result.status==="fulfilled"?[result.value]:[]));
      setError(results.some(result=>result.status==="rejected") ? "Some saved clips couldn’t load." : "");setLoading(false);
    });
    return ()=>abort.abort();
  },[key,retry]);
  const clips = details.flatMap(detail=>{
    const moments = detail.analysis?.moments?.length ? detail.analysis.moments : (detail.session.timeline??[]).filter(item=>["note","bookmark"].includes(item.kind)).map(item=>({start_ms:item.at_ms,observation:item.payload.text??"Marked moment",coaching_intent:"What would you like the policy to do here?"}));
    return [...moments].filter(moment=>Number.isFinite(moment.start_ms)&&moment.start_ms>=0&&(!detail.session.duration_ms||moment.start_ms<detail.session.duration_ms)).sort((a,b)=>a.start_ms-b.start_ms).slice(0,2).map((moment,index)=>({
      ...moment, id:`${detail.session.id}:${index}`, sessionId:detail.session.id,
      url:detail.session.recording_url,
      end:Math.min(moment.start_ms+20000,detail.session.duration_ms??Infinity),
    }));
  }).slice(0,4);
  const current = clips.find(clip=>clip.id===selected);
  return <section className="home-recordings" aria-label="Saved coaching clips">
    {loading?<p role="status">Finding your saved coaching moments…</p>:null}
    {error?<p role="status">{error} <button className="text-button" onClick={()=>setRetry(n=>n+1)}>Retry clips</button></p>:null}
    {clips.length?<><h3>Saved clips</h3><div className="home-clip-list">{clips.map(clip=><article key={clip.id}>
      <button className="home-clip-play" aria-label={`Play clip at ${time(clip.start_ms)}: ${clip.observation}`} disabled={!clip.url} aria-pressed={selected===clip.id} onClick={()=>{setSelected(clip.id);setPlayError("");}}><Play size={17}/><span>{time(clip.start_ms)}</span></button>
      <div><h4>{clip.observation}</h4><p>{clip.coaching_intent}</p>{!clip.url?<small>Recording unavailable · saved note</small>:null}<button className="text-button" onClick={()=>onDiscuss(`Let’s review the moment at ${time(clip.start_ms)}: ${clip.observation}. ${clip.coaching_intent}`, {kind:"coaching-session",coaching_session_id:clip.sessionId,start_ms:String(clip.start_ms),hint:"Read coaching_feedback first; ask for my interpretation before proposing a change."})}><MessageCircle size={13}/> Discuss</button></div>
    </article>)}</div></>:null}
    {current?.url?<div className="home-clip-player"><div><strong>{time(current.start_ms)} · {current.observation}</strong><button className="text-button" onClick={()=>setSelected(null)}>Close clip ×</button></div>
      <video key={current.id} ref={video} controls playsInline preload="metadata" src={current.url} aria-label="Coaching clip player" onLoadedMetadata={event=>{event.currentTarget.currentTime=current.start_ms/1000;void event.currentTarget.play().catch(()=>setPlayError("Press play to watch this clip."));}} onTimeUpdate={event=>{if(event.currentTarget.currentTime>=current.end/1000)event.currentTarget.pause();}} onPlay={event=>{if(event.currentTarget.currentTime>=current.end/1000)event.currentTarget.currentTime=current.start_ms/1000;}} onError={()=>setPlayError("This recording could not play. Retry clips to refresh its link.")}/>{playError?<p role="status">{playError} <button className="text-button" onClick={()=>{setPlayError("");setRetry(n=>n+1);}}>Retry clips</button></p>:null}
    </div>:null}
  </section>;
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { coachingCaptureSupported, startCoachingRecording, type CoachingRecording } from "../lib/coaching-recorder";
import { RecordingClock } from "../lib/coaching-clock";

type Episode = { id: string; episode_id: string | null; run_id: string };
type Summary = { id: string; status: string; created_at: string; duration_ms: number | null; latest_analysis: { id: string; status: string } | null };
type Proposal = { layer: string; change: string; rationale: string; verification: string; evidence_ids: string[] };
type Analysis = { summary: string; ir_proposals: Proposal[]; moments: { start_ms: number; observation: string; coaching_intent: string }[]; questions: string[] };
type Detail = { session: Summary & { declared_context: string; recording_url?: string | null; latest_analysis: { id: string; status: string; phase?: string | null; error?: string | null } | null; timeline?: { id: string; kind: string; at_ms: number; payload: { text?: string } }[] }; analysis: Analysis | null };
type Event = { client_seq: number; kind: "note" | "bookmark" | "pause" | "resume" | "mic" | "tick_anchor"; at_ms: number; tick: number | null; payload?: { text?: string; state?: string; during_pause?: boolean; playing?: boolean } };
type Active = { id: string; upload: { url: string; content_type: string }; recording: CoachingRecording; clock: RecordingClock; queue: Event[]; nextSeq: number; sending: Promise<void> | null; lastTick: number | null; replayPlaying: boolean };
type Unsaved = { active: Active; blob: Blob; duration: number };

async function api(path: string, body?: unknown) {
  const response = await fetch(path, body === undefined ? undefined : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? data.detail ?? `Request failed (${response.status})`);
  return data;
}

async function uploadRecording(url: string, contentType: string, blob: Blob, progress: (percent: number) => void) {
  await new Promise<void>((resolve, reject) => {
    const upload = new XMLHttpRequest();
    upload.open("PUT", url);
    upload.setRequestHeader("Content-Type", contentType);
    upload.upload.onprogress = (event) => { if (event.lengthComputable) progress(Math.round(event.loaded / event.total * 100)); };
    upload.onload = () => upload.status >= 200 && upload.status < 300 ? resolve() : reject(new Error(`Recording upload failed (${upload.status})`));
    // A status of 0 with no response means the browser refused the request before sending it,
    // which for a presigned S3 PUT is almost always a bucket CORS policy missing this origin.
    upload.onerror = () => reject(new Error(upload.status === 0
      ? `The recording storage did not accept uploads from ${window.location.origin}. The Softmax coaching bucket's CORS policy must allow this origin.`
      : "Recording upload lost its connection"));
    upload.send(blob);
  });
}

export function ReplayCoaching({ episode, sessions, replay, onSaved, onDiscuss, onRecordingChange, focusSessionId }: {
  episode: Episode; sessions: Summary[]; replay: React.ReactNode; onSaved: () => void;
  onDiscuss: (session: Summary) => void; onRecordingChange: (recording: boolean) => void; focusSessionId?: string;
}) {
  const captureRef = useRef<HTMLDivElement>(null);
  const recordingRef = useRef<HTMLVideoElement>(null);
  const activeRef = useRef<Active | null>(null);
  const unsavedRef = useRef<Unsaved | null>(null);
  const [selectedId, setSelectedId] = useState(focusSessionId && sessions.some((item) => item.id === focusSessionId) ? focusSessionId : sessions[0]?.id ?? "");
  useEffect(() => { if (focusSessionId && sessions.some((item) => item.id === focusSessionId)) { setSelectedId(focusSessionId); setDetail(null); } }, [focusSessionId, sessions]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [context, setContext] = useState("");
  const [note, setNote] = useState("");
  const [marks, setMarks] = useState<{ at: number; text: string }[]>([]);
  const [phase, setPhase] = useState<"idle" | "starting" | "recording" | "paused" | "saving" | "failed">("idle");
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { if (!selectedId && sessions[0]) setSelectedId(sessions[0].id); }, [sessions, selectedId]);
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    const refresh = () => api(`/api/coaching/${selectedId}`).then((data: Detail) => {
      if (!cancelled) { setDetail(data); setError(""); }
    }).catch((cause: Error) => { if (!cancelled) setError(cause.message); });
    void refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [selectedId]);

  useEffect(() => {
    if (phase !== "recording" && phase !== "paused") return;
    const timer = window.setInterval(() => {
      const active = activeRef.current;
      if (!active) return;
      setElapsed(active.clock.elapsedMs());
      void flush(active).catch((cause: Error) => setError(cause.message));
    }, 1000);
    const protect = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", protect);
    return () => { window.clearInterval(timer); window.removeEventListener("beforeunload", protect); };
  }, [phase]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const iframe = captureRef.current?.querySelector("iframe");
      if (!iframe || event.source !== iframe.contentWindow || event.origin !== new URL(iframe.src).origin) return;
      const data = event.data as { src?: unknown; type?: unknown; tick?: unknown; playing?: unknown } | null;
      if (data?.src !== "coworld-replay" || data.type !== "tick" || typeof data.tick !== "number" || !Number.isInteger(data.tick) || data.tick < 0 || typeof data.playing !== "boolean") return;
      const active = activeRef.current;
      if (!active || unsavedRef.current) return;
      active.lastTick = data.tick;
      active.replayPlaying = data.playing;
      if (!active.clock.paused) add(active, "tick_anchor", { playing: data.playing });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const flush = useCallback((active: Active): Promise<void> => {
    if (active.sending) return active.sending;
    if (!active.queue.length) return Promise.resolve();
    const batch = active.queue.slice(0, 500);
    active.sending = api(`/api/coaching/${active.id}/events`, { events: batch })
      .then(() => { active.queue.splice(0, batch.length); })
      .finally(() => { active.sending = null; });
    return active.sending;
  }, []);

  const add = (active: Active, kind: Event["kind"], payload?: Event["payload"]) => {
    active.queue.push({ client_seq: active.nextSeq++, kind, at_ms: active.clock.elapsedMs(), tick: active.lastTick, ...(payload ? { payload } : {}) });
  };

  const save = useCallback(async (unsaved: Unsaved) => {
    setPhase("saving");
    setError("");
    try {
      while (unsaved.active.queue.length || unsaved.active.sending) await flush(unsaved.active);
      const digest = await crypto.subtle.digest("SHA-256", await unsaved.blob.arrayBuffer());
      const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      await uploadRecording(unsaved.active.upload.url, unsaved.active.upload.content_type, unsaved.blob, setProgress);
      await api(`/api/coaching/${unsaved.active.id}/finish`, {
        duration_ms: Math.max(1, unsaved.duration),
        tick_alignment: unsaved.active.lastTick === null ? "unavailable" : "available",
        video: { bytes: unsaved.blob.size, sha256, mime: unsaved.active.recording.mimeType },
      });
      setSelectedId(unsaved.active.id);
      setDetail(null);
      activeRef.current = null;
      unsavedRef.current = null;
      setPhase("idle");
      onRecordingChange(false);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save recording");
      setPhase("failed");
    }
  }, [flush, onRecordingChange, onSaved]);

  const finish = useCallback(async () => {
    const active = activeRef.current;
    if (!active || unsavedRef.current) return;
    active.clock.pause();
    setPhase("saving");
    const duration = active.clock.elapsedMs();
    const blob = await active.recording.stop(duration);
    unsavedRef.current = { active, blob, duration };
    await save(unsavedRef.current);
  }, [save]);

  const start = async () => {
    if (!captureRef.current || !coachingCaptureSupported()) { setError("Replay recording needs a browser with tab capture and WebM support."); return; }
    setError("");
    setPhase("starting");
    let recording: CoachingRecording | null = null;
    try {
      recording = await startCoachingRecording({ cropTo: captureRef.current, onLevels: () => {}, onCaptureEnded: () => void finish() });
      const clock = new RecordingClock();
      clock.start();
      const created: { id: string; upload: { url: string; content_type: string } } = await api("/api/coaching", {
        runId: episode.run_id, episodeId: episode.id, idempotencyKey: crypto.randomUUID(), context,
      });
      activeRef.current = { id: created.id, upload: created.upload, recording, clock, queue: [], nextSeq: 0, sending: null, lastTick: null, replayPlaying: false };
      setSelectedId(created.id);
      setMarks([]);
      setMuted(false);
      setElapsed(0);
      setPhase("recording");
      onRecordingChange(true);
    } catch (cause) {
      recording?.abort();
      const denied = cause instanceof DOMException && (cause.name === "NotAllowedError" || cause.name === "SecurityError");
      setError(denied ? "Recording needs microphone and tab-sharing permission. Allow both when the browser asks (in Brave, also lower Shields for this site or allow them under Site settings), then press Record again." : cause instanceof Error ? cause.message : "Could not start recording");
      setPhase("idle");
    }
  };

  const active = activeRef.current;
  const current = detail?.session;
  const analysis = detail?.analysis;
  const status = current?.latest_analysis?.status;

  const savedMoments = current?.timeline?.filter((item) => item.kind === "note" || item.kind === "bookmark") ?? [];
  const sessionOptions = [...sessions, ...(selectedId && !sessions.some((item) => item.id === selectedId) ? [{ id: selectedId, status: "recording", created_at: new Date().toISOString(), duration_ms: null, latest_analysis: null }] : [])];
  return <div className="coaching-workspace">
    <div ref={captureRef} className="coaching-capture">{replay}</div>
    <div className="coaching-widget">
      <section className="coaching-record" aria-label="Record coaching">
        <div className="coaching-widget-head"><div><span className="eyebrow">Replay coaching</span><strong>{phase === "recording" || phase === "paused" ? `${phase === "paused" ? "Paused" : "Recording"} · ${Math.floor(elapsed / 60000).toString().padStart(2, "0")}:${Math.floor(elapsed / 1000 % 60).toString().padStart(2, "0")}` : "Watch, narrate, improve"}</strong></div>
          {phase === "recording" || phase === "paused" ? <span className="recording-pill"><span /> Live</span> : null}</div>
        {phase === "idle" ? <div className="coaching-start"><p>Record this replay with your microphone and add notes at the moments you want to change. Finishing sends the recording and notes to Gemini for policy suggestions.</p>
          <textarea aria-label="What do you want to examine?" maxLength={10000} value={context} onChange={(event) => setContext(event.target.value)} placeholder="What should your hero have done differently?" />
          <button className="coaching-primary" onClick={() => void start()}>● Record coaching</button></div> : null}
        {phase === "starting" ? <p className="coaching-status">Allow microphone access, then choose this tab to record.</p> : null}
        {phase === "recording" || phase === "paused" ? <div className="coaching-controls"><div className="coaching-control-row">
          <button onClick={() => { if (!active) return; if (phase === "recording") { add(active, "pause"); active.clock.pause(); active.recording.pause(); setPhase("paused"); } else { active.clock.resume(); active.recording.resume(); add(active, "resume"); if (active.lastTick !== null) add(active, "tick_anchor", { playing: active.replayPlaying }); setPhase("recording"); } }}>{phase === "recording" ? "Pause" : "Resume"}</button>
          <button onClick={() => { if (!active) return; const next = !muted; active.recording.setMuted(next); add(active, "mic", { state: next ? "muted" : "unmuted" }); setMuted(next); }}>{muted ? "Unmute mic" : "Mute mic"}</button>
          <button className="coaching-primary" onClick={() => void finish()}>Finish & analyze</button></div>
          <div className="coaching-note"><textarea aria-label="Timed coaching note" value={note} maxLength={10000} onChange={(event) => setNote(event.target.value)} placeholder="What happened at this moment?" /><div><button disabled={!note.trim()} onClick={() => { if (!active || !note.trim()) return; add(active, "note", { text: note.trim(), during_pause: active.clock.paused }); setMarks((previous) => [...previous, { at: active.clock.elapsedMs(), text: note.trim() }]); setNote(""); }}>Add timed note</button><button onClick={() => { if (!active) return; add(active, "bookmark", { text: "Marked moment" }); setMarks((previous) => [...previous, { at: active.clock.elapsedMs(), text: "Marked moment" }]); }}>Mark moment</button></div></div>
          {marks.length ? <ol className="coaching-marks">{marks.map((mark, index) => <li key={index}><time>{Math.floor(mark.at / 1000)}s</time> {mark.text}</li>)}</ol> : null}
        </div> : null}
        {phase === "saving" ? <p className="coaching-status">Saving recording… {progress}%</p> : null}
        {phase === "failed" ? <button className="coaching-primary" onClick={() => { if (unsavedRef.current) void save(unsavedRef.current); }}>Retry saving recording</button> : null}
        {error ? <p className="error coaching-error" role="alert">{error}</p> : null}
      </section>
      {sessions.length > 0 || selectedId ? <section className="coaching-review" aria-label="Coaching sessions">
        <div className="coaching-review-head"><div><span className="eyebrow">Coaching sessions</span><strong>{sessionOptions.length === 1 ? "1 recording" : `${sessionOptions.length} recordings`} for this match</strong></div>
          <select aria-label="Choose coaching session" value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setDetail(null); }}>
            {sessionOptions.map((item) => <option key={item.id} value={item.id}>{new Date(item.created_at).toLocaleString()} · {item.status}</option>)}
          </select></div>
        <div className="coaching-review-body">
          {current?.recording_url ? <video ref={recordingRef} className="coaching-video" src={current.recording_url} controls preload="metadata" /> : <div className="coaching-video placeholder">No recording yet</div>}
          <div className="coaching-saved-notes"><span className="eyebrow">Recorded moments</span>
            {savedMoments.length ? <ol>{savedMoments.map((item) => <li key={item.id}><time>{Math.floor(item.at_ms / 1000)}s</time><span>{item.payload.text ?? "Marked moment"}</span></li>)}</ol> : <p className="muted">No timed notes in this recording.</p>}
            {status === "queued" || status === "processing" ? <p className="coaching-status">Gemini is reviewing the recording and notes{current?.latest_analysis?.phase ? ` · ${current.latest_analysis.phase}` : ""}…</p> : null}
            {status === "failed" ? <><p className="error">Analysis failed: {current?.latest_analysis?.error ?? "Please retry."}</p><button className="secondary" onClick={() => void api(`/api/coaching/${selectedId}/analyses`, { idempotencyKey: crypto.randomUUID() }).then(() => onSaved()).catch((cause: Error) => setError(cause.message))}>Retry analysis</button></> : null}
          </div>
        </div>
      </section> : null}
      {analysis ? <section className="coaching-analysis" aria-label="Coaching analysis">
        <div className="coaching-analysis-head"><div><span className="eyebrow">Semantic ↔ symbolic suggestions</span><strong>What the review proposes</strong></div>
          <button className="coaching-primary" onClick={() => onDiscuss(current!)} title="Starts a chat where the Coplay Agent applies these proposals to hero.bas, saves the revision, uploads it, and plays a hosted game">Discuss and update policy ↗</button></div>
        <p className="coaching-summary">{analysis.summary}</p>
        {analysis.moments.length ? <ol className="coaching-observations">{analysis.moments.map((moment, index) => <li key={index}><button type="button" onClick={() => { if (!recordingRef.current) return; recordingRef.current.currentTime = moment.start_ms / 1000; void recordingRef.current.play(); }}>↳ {Math.floor(moment.start_ms / 60000).toString().padStart(2, "0")}:{Math.floor(moment.start_ms / 1000 % 60).toString().padStart(2, "0")}</button><div><strong>{moment.observation}</strong><p>{moment.coaching_intent}</p></div></li>)}</ol> : null}
        <ol className="coaching-proposals">{analysis.ir_proposals.map((proposal, index) => <li key={index}>
          <div className="proposal-index">{index + 1}</div>
          <div className="proposal-body"><small>{proposal.layer}</small><strong>{proposal.change}</strong><p>{proposal.rationale}</p><span>Test: {proposal.verification}</span></div>
        </li>)}</ol>
      </section> : null}
    </div>
  </div>;
}

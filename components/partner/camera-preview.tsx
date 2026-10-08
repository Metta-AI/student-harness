"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import { useCompanion } from "./companion";

/** Local preview only: never attached to WebRTC, uploaded, or recorded. */
export function CameraPreview({ disabled }: { disabled: boolean }) {
  const { phase } = useCompanion();
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const active = useRef<MediaStream | null>(null);
  const epoch = useRef(0);
  const requesting = useRef(false);
  const previousPhase = useRef(phase);
  const stop = useCallback(() => {
    epoch.current++; requesting.current = false;
    active.current?.getTracks().forEach(track => track.stop()); active.current = null;
    setStream(null); setPending(false);
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") stop(); };
    window.addEventListener("pagehide", stop); window.addEventListener("keydown", escape);
    return () => { stop(); window.removeEventListener("pagehide", stop); window.removeEventListener("keydown", escape); };
  }, [stop]);
  useEffect(() => {
    if (previousPhase.current !== "off" && phase === "off") stop();
    previousPhase.current = phase;
  }, [phase, stop]);
  useEffect(() => {
    const element = video.current;
    if (!element || !stream) return;
    element.srcObject = stream;
    void element.play().catch(() => { if (active.current === stream) { stop(); setNotice("Camera preview could not start. Try again."); } });
    return () => { element.srcObject = null; };
  }, [stream, stop]);
  const toggle = async () => {
    if (active.current || requesting.current) { stop(); return; }
    if (!navigator.mediaDevices?.getUserMedia) { setNotice("Camera preview isn’t available in this browser."); return; }
    const current = ++epoch.current; requesting.current = true; setPending(true); setNotice("");
    try {
      const captured = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      if (epoch.current !== current) { captured.getTracks().forEach(track => track.stop()); return; }
      active.current = captured; setStream(captured);
      captured.getVideoTracks().forEach(track => track.addEventListener("ended", () => { if (active.current === captured) stop(); }, { once: true }));
    } catch (error) {
      if (epoch.current === current && !(error instanceof DOMException && ["NotAllowedError", "AbortError"].includes(error.name))) setNotice("Camera unavailable. Check that another app isn’t using it.");
    } finally { if (epoch.current === current) { requesting.current = false; setPending(false); } }
  };
  if (phase === "off" || phase === "connecting") return null;
  const label = stream ? "Turn camera off" : pending ? "Cancel camera" : "Turn camera on";
  return <div className="companion-camera">
    <button type="button" className={`companion-share-button${stream ? " active" : ""}`} title={label} aria-label={label} aria-pressed={!!stream} aria-busy={pending} disabled={disabled && !stream && !pending} onClick={() => void toggle()}><Camera size={20} strokeWidth={1.6}/></button>
    {stream ? <figure className="companion-camera-preview"><video ref={video} muted playsInline autoPlay aria-label="Your local camera preview"/><button type="button" aria-label="Turn camera off" onClick={stop}><X size={14}/></button><figcaption><span className="camera-live-dot"/>You · Local preview only</figcaption><p>Preston isn’t receiving camera images yet.</p></figure> : null}
    {notice ? <p role="status" className="companion-access-note">{notice}</p> : null}
  </div>;
}

"use client";

import { useEffect, useRef, useState } from "react";
import { track } from "../lib/analytics";
import { replayGrounding, saveMoment } from "../lib/research/grounding";
import { events } from "../lib/analytics-events";

type ViewerState = { kind: "loading"; alive: boolean } | { kind: "ready" } | { kind: "error"; message: string } | { kind: "stalled"; alive: boolean };

/**
 * Embeds a Softmax static replay viewer and follows its readiness protocol: the viewer posts
 * `{ src: "coworld-replay", type: "loading" | "ready" | "error" }` to its parent. The overlay
 * stays until ready, and a long silence surfaces a hint for browsers that block the frame.
 */
export function ReplayFrame({ src, title, episodeId, versionId }: { src: string; title: string; episodeId?: string; versionId?: string }) {
  const [momentNotice, setMomentNotice] = useState("");
  const frame = useRef<HTMLIFrameElement>(null);
  const [state, setState] = useState<ViewerState>({ kind: "loading", alive: false });

  useEffect(() => {
    setState({ kind: "loading", alive: false });
    const mounted = Date.now();
    const onMessage = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow || event.origin !== new URL(src).origin) return;
      if (episodeId && versionId) replayGrounding.update(episodeId, versionId, event.data);
      const data = event.data as { src?: unknown; type?: unknown; message?: unknown } | null;
      if (data?.src !== "coworld-replay") return;
      if (data.type === "ready") { setState({ kind: "ready" }); track(events.replayReady, { ms: Date.now() - mounted }); }
      else if (data.type === "error") { setState({ kind: "error", message: typeof data.message === "string" ? data.message : "The replay could not be drawn." }); track(events.replayFailed, { reason: "viewer_error" }); }
      else setState((current) => current.kind === "loading" || current.kind === "stalled" ? { ...current, alive: true } : current);
    };
    window.addEventListener("message", onMessage);
    const stall = window.setTimeout(() => setState((current) => {
      if (current.kind !== "loading") return current;
      track(events.replayFailed, { reason: current.alive ? "slow" : "blocked" });
      return { kind: "stalled", alive: current.alive };
    }), 25_000);
    return () => { if (episodeId) replayGrounding.clear(episodeId); window.removeEventListener("message", onMessage); window.clearTimeout(stall); };
  }, [src, episodeId, versionId]);

  const mark = async () => {
    const anchor = replayGrounding.capture();
    if (!anchor || !replayGrounding.cycleId) { setMomentNotice("Choose a research cycle and wait for a fresh replay position before marking."); return; }
    try { await saveMoment("Marked for review", anchor, replayGrounding.cycleId); setMomentNotice(`Saved moment at tick ${anchor.tick}`); }
    catch (error) { setMomentNotice(error instanceof Error ? error.message : "Moment was not saved"); }
  };
  return <div className="replay-frame-wrap">
    {episodeId && versionId ? <div className="replay-research-mark"><button type="button" onClick={() => void mark()}>Mark for research</button><span role="status">{momentNotice}</span></div> : null}
    <iframe ref={frame} key={src} className="replay-frame" src={src} title={title} allow="autoplay; fullscreen" allowFullScreen />
    {state.kind !== "ready" ? <div className={`replay-overlay${state.kind === "error" ? " error" : ""}`} role="status">
      {state.kind === "loading" ? <><span className="status-dot" /> Loading replay…</> : null}
      {state.kind === "error" ? <>Replay failed: {state.message}</> : null}
      {state.kind === "stalled" && state.alive ? <><span className="status-dot" /> Still loading the replay. Large matches take a moment.</> : null}
      {state.kind === "stalled" && !state.alive ? <>The replay viewer never started. Your browser may be blocking embedded content for this site. In Brave, lower Shields for this page; then reload.</> : null}
    </div> : null}
  </div>;
}

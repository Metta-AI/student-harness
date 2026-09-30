"use client";

import { useEffect, useRef, useState } from "react";

type ViewerState = { kind: "loading" } | { kind: "ready" } | { kind: "error"; message: string } | { kind: "stalled" };

/**
 * Embeds a Softmax static replay viewer and follows its readiness protocol: the viewer posts
 * `{ src: "coworld-replay", type: "loading" | "ready" | "error" }` to its parent. The overlay
 * stays until ready, and a long silence surfaces a hint for browsers that block the frame.
 */
export function ReplayFrame({ src, title }: { src: string; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [state, setState] = useState<ViewerState>({ kind: "loading" });

  useEffect(() => {
    setState({ kind: "loading" });
    const onMessage = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const data = event.data as { src?: unknown; type?: unknown; message?: unknown } | null;
      if (data?.src !== "coworld-replay") return;
      if (data.type === "ready") setState({ kind: "ready" });
      else if (data.type === "error") setState({ kind: "error", message: typeof data.message === "string" ? data.message : "The replay could not be drawn." });
    };
    window.addEventListener("message", onMessage);
    const stall = window.setTimeout(() => setState((current) => current.kind === "loading" ? { kind: "stalled" } : current), 25_000);
    return () => { window.removeEventListener("message", onMessage); window.clearTimeout(stall); };
  }, [src]);

  return <div className="replay-frame-wrap">
    <iframe ref={frame} key={src} className="replay-frame" src={src} title={title} allow="autoplay; fullscreen" allowFullScreen />
    {state.kind !== "ready" ? <div className={`replay-overlay${state.kind === "error" ? " error" : ""}`} role="status">
      {state.kind === "loading" ? <><span className="status-dot" /> Loading replay…</> : null}
      {state.kind === "error" ? <>Replay failed: {state.message}</> : null}
      {state.kind === "stalled" ? <>Still loading. If this stays blank, your browser may be blocking embedded content for this site. In Brave, lower Shields for this page; then reload.</> : null}
    </div> : null}
  </div>;
}

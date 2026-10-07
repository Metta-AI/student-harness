import { z } from "zod";
export const anchorSchema = z.object({ episodeId: z.string().min(1).max(200), versionId: z.uuid(), tick: z.number().int().nonnegative(),
  observedAt: z.number().finite(), capturedAt: z.number().finite(), playing: z.boolean() });
export type ReplayAnchor = z.infer<typeof anchorSchema>;
export function validAnchor(anchor: ReplayAnchor, receivedAt = Date.now()) {
  return anchor.capturedAt >= anchor.observedAt && anchor.capturedAt - anchor.observedAt <= 3000
    && receivedAt - anchor.capturedAt <= 120000 && receivedAt >= anchor.capturedAt - 1000;
}
/** Capture at speech onset, never replace with the playhead when transcription finishes. */
export class ReplayGrounding {
  cycleId: string | null = null;
  private current: Omit<ReplayAnchor, "capturedAt"> | null = null;
  update(episodeId: string, versionId: string, data: unknown, now = Date.now()) {
    const p = z.object({ src: z.literal("coworld-replay"), type: z.literal("tick"), tick: z.number().int().nonnegative(), playing: z.boolean() }).safeParse(data);
    if (p.success) this.current = { episodeId, versionId, tick: p.data.tick, playing: p.data.playing, observedAt: now };
  }
  clear(episodeId: string) { if (this.current?.episodeId === episodeId) this.current = null; }
  capture(now = Date.now()): ReplayAnchor | null {
    const anchor = this.current ? { ...this.current, capturedAt: now } : null;
    return anchor && validAnchor(anchor, now) ? anchor : null;
  }
}
export const replayGrounding = new ReplayGrounding();
export async function saveMoment(text: string, anchor: ReplayAnchor, cycleId: string) {
  const response = await fetch("/api/research", { method: "POST", headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(10000),
    body: JSON.stringify({ action: "moment", cycleId, requestKey: crypto.randomUUID(), text, anchor }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Moment was not saved");
  window.dispatchEvent(new Event("research-updated"));
  return result.id as string;
}

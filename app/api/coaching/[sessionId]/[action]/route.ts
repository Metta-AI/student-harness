import { NextResponse } from "next/server";
import { trackServer } from "../../../../../lib/analytics-server";
import { events } from "../../../../../lib/analytics-events";
import { z } from "zod";
import { currentSession, sameOrigin } from "../../../../../lib/session";
import { appendCoachingEvents, finishCoachingSession, getCoachingSession, startCoachingAnalysis } from "../../../../../lib/softmax";

const eventSchema = z.object({
  client_seq: z.number().int().nonnegative(), at_ms: z.number().int().nonnegative(),
  tick: z.number().int().nonnegative().nullable().optional(),
  kind: z.enum(["note", "bookmark", "pause", "resume", "mic", "tick_anchor"]),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ sessionId: string; action: string }> }) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const { sessionId, action } = await context.params;
  if (!/^csn_[0-9a-f-]{36}$/.test(sessionId)) return NextResponse.json({ error: "Invalid session" }, { status: 400 });
  if (!["events", "finish", "analyses"].includes(action)) return NextResponse.json({ error: "Unknown action" }, { status: 404 });
  const detail = await getCoachingSession(session.token, sessionId);
  if (detail.user_id !== session.subjectId) return NextResponse.json({ error: "This coaching session is not yours" }, { status: 403 });
  const body: unknown = await request.json();
  if (action === "events") {
    const { events } = z.object({ events: z.array(eventSchema).min(1).max(500) }).parse(body);
    return NextResponse.json(await appendCoachingEvents(session.token, sessionId, events));
  }
  if (action === "finish") {
    const input = z.object({
      duration_ms: z.number().int().positive(), tick_alignment: z.enum(["available", "unavailable"]),
      video: z.object({ bytes: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/), mime: z.string() }),
    }).parse(body);
    return NextResponse.json(await finishCoachingSession(session.token, sessionId, input));
  }
  const { idempotencyKey } = z.object({ idempotencyKey: z.uuid() }).parse(body);
  const analysis = await startCoachingAnalysis(session.token, sessionId, idempotencyKey);
  await trackServer(session.subjectId, events.coachingAnalysisRequested, { coaching_session_id: sessionId });
  return NextResponse.json(analysis);
}

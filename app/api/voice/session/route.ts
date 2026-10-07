import { defaultLeagueId,leagueIdSchema } from "../../../../lib/league-catalog";
import { userPreferences } from "../../../../lib/preferences-store";
import { z } from "zod";
import { createHash } from "node:crypto";
import { currentSession, sameOrigin } from "../../../../lib/session";
import { liveSessionConfig } from "../../../../lib/voice/config";
import { createVoiceLease, openAIBaseURL, reserveVoiceStart } from "../../../../lib/voice/server";

import { chatHistorySchema } from "../../../../lib/voice/transcript";
import { registerVoiceSession } from "../../../../lib/voice/transcript-store";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  const student = await currentSession();
  if (!student) return Response.json({ error: "Sign in first" }, { status: 401 });
  if (!process.env.OPENAI_API_KEY) return Response.json({ error: "Voice needs an OpenAI key on the server." }, { status: 503 });
  if (Number(request.headers.get("content-length")) > 70_000) return new Response(null, { status: 413 });
  let sdp: string, leagueId: string, history: {role:"user"|"assistant";text:string}[];
  try { ({ sdp, history, leagueId } = z.object({ leagueId:leagueIdSchema.default(defaultLeagueId), sdp: z.string().min(10).max(65_536), history: chatHistorySchema.default([]) }).parse(await request.json())); }
  catch { return Response.json({ error: "Invalid voice offer" }, { status: 400 }); }
  if (!reserveVoiceStart(student.subjectId)) return Response.json({ error: "Give the voice connection a moment before retrying." }, { status: 429 });
  try {
    const preferences = await userPreferences(student.subjectId);
    const selected=leagueId===defaultLeagueId?undefined:await (await import("../../../../lib/softmax")).getCatalogLeague(student.token,leagueId,AbortSignal.timeout(12000));
    const scope=selected?{id:selected.id,name:selected.name,gameName:selected.game.name}:undefined;
    const input=history.slice(-12).map(m=>({type:'message',role:m.role,content:[{type:m.role==='assistant'?'output_text':'input_text',text:m.text}]}));
    const upstream = await fetch(`${openAIBaseURL()}/live/sessions`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "OpenAI-Safety-Identifier": createHash("sha256").update(student.subjectId).digest("hex") },
      body: JSON.stringify({ session: {...liveSessionConfig(preferences,scope),input}, transport: { type: "webrtc", sdp } }),
      signal: AbortSignal.timeout(35_000),
    });
    if (!upstream.ok) {
      // Never log the upstream body: credential errors can contain key fragments.
      const body = await upstream.json().catch(() => null);
      const safeField = (value: unknown) => typeof value === "string" && /^[a-zA-Z0-9_.\[\]-]{1,160}$/.test(value) ? value : undefined;
      console.error("Preston Live connection rejected " + JSON.stringify({status:upstream.status,requestId:upstream.headers.get("x-request-id"),code:safeField(body?.error?.code),type:safeField(body?.error?.type),param:safeField(body?.error?.param)}));
      const error = upstream.status === 401 ? "OpenAI rejected the server key. Update OPENAI_API_KEY or its gateway configuration."
        : upstream.status === 403 || upstream.status === 404 ? "This account or gateway does not have GPT-Live access."
        : upstream.status === 429 ? "Voice is temporarily at its usage limit. Try again shortly." : "Voice could not connect. Try again.";
      return Response.json({ error }, { status: 502 });
    }
    const result = z.object({ session: z.object({ id: z.string() }), transport: z.object({ sdp: z.string() }) }).parse(await upstream.json());
    await registerVoiceSession(student.subjectId,result.session.id,"gpt-live-1",leagueId);
    return Response.json({ sdp: result.transport.sdp, sessionId: result.session.id, lease: createVoiceLease(student.subjectId, result.session.id,leagueId) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Preston Live startup failed " + JSON.stringify({type:error instanceof Error?error.name:"UnknownError"}));
    return Response.json({ error: "Voice could not connect. Try again." }, { status: 502 });
  }
}

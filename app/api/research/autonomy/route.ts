import { NextResponse } from "next/server";
import { currentSession, sameOrigin } from "../../../../lib/session";
import { readAutonomy, settingsSchema, wakeResearch } from "../../../../lib/research/autonomy";
import { rpc } from "../../../../lib/tasks/store";
import { z } from "zod";
export async function GET() {
  const student = await currentSession(); if (!student) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  try { return NextResponse.json(await readAutonomy(student.subjectId), { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "Research settings unavailable" }, { status: 503 }); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const student = await currentSession(); if (!student) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  try {
    const body = await request.json();
    if (body.action === "bootstrap") return NextResponse.json({ settings: await rpc("autoresearch_bootstrap", { p_student: student.subjectId }) });
    if (body.action === "investigate") {
      const p = z.object({ direction: z.string().min(8).max(2000), requestKey: z.string().min(8).max(160) }).parse(body);
      return NextResponse.json(await wakeResearch(student.subjectId, p.direction, `human:${p.requestKey}`));
    }
    if (body.action !== "settings") throw new Error("Unknown action");
    const p = settingsSchema.parse(body);
    return NextResponse.json({ settings: await rpc("autoresearch_settings", { p_student: student.subjectId, p_enabled: p.enabled, p_calls: p.modelCalls, p_games: p.hostedGames, p_expires: p.expiresAt, p_interests: p.interests }) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Research update failed" }, { status: 400 }); }
}

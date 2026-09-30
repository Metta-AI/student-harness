import { NextResponse } from "next/server";
import { currentSession } from "../../../../lib/session";
import { getCoachingAnalysis, getCoachingSession } from "../../../../lib/softmax";

export async function GET(_request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const { sessionId } = await context.params;
  if (!/^csn_[0-9a-f-]{36}$/.test(sessionId)) return NextResponse.json({ error: "Invalid session" }, { status: 400 });
  const detail = await getCoachingSession(session.token, sessionId);
  if (detail.user_id !== session.subjectId) return NextResponse.json({ error: "This coaching session is not yours" }, { status: 403 });
  const analysis = detail.latest_analysis?.status === "complete"
    ? await getCoachingAnalysis(session.token, sessionId, detail.latest_analysis.id) : null;
  return NextResponse.json({ session: detail, analysis: analysis?.result ?? null });
}

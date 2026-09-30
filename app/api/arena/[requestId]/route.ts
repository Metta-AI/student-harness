import { NextResponse } from "next/server";
import { currentSession } from "../../../../lib/session";
import { getExperience } from "../../../../lib/softmax";

export async function GET(_request: Request, context: { params: Promise<{ requestId: string }> }) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const { requestId } = await context.params;
  if (!/^xreq_[0-9a-f-]{36}$/.test(requestId)) return NextResponse.json({ error: "Invalid run ID" }, { status: 400 });
  const experience = await getExperience(session.token, requestId);
  if (experience.requester_user_id !== session.subjectId) {
    return NextResponse.json({ error: "This run is not yours" }, { status: 403 });
  }
  return NextResponse.json({
    ...experience,
    episodes: experience.episodes.slice(-20),
  });
}

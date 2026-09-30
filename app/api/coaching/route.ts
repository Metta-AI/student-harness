import { NextResponse } from "next/server";
import { currentSession } from "../../../lib/session";
import { listCoachingSessions, SoftmaxError } from "../../../lib/softmax";

export async function GET() {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const sessions = await listCoachingSessions(session.token).catch((error: unknown) => {
    if (error instanceof SoftmaxError && error.status === 404) return null;
    throw error;
  });
  return NextResponse.json({ available: sessions !== null, sessions: sessions ?? [] });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { upsertStudent } from "../../../lib/db";
import { identifyServer, trackServer } from "../../../lib/analytics-server";
import { events } from "../../../lib/analytics-events";
import { cookieName, currentSession, sameOrigin, setSessionCookie } from "../../../lib/session";
import { resolveStudentPlayer } from "../../../lib/player";
import { SoftmaxError, whoami } from "../../../lib/softmax";

export async function GET() {
  const session = await currentSession();
  return NextResponse.json(session ? { email: session.email, subjectId: session.subjectId } : { email: null });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const { token } = z.object({ token: z.string().min(1).max(4096) }).parse(await request.json());
  const identity = await whoami(token).catch((error: unknown) => {
    if (error instanceof SoftmaxError && (error.status === 401 || error.status === 403)) return null;
    throw error;
  });
  if (!identity) return NextResponse.json({ error: "That Softmax token is invalid or expired" }, { status: 401 });
  if (identity.subject_type !== "user") {
    return NextResponse.json({ error: "Use a Softmax user token" }, { status: 403 });
  }
  // The coach's tools run in a durable session with no request cookie, so the token is kept
  // sealed in the student's row and looked up by subject ID.
  await upsertStudent({ subjectId: identity.subject_id, email: identity.user_email, token });
  // Record which Softmax player this student's uploads are credited to, so the workspace can show it.
  await resolveStudentPlayer(identity.subject_id, token, { refresh: true }).catch(() => null);
  await identifyServer(identity.subject_id, { email: identity.user_email, name: identity.name ?? undefined });
  await trackServer(identity.subject_id, events.signedIn, { source: "server" });
  return setSessionCookie({ email: identity.user_email, subjectId: identity.subject_id }, {
    token,
    subjectId: identity.subject_id,
    email: identity.user_email,
  });
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const response = NextResponse.json({ email: null });
  response.cookies.delete(cookieName);
  return response;
}

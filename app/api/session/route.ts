import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSession, sameOrigin, setSessionCookie } from "../../../lib/session";
import { SoftmaxError, whoami } from "../../../lib/softmax";

export async function GET() {
  const session = await currentSession();
  return NextResponse.json(session ? { email: session.email } : { email: null });
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
  return setSessionCookie({ email: identity.user_email }, {
    token,
    subjectId: identity.subject_id,
    email: identity.user_email,
  });
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const response = NextResponse.json({ email: null });
  response.cookies.delete("student_session");
  return response;
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { setStudentReasoningEffort, studentReasoningEffort } from "../../../lib/db";
import { reasoningEfforts } from "../../../lib/reasoning";
import { currentSession, sameOrigin } from "../../../lib/session";
import { trackServer } from "../../../lib/analytics-server";
import { events } from "../../../lib/analytics-events";

/** The student's chat preferences. Today that is how much the agent reasons before acting. */
export async function GET() {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  return NextResponse.json({ reasoningEffort: await studentReasoningEffort(session.subjectId) });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const body = z.object({ reasoningEffort: z.enum(reasoningEfforts) }).parse(await request.json());
  await setStudentReasoningEffort(session.subjectId, body.reasoningEffort);
  await trackServer(session.subjectId, events.reasoningEffortChanged, { effort: body.reasoningEffort }, { reasoning_effort: body.reasoningEffort });
  return NextResponse.json({ reasoningEffort: body.reasoningEffort });
}

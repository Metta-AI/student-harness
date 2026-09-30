import { NextResponse } from "next/server";
import { z } from "zod";
import { policyVersionBySoftmaxId } from "../../../lib/db";
import { currentSession, sameOrigin } from "../../../lib/session";
import { submitPolicy } from "../../../lib/softmax";
import { trackServer } from "../../../lib/analytics-server";
import { events } from "../../../lib/analytics-events";

/** Student-initiated league entry for one of their uploaded revisions. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const { policyVersionId } = z.object({ policyVersionId: z.string().min(1) }).parse(await request.json());
  const version = await policyVersionBySoftmaxId(session.subjectId, policyVersionId);
  if (!version) return NextResponse.json({ error: "Upload a saved revision before entering the league" }, { status: 404 });
  const submission = await submitPolicy(session.token, policyVersionId);
  await trackServer(session.subjectId, events.leagueEntered, { source: "ui", revision: version.revision_number, status: submission.status }, { league_entered: true });
  return NextResponse.json(submission);
}

import { NextResponse } from "next/server";
import { getRun } from "workflow/api";
import { currentSession, sameOrigin } from "../../../lib/session";
import { submitPolicy } from "../../../lib/softmax";
import type { buildPolicy } from "../../../workflows/build-policy";

type BuildResult = Awaited<ReturnType<typeof buildPolicy>>;

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const session = await currentSession();
  if (!session?.runId) return NextResponse.json({ error: "Build a policy first" }, { status: 401 });
  const run = getRun<BuildResult>(session.runId);
  if ((await run.status) !== "completed") {
    return NextResponse.json({ error: "Wait for the hosted request to start" }, { status: 409 });
  }
  const { policyVersionId } = await run.returnValue;
  return NextResponse.json(await submitPolicy(session.token, policyVersionId));
}

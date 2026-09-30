import { NextResponse } from "next/server";
import { getRun } from "workflow/api";
import { currentSession } from "../../../lib/session";
import { importPolicy } from "../../../lib/semantic-ir";
import type { buildPolicy } from "../../../workflows/build-policy";

type BuildResult = Awaited<ReturnType<typeof buildPolicy>>;

export async function GET() {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  if (!session.runId) return NextResponse.json({ status: "idle" });
  const run = getRun<BuildResult>(session.runId);
  const status = await run.status;
  if (status === "completed") {
    const result = await run.returnValue;
    return NextResponse.json({ status, result: { ...result, revision: result.revision ?? importPolicy(result.source, false) } });
  }
  return NextResponse.json({ status });
}

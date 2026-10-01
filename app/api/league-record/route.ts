import { NextResponse } from "next/server";
import { z } from "zod";
import { policyVersionBySoftmaxId } from "../../../lib/db";
import { leagueRecord } from "../../../lib/league-record";
import { currentSession } from "../../../lib/session";

/** Wins, losses, and time-limit games for one of the student's uploaded versions over the last 72 hours. */
export async function GET(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const { policyVersionId } = z.object({ policyVersionId: z.string().regex(/^[0-9a-f-]{36}$/) })
    .parse(Object.fromEntries(new URL(request.url).searchParams));
  if (!(await policyVersionBySoftmaxId(session.subjectId, policyVersionId))) return NextResponse.json({ error: "That policy version is not one of your uploads" }, { status: 404 });
  return NextResponse.json({ policyVersionId, ...(await leagueRecord(session.token, policyVersionId)) });
}

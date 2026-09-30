import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSession } from "../../../lib/session";
import { getPlayerSnapshot } from "../../../lib/player-snapshot";

export async function GET(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const policyId = z.uuid().parse(new URL(request.url).searchParams.get("policyId"));
  return NextResponse.json({ snapshot: await getPlayerSnapshot(policyId) });
}

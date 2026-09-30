import { NextResponse } from "next/server";
import { currentSession } from "../../../lib/session";
import { getCompetitionDivision, getPolicyLeaderboard } from "../../../lib/softmax";

export async function GET() {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const division = await getCompetitionDivision(session.token);
  const policies = await getPolicyLeaderboard(session.token, division.id);
  return NextResponse.json({ division: division.name, windowHours: 72, policies: policies ?? [] });
}

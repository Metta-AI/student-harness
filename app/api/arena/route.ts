import { NextResponse } from "next/server";
import { currentSession } from "../../../lib/session";
import { getLeague, listExperiences } from "../../../lib/softmax";

export async function GET() {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const [league, experiences] = await Promise.all([
    getLeague(session.token), listExperiences(session.token),
  ]);
  return NextResponse.json({ league, experiences });
}

import { NextResponse } from "next/server";
import { currentSession } from "../../../lib/session";
import { getCompetitionDivision, getPolicyLeaderboard, listLeagueSubmissions } from "../../../lib/softmax";

export async function GET() {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const [division, submissions] = await Promise.all([getCompetitionDivision(session.token), listLeagueSubmissions(session.token)]);
  const policies = await getPolicyLeaderboard(session.token, division.id);
  // A leaderboard row needs games in the window; a submission is what says a version is entered at all.
  const entered = [...new Set(submissions.filter((submission) => !["rejected", "withdrawn"].includes(submission.status)).map((submission) => submission.policy_version?.id).filter((id): id is string => !!id))];
  return NextResponse.json({ division: division.name, windowHours: 72, policies: policies ?? [], entered });
}

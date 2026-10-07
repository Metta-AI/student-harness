import { NextResponse } from "next/server";
import { currentSession } from "../../../lib/session";
import { getLeagueStandings, getCompetitionDivision, getPolicyLeaderboard, listLeagueSubmissions, listLeagueMemberships } from "../../../lib/softmax";

import { leaguePolicyEntries } from "../../../lib/league-policy-selection";

export async function GET() {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const signal=AbortSignal.timeout(20000);
  try {
    const [division,submissions,memberships]=await Promise.all([getCompetitionDivision(session.token,signal),listLeagueSubmissions(session.token,signal),listLeagueMemberships(session.token,signal)]);
    const [policies,standings]=await Promise.all([getPolicyLeaderboard(session.token,division.id,signal),getLeagueStandings(session.token,division.id,signal)]);
    const {entries,entered,currentPolicyId,champions}=leaguePolicyEntries(submissions,memberships,division.id);
    const liveStandings=standings.map(row=>{const current=champions.find(m=>m.player?.id===row.player_id);return {...row,policy_label:current?.policy_version.label??row.policy_label};});
    return NextResponse.json({division:division.name,windowHours:72,policies:policies??[],standings:liveStandings,checkedAt:new Date().toISOString(),entries,entered,currentPolicyId},{headers:{'Cache-Control':'no-store'}});
  }catch{return NextResponse.json({error:'Live league entries could not refresh. Try again.'},{status:503});}
}

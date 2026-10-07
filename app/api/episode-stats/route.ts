import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSession } from "../../../lib/session";
import { leaguePolicyAccess } from "../../../lib/league-policy-access";
import { getEpisodeRequest, getEpisodeStats, getExperience } from "../../../lib/softmax";

export async function GET(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const { runId, policyVersionId, episodeId } = z.object({
    runId: z.string().regex(/^xreq_[0-9a-f-]{36}$/).optional(),
    policyVersionId: z.string().regex(/^[0-9a-f-]{36}$/).optional(),
    episodeId: z.string().regex(/^ereq_[0-9a-f-]{36}$/),
  }).parse(Object.fromEntries(new URL(request.url).searchParams));
  if (!runId) {
    // League-round episode: allowed when one of the student's uploaded versions played in it.
    if (!policyVersionId || !(await leaguePolicyAccess(session.subjectId, session.token, policyVersionId))) return NextResponse.json({ error: "This policy is not in your Softmax league workspace" }, { status: 403 });
    const leagueEpisode = await getEpisodeRequest(session.token, episodeId);
    if (!leagueEpisode.round_id || !leagueEpisode.policy_version_ids.includes(policyVersionId)) return NextResponse.json({ error: "Your policy did not play in this league episode" }, { status: 403 });
    if (leagueEpisode.status !== "completed") return NextResponse.json({ error: "Episode is still running" }, { status: 409 });
    return NextResponse.json(await getEpisodeStats(session.token, episodeId));
  }
  const run = await getExperience(session.token, runId);
  if (run.requester_user_id !== session.subjectId) return NextResponse.json({ error: "This run is not yours" }, { status: 403 });
  const episode = run.episodes.find((item) => item.id === episodeId);
  if (!episode) return NextResponse.json({ error: "Episode not found in this run" }, { status: 404 });
  if (episode.status !== "completed") return NextResponse.json({ error: "Episode is still running" }, { status: 409 });
  return NextResponse.json(await getEpisodeStats(session.token, episodeId));
}

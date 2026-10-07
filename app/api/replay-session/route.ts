import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSession, sameOrigin } from "../../../lib/session";
import { leaguePolicyAccess } from "../../../lib/league-policy-access";
import { createReplaySession, getEpisodeRequest, getExperience, replaySessionReady } from "../../../lib/softmax";

// A hosted practice game is addressed by the student's own run. A league-round episode has no run, so
// it is addressed by the student's policy version that played in it.
const requestSchema = z.union([
  z.object({ runId: z.string().regex(/^xreq_[0-9a-f-]{36}$/), episodeId: z.string().regex(/^ereq_[0-9a-f-]{36}$/) }),
  z.object({ policyVersionId: z.string().regex(/^[0-9a-f-]{36}$/), episodeId: z.string().regex(/^ereq_[0-9a-f-]{36}$/) }),
]);

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const input = requestSchema.parse(await request.json());
  if ("policyVersionId" in input) {
    if (!(await leaguePolicyAccess(session.subjectId, session.token, input.policyVersionId))) return NextResponse.json({ error: "This policy is not in your Softmax league workspace" }, { status: 403 });
    const episode = await getEpisodeRequest(session.token, input.episodeId);
    if (!episode.round_id || !episode.policy_version_ids.includes(input.policyVersionId)) return NextResponse.json({ error: "Your policy did not play in this league episode" }, { status: 403 });
    if (!episode.replay_url || !episode.coworld_id) return NextResponse.json({ error: "Replay unavailable" }, { status: 404 });
    return NextResponse.json({ ...await createReplaySession(session.token, episode.coworld_id, episode.replay_url), episode_id: episode.episode_id });
  }
  const { runId, episodeId } = input;
  const run = await getExperience(session.token, runId);
  if (run.requester_user_id !== session.subjectId) {
    return NextResponse.json({ error: "This run is not yours" }, { status: 403 });
  }
  const episode = run.episodes.find((item) => item.id === episodeId);
  if (!episode?.replay_url) return NextResponse.json({ error: "Replay unavailable" }, { status: 404 });
  return NextResponse.json(await createReplaySession(session.token, run.coworld_id, episode.replay_url));
}

export async function GET(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const viewerUrl = new URL(request.url).searchParams.get("viewerUrl");
  if (!viewerUrl) return NextResponse.json({ error: "Missing viewer URL" }, { status: 400 });
  return NextResponse.json(await replaySessionReady(session.token, viewerUrl));
}

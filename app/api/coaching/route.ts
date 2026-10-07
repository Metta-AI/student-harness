import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSession, sameOrigin } from "../../../lib/session";
import { createCoachingSession, getEpisodeRequest, getEpisodeResults, getExperience, listCoachingSessions, SoftmaxError } from "../../../lib/softmax";
import { leaguePolicyAccess } from "../../../lib/league-policy-access";

export async function GET() {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const sessions = await listCoachingSessions(session.token).catch((error: unknown) => {
    if (error instanceof SoftmaxError && error.status === 404) return null;
    throw error;
  });
  return NextResponse.json({ available: sessions !== null, sessions: sessions ?? [] });
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const input = z.object({
    runId: z.string().regex(/^xreq_[0-9a-f-]{36}$/).optional(),
    policyVersionId: z.uuid().optional(),
    slot: z.number().int().nonnegative().optional(),
    episodeId: z.string().regex(/^ereq_[0-9a-f-]{36}$/),
    idempotencyKey: z.uuid(),
    context: z.string().max(10000),
  }).refine(input => !!input.runId || !!input.policyVersionId, 'A run or league policy is required').safeParse(await request.json());
  if (!input.success) return NextResponse.json({error: 'Invalid coaching episode reference'}, {status: 400});
  const reference = input.data;
  if (!reference.runId) {
    if (!(await leaguePolicyAccess(session.subjectId, session.token, reference.policyVersionId!))) return NextResponse.json({error: 'This policy is not in your Softmax league workspace'}, {status: 403});
    const episode = await getEpisodeRequest(session.token, reference.episodeId);
    if (!episode.round_id || !episode.policy_version_ids.includes(reference.policyVersionId!)) return NextResponse.json({error: 'Your policy did not play in this league episode'}, {status: 403});
    if (episode.status !== 'completed' || !episode.episode_id || !episode.coworld_id || !episode.replay_url) return NextResponse.json({error: 'This episode has no completed replay'}, {status: 404});
    const result = (await getEpisodeResults(session.token, [reference.episodeId])).find(item => item.id === reference.episodeId);
    const seats = result?.participants?.filter(seat => seat.policy_version_id === reference.policyVersionId) ?? [];
    const seat = reference.slot === undefined ? seats[0] : seats.find(seat => seat.position === reference.slot);
    if (!seat) return NextResponse.json({error: 'The coached policy’s seat could not be verified in this replay'}, {status: 409});
    return NextResponse.json(await createCoachingSession(session.token, {
      idempotency_key: reference.idempotencyKey, episode_id: episode.episode_id,
      coworld_id: episode.coworld_id, replay_uri: episode.replay_url,
      declared_context: reference.context, policy_version_id: reference.policyVersionId, slot: seat.position,
    }));
  }
  const run = await getExperience(session.token, reference.runId);
  if (run.requester_user_id !== session.subjectId) return NextResponse.json({ error: "This run is not yours" }, { status: 403 });
  const episode = run.episodes.find((item) => item.id === reference.episodeId);
  if (!episode?.replay_url || !episode.episode_id || episode.status !== "completed") {
    return NextResponse.json({ error: "This episode has no completed replay" }, { status: 404 });
  }
  return NextResponse.json(await createCoachingSession(session.token, {
    idempotency_key: reference.idempotencyKey,
    episode_id: episode.episode_id,
    coworld_id: run.coworld_id,
    replay_uri: episode.replay_url,
    declared_context: reference.context,
  }));
}

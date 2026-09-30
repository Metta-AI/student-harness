import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSession, sameOrigin } from "../../../lib/session";
import { createCoachingSession, getExperience, listCoachingSessions, SoftmaxError } from "../../../lib/softmax";

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
    runId: z.string().regex(/^xreq_[0-9a-f-]{36}$/),
    episodeId: z.string().regex(/^ereq_[0-9a-f-]{36}$/),
    idempotencyKey: z.uuid(),
    context: z.string().max(10000),
  }).parse(await request.json());
  const run = await getExperience(session.token, input.runId);
  if (run.requester_user_id !== session.subjectId) return NextResponse.json({ error: "This run is not yours" }, { status: 403 });
  const episode = run.episodes.find((item) => item.id === input.episodeId);
  if (!episode?.replay_url || !episode.episode_id || episode.status !== "completed") {
    return NextResponse.json({ error: "This episode has no completed replay" }, { status: 404 });
  }
  return NextResponse.json(await createCoachingSession(session.token, {
    idempotency_key: input.idempotencyKey,
    episode_id: episode.episode_id,
    coworld_id: run.coworld_id,
    replay_uri: episode.replay_url,
    declared_context: input.context,
  }));
}

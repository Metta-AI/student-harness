import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSession, sameOrigin } from "../../../lib/session";
import { createReplaySession, getExperience, replaySessionReady } from "../../../lib/softmax";

const requestSchema = z.object({
  runId: z.string().regex(/^xreq_[0-9a-f-]{36}$/),
  episodeId: z.string().regex(/^ereq_[0-9a-f-]{36}$/),
});

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const { runId, episodeId } = requestSchema.parse(await request.json());
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

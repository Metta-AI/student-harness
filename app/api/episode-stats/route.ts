import { NextResponse } from "next/server";
import { z } from "zod";
import { currentSession } from "../../../lib/session";
import { getEpisodeStats, getExperience } from "../../../lib/softmax";

export async function GET(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const { runId, episodeId } = z.object({
    runId: z.string().regex(/^xreq_[0-9a-f-]{36}$/),
    episodeId: z.string().regex(/^ereq_[0-9a-f-]{36}$/),
  }).parse(Object.fromEntries(new URL(request.url).searchParams));
  const run = await getExperience(session.token, runId);
  if (run.requester_user_id !== session.subjectId) return NextResponse.json({ error: "This run is not yours" }, { status: 403 });
  const episode = run.episodes.find((item) => item.id === episodeId);
  if (!episode) return NextResponse.json({ error: "Episode not found in this run" }, { status: 404 });
  if (episode.status !== "completed") return NextResponse.json({ error: "Episode is still running" }, { status: 409 });
  return NextResponse.json(await getEpisodeStats(session.token, episodeId));
}

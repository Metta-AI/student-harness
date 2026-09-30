import { NextResponse } from "next/server";
import { currentSession } from "../../../lib/session";
import { getExperience, getLeague, listExperiences } from "../../../lib/softmax";

export async function GET() {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const [league, experiences] = await Promise.all([
    getLeague(session.token), listExperiences(session.token),
  ]);
  const details = await Promise.all(experiences.map((experience) => getExperience(session.token, experience.id)));
  const episodes = details.flatMap((experience) => experience.episodes.map((episode) => ({
    ...episode,
    run_id: experience.id,
    run_title: experience.title,
    coworld_id: experience.coworld_id,
  })));
  episodes.sort((a, b) => new Date(b.completed_at ?? b.created_at).getTime() - new Date(a.completed_at ?? a.created_at).getTime());
  return NextResponse.json({ league, episodes });
}

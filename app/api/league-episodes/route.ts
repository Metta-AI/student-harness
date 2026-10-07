import { NextResponse } from "next/server";
import { z } from "zod";
import { leaguePolicyAccess } from "../../../lib/league-policy-access";
import { summarizeLeagueEpisode } from "../../../lib/league-episodes";
import { currentSession } from "../../../lib/session";
import { getEpisodeResults, leagueRoundNumbers, listPolicyVersionEpisodeRequests } from "../../../lib/softmax";

/**
 * League-round episodes one of the student's uploaded policy versions played in, newest first.
 * Hosted practice games are not round episodes and are served by /api/arena instead.
 */
export async function GET(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const { policyVersionId, cursor } = z.object({
    policyVersionId: z.string().regex(/^[0-9a-f-]{36}$/),
    cursor: z.string().min(1).optional(),
  }).parse(Object.fromEntries(new URL(request.url).searchParams));
  const version = await leaguePolicyAccess(session.subjectId, session.token, policyVersionId);
  if (!version) return NextResponse.json({ error: "That policy version is not one of your uploads" }, { status: 404 });
  const page = await listPolicyVersionEpisodeRequests(session.token, policyVersionId, cursor);
  const inRound = page.entries.filter((entry) => entry.round_id);
  const rounds = await leagueRoundNumbers(session.token, [...new Set(inRound.map((entry) => entry.round_id!))]);
  const league = inRound.filter((entry) => rounds.has(entry.round_id!));
  const results = new Map((await getEpisodeResults(session.token, league.map((entry) => entry.id))).map((result) => [result.id, result]));
  return NextResponse.json({
    policyVersionId,
    revision: version.revision,
    nextCursor: page.next_cursor,
    episodes: league.map((entry) => {
      const result = results.get(entry.id);
      return {
        id: entry.id, status: entry.status, created_at: entry.created_at, replay_url: entry.replay_url,
        error: result?.error ?? null,
        round: { id: entry.round_id!, number: rounds.get(entry.round_id!)! },
        ...summarizeLeagueEpisode(policyVersionId, result?.participants ?? [], result?.participant_scores ?? [], entry.status === "completed"),
      };
    }),
  });
}

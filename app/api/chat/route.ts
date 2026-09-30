import { ToolLoopAgent } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { NextResponse } from "next/server";
import { start, getRun } from "workflow/api";
import { z } from "zod";
import { currentSession, sameOrigin, seal, setSessionCookie } from "../../../lib/session";
import { getEpisodeStats, getExperience } from "../../../lib/softmax";
import { buildPolicy } from "../../../workflows/build-policy";

const messagesSchema = z.array(z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().max(4000),
})).min(1).max(20);

type BuildResult = Awaited<ReturnType<typeof buildPolicy>>;

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const { messages } = z.object({ messages: messagesSchema }).parse(await request.json());
  const latest = messages.at(-1);
  if (latest?.role !== "user") return NextResponse.json({ error: "Expected a student message" }, { status: 400 });

  const analysis = /^Analyze episode (ereq_[0-9a-f-]{36}) from run (xreq_[0-9a-f-]{36})\./.exec(latest.text);
  if (analysis) {
    const experience = await getExperience(session.token, analysis[2]);
    if (experience.requester_user_id !== session.subjectId) {
      return NextResponse.json({ error: "This run is not yours" }, { status: 403 });
    }
    const episode = experience.episodes.find((item) => item.id === analysis[1]);
    if (!episode) return NextResponse.json({ error: "Episode not found in this run" }, { status: 404 });
    if (episode.status !== "completed") {
      return NextResponse.json({ message: `This episode is ${episode.status}. Open the run again when it finishes to analyze recorded results.` });
    }
    const stats = await getEpisodeStats(session.token, episode.id);
    const agent = new ToolLoopAgent({
      model: anthropic("claude-sonnet-5-5"),
      instructions: `You are a Gods of the Arena policy coach. Analyze the recorded episode for a college student.
Use only the supplied episode results and the student's notes. Do not invent game events, available BASIC functions, or claim to have watched the replay.
In at most 120 words, summarize the outcome and give 2 concrete, testable policy recommendations. Distinguish evidence from hypotheses.
If the run contains multiple policies and ownership is unclear, say so and make recommendations conditional.
End with one short suggested prompt the student can send to improve their BASIC policy. Do not claim a policy change was already made.`,
    });
    const result = await agent.generate({
      prompt: `${latest.text}\n\nRecorded episode results:\n${JSON.stringify({
        status: episode.status,
        participant_scores: episode.participant_scores,
        steps: stats.steps,
        game_stats: stats.game_stats,
        policy_stats: stats.policy_stats,
      })}`,
    });
    return NextResponse.json({ message: result.text });
  }

  if (/\b(build|create|make|edit|improve|update|write)\b/i.test(latest.text)) {
    let previousSource: string | undefined;
    if (session.runId) {
      const previous = getRun<BuildResult>(session.runId);
      const status = await previous.status;
      if (status === "running" || status === "pending") {
        return NextResponse.json({ message: "Your previous policy job is still running. I’ll use its result for the next change." });
      }
      if (status === "completed") previousSource = (await previous.returnValue).source;
    }
    const run = await start(buildPolicy, [seal(session), latest.text, previousSource]);
    return setSessionCookie({
      message: "I’m editing your policy, then I’ll upload it and request one hosted game. You can close this tab; progress will be here when you return.",
      runId: run.runId,
    }, { ...session, runId: run.runId });
  }

  const agent = new ToolLoopAgent({
    model: anthropic("claude-sonnet-5-5"),
    instructions: `You are a concise Gods of the Arena policy coach for a college workshop.
The policy is one BASIC file. The student can ask you to build or improve it; that starts a hosted job.
Explain game strategy using https://softmax.com/gods-of-the-arena/wiki/policy-and-host-surface.
Never claim a policy has been tested or submitted unless the web app shows a completed job.
Keep answers to two or three short sentences.`,
  });
  const result = await agent.generate({
    messages: messages.map(({ role, text }) => ({ role, content: text })),
  });
  return NextResponse.json({ message: result.text });
}

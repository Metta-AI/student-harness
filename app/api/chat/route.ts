import { ToolLoopAgent } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { NextResponse } from "next/server";
import { start, getRun } from "workflow/api";
import { z } from "zod";
import { currentSession, sameOrigin, seal, setSessionCookie } from "../../../lib/session";
import { getCoachingAnalysis, getCoachingSession, getEpisodeStats, getExperience } from "../../../lib/softmax";
import league from "../../../league.json";
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

  const coachingId = messages.map(({ text }) => /\[coaching-session:(csn_[0-9a-f-]{36})\]/.exec(text)?.[1]).find(Boolean);
  let coachingContext = "";
  if (coachingId) {
    const coaching = await getCoachingSession(session.token, coachingId);
    if (coaching.user_id !== session.subjectId || coaching.coworld_name !== league.name) {
      return NextResponse.json({ error: "This coaching session is not yours" }, { status: 403 });
    }
    const analysis = coaching.latest_analysis;
    if (!analysis || analysis.status !== "complete") {
      return NextResponse.json({ message: "Your replay coaching is still being analyzed. Open the session again after it finishes." });
    }
    const result = (await getCoachingAnalysis(session.token, coaching.id, analysis.id)).result;
    if (!result) return NextResponse.json({ error: "Coaching analysis has no result" }, { status: 502 });
    coachingContext = JSON.stringify({
      summary: result.summary,
      coached_policy_version_id: coaching.policy_reference.policy_version_id,
      moments: result.moments.slice(0, 12).map(({ start_ms, observation, coaching_intent, uncertainty, evidence_ids }) =>
        ({ at_seconds: Math.round(start_ms / 1000), observation, coaching_intent, uncertainty, evidence_ids })),
      proposals: result.ir_proposals.slice(0, 10),
      questions: result.questions.slice(0, 5),
    });
  }
  const replay = messages.map(({ text }) => /\[replay-note:(ereq_[0-9a-f-]{36}):(xreq_[0-9a-f-]{36})\]/.exec(text)).find(Boolean);
  let replayContext = "";
  if (replay) {
    const experience = await getExperience(session.token, replay[2]);
    if (experience.requester_user_id !== session.subjectId) {
      return NextResponse.json({ error: "This run is not yours" }, { status: 403 });
    }
    const episode = experience.episodes.find((item) => item.id === replay[1]);
    if (!episode) return NextResponse.json({ error: "Episode not found in this run" }, { status: 404 });
    if (episode.status !== "completed") return NextResponse.json({ message: "This replay is still being recorded. Come back when the hosted game finishes." });
    const stats = await getEpisodeStats(session.token, episode.id);
    const note = messages.find(({ text }) => text.includes(replay[0]))?.text.replace(/\n\n\[replay-note:[^\]]+\]$/, "");
    replayContext = JSON.stringify({
      student_observation: note,
      steps: stats.steps,
      game_stats: stats.game_stats,
      participant_scores: episode.participant_scores,
      policy_stats: stats.policy_stats.slice(0, 10),
    });
  }

  if (/^(please\s+)?(build|create|make|edit|improve|update|write)\b|^can you\s+(build|create|make|edit|improve|update|write)\b/i.test(latest.text.trim())) {
    let previousSource: string | undefined;
    if (session.runId) {
      const previous = getRun<BuildResult>(session.runId);
      const status = await previous.status;
      if (status === "running" || status === "pending") {
        return NextResponse.json({ message: "Your previous policy job is still running. I’ll use its result for the next change." });
      }
      if (status === "completed") previousSource = (await previous.returnValue).source;
    }
    const task = `${latest.text}${coachingContext ? `\n\nReplay coaching evidence and proposed changes (not yet applied): ${coachingContext}` : ""}${replayContext ? `\n\nStudent's replay observation and episode results: ${replayContext}` : ""}`;
    const run = await start(buildPolicy, [seal(session), task, previousSource]);
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
${coachingContext ? `The student has already watched and coached a replay. Here is their saved coaching analysis: ${coachingContext}
Talk through what they noticed. Begin with one specific observed moment or proposal and one natural question. Use recording seconds when useful. Do not dump the full report. Separate observations from hypotheses. Do not claim you watched the replay yourself.` : ""}
${replayContext ? `The student watched a replay and wrote an observation. Here is that note with the episode results: ${replayContext}
Start from what the student noticed, ask one natural follow-up, and use results only when relevant. Do not claim you watched the replay or know what caused an outcome from scores alone.` : ""}
Keep answers to two or three short sentences unless the student requests detail.`,
  });
  const result = await agent.generate({
    messages: messages.map(({ role, text }) => ({ role, content: text.replace(/\n\n\[(?:coaching-session:csn_[0-9a-f-]{36}|replay-note:ereq_[0-9a-f-]{36}:xreq_[0-9a-f-]{36})\]$/, "") })),
  });
  return NextResponse.json({ message: result.text });
}

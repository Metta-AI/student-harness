import { defineTool } from "eve/tools";
import { z } from "zod";
import { trackServer } from "../../lib/analytics-server";
import { events } from "../../lib/analytics-events";
import league from "../../league.json";
import { getCoachingAnalysis, getCoachingSession, getEpisodeStats, getExperience, listCoachingSessions } from "../../lib/softmax";
import { requireStudentToken } from "../lib/student";

export default defineTool({
  description: "Read the student's own replay coaching: without an ID, list their coaching sessions; with a coaching session ID, return its analysis (summary, timestamped moments, proposed changes, open questions). With a hosted episode reference instead, return that episode's statistics for a replay observation the student wrote.",
  inputSchema: z.object({
    coaching_session_id: z.string().regex(/^csn_[0-9a-f-]{36}$/).optional(),
    episode: z.object({ xp_request_id: z.string().regex(/^xreq_[0-9a-f-]{36}$/), episode_id: z.string().regex(/^ereq_[0-9a-f-]{36}$/) }).optional(),
  }),
  label: { start: ({ coaching_session_id, episode }) => coaching_session_id ? "Read coaching analysis" : episode ? "Read episode statistics" : "List coaching sessions" },
  async execute({ coaching_session_id, episode }, ctx) {
    const student = await requireStudentToken(ctx);
    await trackServer(student.subjectId, events.coachingFeedbackRead, { mode: coaching_session_id ? "session" : episode ? "episode" : "list" });
    if (episode) {
      const experience = await getExperience(student.token, episode.xp_request_id);
      if (experience.requester_user_id !== student.subjectId) throw new Error("This run is not the student's.");
      const item = experience.episodes.find((candidate) => candidate.id === episode.episode_id);
      if (!item) throw new Error("Episode not found in this run.");
      if (item.status !== "completed") return { status: item.status, note: "This replay is still being recorded." };
      const stats = await getEpisodeStats(student.token, item.id);
      return { episode_id: item.id, steps: stats.steps, game_stats: stats.game_stats, participant_scores: item.participant_scores, seats: stats.policy_stats.slice(0, 10) };
    }
    if (!coaching_session_id) {
      const sessions = await listCoachingSessions(student.token);
      return { sessions: sessions.map((session) => ({ id: session.id, episode_id: session.episode_id, status: session.status, created_at: session.created_at, analysis: session.latest_analysis?.status ?? null, summary: session.feed?.summary ?? null })) };
    }
    const coaching = await getCoachingSession(student.token, coaching_session_id);
    if (coaching.user_id !== student.subjectId || coaching.coworld_name !== league.name) throw new Error("This coaching session is not the student's.");
    const analysis = coaching.latest_analysis;
    if (!analysis || analysis.status !== "complete") return { status: analysis?.status ?? "none", note: "The coaching analysis has not finished yet." };
    const result = (await getCoachingAnalysis(student.token, coaching.id, analysis.id)).result;
    if (!result) throw new Error("Coaching analysis has no result.");
    return {
      coaching_session_id: coaching.id,
      coached_policy_version_id: coaching.policy_reference.policy_version_id,
      summary: result.summary,
      moments: result.moments.slice(0, 12).map(({ start_ms, observation, coaching_intent, uncertainty, evidence_ids }) => ({ at_seconds: Math.round(start_ms / 1000), observation, coaching_intent, uncertainty, evidence_ids })),
      proposals: result.ir_proposals.slice(0, 10),
      questions: result.questions.slice(0, 5),
      caveat: "These are the student's observations and an automated analysis, not verified causes.",
    };
  },
});

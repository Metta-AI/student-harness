import { defineTool } from "eve/tools";
import { z } from "zod";
import { experimentByXp, listExperiments, updateExperiment, type EpisodeSummary } from "../../lib/db";
import { getEpisodeStats, getExperience } from "../../lib/softmax";
import { requireStudentToken } from "../lib/student";
import { writeExperiment } from "../lib/workspace";

export default defineTool({
  description: "Fetch the status and results of a hosted game the student requested: per-episode scores for this policy, every seat's score, game statistics, and per-seat average reward. Persists the results to the workspace. Defaults to the most recent game.",
  inputSchema: z.object({ xp_request_id: z.string().regex(/^xreq_[0-9a-f-]{36}$/).optional() }),
  label: { start: ({ xp_request_id }) => `Check hosted game ${xp_request_id ?? "(latest)"}` },
  async execute({ xp_request_id }, ctx) {
    const student = await requireStudentToken(ctx);
    const experiment = xp_request_id ? await experimentByXp(student.subjectId, xp_request_id) : (await listExperiments(student.subjectId))[0] ?? null;
    if (!experiment) throw new Error(xp_request_id ? "That hosted game was not requested from this workspace." : "No hosted games yet. Use request_hosted_game.");
    const experience = await getExperience(student.token, experiment.xp_request_id);
    if (experience.requester_user_id !== student.subjectId) throw new Error("This run is not the student's.");
    const episodes: EpisodeSummary[] = experience.episodes.map((episode) => ({
      id: episode.id, status: episode.status, job_index: episode.job_index, replay_url: episode.replay_url,
      our_scores: episode.scores.map((score) => score.score),
      participant_scores: episode.participant_scores, completed_at: episode.completed_at, error: episode.error,
    }));
    const completed = experience.episodes.filter((episode) => episode.status === "completed");
    const stats = await Promise.all(completed.map(async (episode) => ({ episode_id: episode.id, ...(await getEpisodeStats(student.token, episode.id)) })));
    const scores = episodes.flatMap((episode) => episode.our_scores);
    const summary = {
      games_completed: completed.length, games_failed: experience.failed_count,
      mean_policy_score: scores.length ? scores.reduce((total, score) => total + score, 0) / scores.length : null,
      episode_stats: stats.map(({ episode_id, steps, game_stats, policy_stats }) => ({
        episode_id, steps, game_stats,
        seats: policy_stats.map((seat) => ({ position: seat.position, avg_reward: seat.avg_reward, ...seat.avg_metrics })),
      })),
    };
    const done = experience.status === "completed" || experience.status === "failed";
    await updateExperiment(experiment.xp_request_id, { status: experience.status, episodes, summary, completed_at: done ? experience.completed_at ?? new Date().toISOString() : null });
    const refreshed = await experimentByXp(student.subjectId, experiment.xp_request_id);
    if (refreshed) await writeExperiment(await ctx.getSandbox(), refreshed);
    return {
      xp_request_id: experiment.xp_request_id, title: experiment.title, hypothesis: experiment.hypothesis, status: experience.status,
      counts: { pending: experience.pending_count, running: experience.running_count, completed: experience.completed_count, failed: experience.failed_count },
      episodes: episodes.map((episode) => ({ id: episode.id, status: episode.status, our_scores: episode.our_scores, participant_scores: episode.participant_scores, replay: episode.replay_url ? `https://softmax.com/observatory/v2/episode-requests/${episode.id}/watch` : null, error: episode.error })),
      summary,
      caveat: "These are hosted self-play scores where every seat runs this same policy. They are not league results.",
    };
  },
});

import { defineTool } from "eve/tools";
import { z } from "zod";
import { trackServer } from "../../lib/analytics-server";
import { events } from "../../lib/analytics-events";
import { experimentByXp, insertExperiment, listExperiments, policyVersionBySoftmaxId } from "../../lib/db";
import { getExperience, listExperiences } from "../../lib/softmax";
import { reconcileGame, retryCanceledBaseline } from "../../lib/reconcile-games";
import { requireStudentToken } from "../lib/student";
import { writeExperiment } from "../lib/workspace";

export default defineTool({
  description: "Fetch the status and results of any hosted game the student requested (from this workspace, the coworld CLI, or Observatory): per-episode scores for this policy, every seat's score, game statistics, and per-seat average reward. Persists the results to the workspace. Defaults to the student's most recent game.",
  inputSchema: z.object({ xp_request_id: z.string().regex(/^xreq_[0-9a-f-]{36}$/).optional() }),
  label: { start: ({ xp_request_id }) => `Check hosted game ${xp_request_id ?? "(latest)"}` },
  async execute({ xp_request_id }, ctx) {
    const student = await requireStudentToken(ctx);
    let experiment = xp_request_id ? await experimentByXp(student.subjectId, xp_request_id) : (await listExperiments(student.subjectId))[0] ?? null;
    let requestId = experiment?.xp_request_id ?? xp_request_id;
    if (!requestId) {
      // Nothing recorded here yet: fall back to the student's most recent run in this league on Softmax.
      const remote = (await listExperiences(student.token)).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      if (!remote) throw new Error("No hosted games yet. Use request_hosted_game.");
      requestId = remote.id;
    }
    const experience = await getExperience(student.token, requestId);
    if (experience.requester_user_id !== student.subjectId) throw new Error("This run belongs to another account.");
    if (!experiment) {
      // Requested outside this workspace (CLI, Observatory, an earlier harness): record it so history stays complete.
      const playedIds = [...new Set(experience.episodes.flatMap((episode) => episode.scores.map((score) => score.policy_version_id)))];
      const versions = await Promise.all(playedIds.map((id) => policyVersionBySoftmaxId(student.subjectId, id)));
      const matched = versions.find((version) => version !== null) ?? null;
      experiment = await insertExperiment({ studentId: student.subjectId, policyVersionRowId: matched?.id ?? null, xpRequestId: experience.id, title: experience.title ?? "Hosted game", status: experience.status });
    }
    const { episodes, summary } = await reconcileGame(experiment, student.token);
    const refreshed = await experimentByXp(student.subjectId, experiment.xp_request_id);
    if (refreshed) await writeExperiment(await ctx.getSandbox(), refreshed);
    if (refreshed) await retryCanceledBaseline(student.subjectId, student.token, refreshed);
    await trackServer(student.subjectId, events.hostedGameChecked, { xp_request_id: experiment.xp_request_id, status: experience.status, games_completed: summary.games_completed, games_failed: experience.failed_count, mean_policy_score: summary.mean_policy_score });
    return {
      xp_request_id: experiment.xp_request_id, title: experiment.title, hypothesis: experiment.hypothesis, status: experience.status,
      counts: { pending: experience.pending_count, running: experience.running_count, completed: experience.completed_count, failed: experience.failed_count },
      episodes: episodes.map((episode) => ({ id: episode.id, status: episode.status, our_scores: episode.our_scores, participant_scores: episode.participant_scores, replay: episode.replay_url ? `https://softmax.com/observatory/v2/episode-requests/${episode.id}/watch` : null, error: episode.error })),
      summary,
      caveat: "These are hosted self-play scores where every seat runs this same policy. They are not league results.",
    };
  },
});

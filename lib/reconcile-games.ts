import { experimentByXp, insertExperiment, listExperiments, listOpenExperiments, listPolicyVersions, updateExperiment, type ExperimentRow, type EpisodeSummary } from "./db";
import { trackServer } from "./analytics-server";
import { events } from "./analytics-events";
import { getEpisodeStats, getExperience, hostedGameRequestKey, requestEpisode } from "./softmax";

const terminal = new Set(["completed", "failed", "canceled", "cancelled"]);

export async function reconcileGame(experiment: ExperimentRow, token: string) {
  const experience = await getExperience(token, experiment.xp_request_id);
  if (experience.requester_user_id !== experiment.student_id) throw new Error("Hosted game owner changed");
  const episodes: EpisodeSummary[] = experience.episodes.map((episode) => ({
    id: episode.id, status: episode.status, job_index: episode.job_index, replay_url: episode.replay_url,
    our_scores: episode.scores.map((score) => score.score), participant_scores: episode.participant_scores,
    completed_at: episode.completed_at, error: episode.error,
  }));
  const completed = experience.episodes.filter((episode) => episode.status === "completed");
  const stats = await Promise.all(completed.map(async (episode) => ({ episode_id: episode.id, ...(await getEpisodeStats(token, episode.id)) })));
  const scores = episodes.flatMap((episode) => episode.our_scores);
  const deaths = stats.flatMap((stat) => stat.policy_stats.map((seat) => seat.avg_metrics.deaths).filter((value): value is number => typeof value === "number"));
  const summary = {
    games_completed: completed.length, games_failed: experience.failed_count,
    mean_policy_score: scores.length ? scores.reduce((total, score) => total + score, 0) / scores.length : null,
    mean_deaths_per_seat: deaths.length ? deaths.reduce((total, count) => total + count, 0) / deaths.length : null,
    episode_stats: stats.map(({ episode_id, steps, game_stats, policy_stats }) => ({
      episode_id, steps, game_stats,
      seats: policy_stats.map((seat) => ({ position: seat.position, avg_reward: seat.avg_reward, ...seat.avg_metrics })),
    })),
  };
  await updateExperiment(experiment.xp_request_id, {
    status: experience.status, episodes, summary,
    completed_at: terminal.has(experience.status) ? experience.completed_at ?? new Date().toISOString() : null,
  });
  if (terminal.has(experience.status) && !terminal.has(experiment.status)) {
    await trackServer(experiment.student_id, events.hostedGameCompleted, {
      xp_request_id: experiment.xp_request_id, status: experience.status,
      games_completed: completed.length, mean_policy_score: summary.mean_policy_score,
      mean_deaths_per_seat: summary.mean_deaths_per_seat, linked_revision: !!experiment.policy_version_id,
    });
  }
  return { experience, episodes, summary };
}

/** One idempotent retry for a canceled starter game. Never recurse on a canceled retry. */
export async function retryCanceledBaseline(studentId: string, token: string, experiment: ExperimentRow) {
  if (!new Set(["canceled", "cancelled"]).has(experiment.status) || experiment.title.startsWith("Baseline retry")) return null;
  const versions = await listPolicyVersions(studentId);
  const baseline = versions.find((version) => version.id === experiment.policy_version_id && version.revision_number === 1);
  if (!baseline?.softmax_policy_version_id) return null;
  const games = await listExperiments(studentId, baseline.id);
  if (games.some((game) => game.title.startsWith("Baseline retry") || (game.xp_request_id !== experiment.xp_request_id && game.status === "completed"))) return null;
  const title = "Baseline retry: starter policy";
  const experience = await requestEpisode(token, baseline.softmax_policy_version_id, title, hostedGameRequestKey(baseline.softmax_policy_version_id, "baseline-retry"));
  const row = await insertExperiment({ studentId, policyVersionRowId: baseline.id, xpRequestId: experience.id, title, status: experience.status });
  await trackServer(studentId, events.hostedGameRequested, { revision: 1, source: "automatic_retry", xp_request_id: row.xp_request_id });
  return row;
}

export async function reconcileStudentGames(studentId: string, token: string) {
  const games = await listExperiments(studentId);
  const recentWithoutReplay = (item: ExperimentRow) => item.status === "completed" && item.episodes.some((episode) => episode.status === "completed" && !episode.replay_url) && Date.now() - new Date(item.completed_at ?? item.created_at).getTime() < 30 * 60 * 1000;
  for (const game of games.filter((item) => !terminal.has(item.status) || recentWithoutReplay(item)).slice(0, 20)) {
    const { experience } = await reconcileGame(game, token);
    if (experience.status === "canceled" || experience.status === "cancelled") {
      const updated = await experimentByXp(studentId, game.xp_request_id);
      if (updated) await retryCanceledBaseline(studentId, token, updated);
    }
  }
  for (const game of games.filter((item) => (item.status === "canceled" || item.status === "cancelled") && item.title.startsWith("Baseline:")).slice(0, 20)) {
    await retryCanceledBaseline(studentId, token, game);
  }
}

export { listOpenExperiments };

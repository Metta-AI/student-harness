type ScoredEpisode = {
  scores: { policy_version_id: string; score: number }[];
  participant_scores: { position: number; score: number }[];
};

export function episodeScore(episode: ScoredEpisode) {
  const scores = episode.scores.length ? episode.scores.map((item) => item.score) : episode.participant_scores.map((item) => item.score);
  return scores.length ? scores.reduce((total, value) => total + value, 0) / scores.length : null;
}

export function policyScore(episode: ScoredEpisode, policyId: string) {
  return episode.scores.find((item) => item.policy_version_id === policyId)?.score ?? null;
}

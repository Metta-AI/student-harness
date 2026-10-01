import { defineTool } from "eve/tools";
import { z } from "zod";
import { listExperiments, listPolicyVersions } from "../../lib/db";
import { requireStudent } from "../lib/student";

export default defineTool({
  description: "List the student's saved policy revisions with summaries, upload status, and hosted game outcomes so far. Use it to compare revisions or recall what has already been tried.",
  inputSchema: z.object({}),
  label: { start: () => "List saved revisions" },
  async execute(_input, ctx) {
    const student = requireStudent(ctx);
    const [versions, experiments] = await Promise.all([listPolicyVersions(student.subjectId), listExperiments(student.subjectId)]);
    return {
      revisions: versions.map((version) => {
        const games = experiments.filter((experiment) => experiment.policy_version_id === version.id);
        const scores = games.flatMap((game) => game.episodes.flatMap((episode) => episode.our_scores));
        const completed = games.filter((game) => game.status === "completed");
        const deaths = completed.map((game) => (game.summary as { mean_deaths_per_seat?: number | null } | null)?.mean_deaths_per_seat).filter((value): value is number => typeof value === "number");
        return {
          revision: version.revision_number, summary: version.summary, created_at: version.created_at, evidence: version.evidence,
          uploaded_as: version.softmax_policy_label, policy_version_id: version.softmax_policy_version_id,
          hosted_games: games.map((game) => ({ xp_request_id: game.xp_request_id, title: game.title, status: game.status, hypothesis: game.hypothesis })),
          hosted_mean_score: scores.length ? scores.reduce((total, score) => total + score, 0) / scores.length : null,
          hosted_scored_seats: scores.length,
          hosted_completed_games: completed.length,
          hosted_mean_deaths_per_seat: deaths.length ? deaths.reduce((total, value) => total + value, 0) / deaths.length : null,
          hosted_death_samples: deaths.length,
        };
      }),
      note: versions.length ? undefined : "No saved revisions yet; the working copy is the official starter policy.",
    };
  },
});

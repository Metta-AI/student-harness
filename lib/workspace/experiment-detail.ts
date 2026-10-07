import type { ExperimentRow, PolicyVersionRow } from "../db";
import type { SemanticIR } from "../semantic-ir";

/** Only this run's recorded episode scores; no league or other revision aggregates. */
export function experimentDetail(run: ExperimentRow, version: PolicyVersionRow | null) {
  const scores = run.episodes.flatMap(e => e.status === "completed" ? e.our_scores : []).filter(Number.isFinite);
  const ir = version?.ir as SemanticIR | undefined;
  return {
    id: run.xp_request_id, title: run.title, hypothesis: run.hypothesis, status: run.status,
    createdAt: run.created_at, completedAt: run.completed_at, episodes: run.episodes, summary: run.summary,
    counts: { total: run.episodes.length, completed: run.episodes.filter(e => e.status === "completed").length,
      failed: run.episodes.filter(e => e.status === "failed").length, scoredSeats: scores.length },
    meanScore: scores.length ? scores.reduce((a,b) => a+b,0)/scores.length : null,
    policy: version ? { revision: version.revision_number, summary: version.summary, label: version.softmax_policy_label,
      revisionId: version.revision_id, parent: version.parent_revision_id, researchPlan: ir?.update?.research_plan ?? null,
      evidence: version.evidence, receipts: version.receipts } : null,
    loadedAt: new Date().toISOString(),
  };
}
export type ExperimentDetail = ReturnType<typeof experimentDetail>;

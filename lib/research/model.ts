import { z } from "zod";

export const evidenceRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("revision"), id: z.uuid() }),
  z.object({ kind: z.literal("experiment"), id: z.string().min(1).max(200) }),
  z.object({ kind: z.literal("claim"), id: z.string().min(1).max(200) }),
  z.object({ kind: z.literal("moment"), id: z.uuid() }),
]);
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;
export const cycleInputSchema = z.object({
  question: z.string().trim().min(8).max(1000), criteria: z.string().trim().min(8).max(2000),
  baselineId: z.uuid(), requestKey: z.string().min(8).max(160),
});
export const noteInputSchema = z.object({
  cycleId: z.uuid(), requestKey: z.string().min(8).max(160),
  kind: z.enum(["observation", "position", "lesson", "instruction", "commitment", "vocabulary", "repair", "salience", "question", "review"]),
  text: z.string().trim().min(3).max(3000), evidence: z.array(evidenceRefSchema).max(20).default([]),
  supersedes: z.uuid().optional(), expiresAt: z.iso.datetime().optional(),
  finding: z.enum(["untested", "supported", "contradicted", "inconclusive"]).default("untested"),
});
export type ResearchEvent = {
  id: string; sequence: number; student_id: string; cycle_id: string | null;
  actor: "human" | "preston" | "system"; kind: string; payload: Record<string, unknown>;
  evidence: EvidenceRef[]; supersedes: string | null; created_at: string;
};
export type ResearchCycle = {
  id: string; student_id: string; question: string; criteria: string;
  baseline_id: string; active_version_id: string; state: "draft" | "active" | "paused" | "closed";
  created_at: string; updated_at: string;
};
/** Current memory is a projection; previous statements remain inspectable. */
export function currentMemory(events: ResearchEvent[], now = Date.now()) {
  const replaced = new Set(events.flatMap(e => e.supersedes ? [e.supersedes] : []));
  return events.filter(e => !replaced.has(e.id) && ["position", "lesson", "instruction", "commitment", "vocabulary", "repair", "salience", "question"].includes(e.kind))
    .filter(e => !e.payload.expiresAt || Date.parse(String(e.payload.expiresAt)) > now)
    .map(e => ({ id: e.id, actor: e.actor, kind: e.kind, ...e.payload, evidence: e.evidence }));
}

export const grantSchema = z.object({ cycleId: z.uuid(), requestKey: z.string().min(8).max(160),
  modelCalls: z.number().int().min(6).max(2000), hostedGames: z.number().int().min(1).max(20),
  expiresAt: z.iso.datetime(), autonomy: z.boolean(), costReviewUsd: z.number().positive().max(100) });
export const planSchema = z.object({ mode: z.enum(["candidate", "baseline"]).default("candidate"), cycleId: z.uuid(), requestKey: z.string().min(8).max(160),
  objective: z.string().trim().min(12).max(2000), criteria: z.string().trim().min(12).max(2000),
  rationale: z.string().trim().min(12).max(2000), evidence: z.array(evidenceRefSchema).min(1).max(20),
  maxCalls: z.number().int().min(6).max(100).default(24), priority: z.number().int().min(0).max(100).default(0) });
export type ResearchPlan = { id: string; cycle_id: string; objective: string; criteria: string; rationale: string; evidence: EvidenceRef[];
  priority: number; max_calls: number; status: string; task_id: string | null };
export type FundedCycle = ResearchCycle & { call_limit: number; game_limit: number; calls_allocated: number; games_allocated: number;
  expires_at: string | null; autonomy: boolean; cost_review_usd: number };
export const evaluationSchema = z.object({ cycleId: z.uuid(), candidateId: z.uuid(), baselineXp: z.string().min(1).max(200), candidateXp: z.string().min(1).max(200),
  finding: z.enum(["supported", "contradicted", "inconclusive"]), explanation: z.string().trim().min(12).max(3000), requestKey: z.string().min(8).max(160) });
export type ResearchEvaluation = { id: string; cycle_id: string; baseline_id: string; candidate_id: string; finding: string; explanation: string; baseline_xp: string; candidate_xp: string; actor?: "human" | "preston" };

import { z } from "zod";
import { evidenceRefSchema } from "./model";

const experiment = {
  objective: z.string().min(12).max(2000), criteria: z.string().min(12).max(2000), rationale: z.string().min(12).max(2000),
  evidence: z.array(evidenceRefSchema).min(1).max(20), mode: z.enum(["candidate", "baseline"]),
  maxCalls: z.number().int().min(6).max(40), priority: z.number().int().min(0).max(100),
};
export const researchDecisionSchema = z.object({
  actions: z.array(z.discriminatedUnion("action", [
    z.object({ action: z.literal("investigate"), question: z.string().min(8).max(1000), ...experiment }),
    z.object({ action: z.literal("experiment"), cycleId: z.uuid(), ...experiment }),
    z.object({ action: z.literal("evaluate"), cycleId: z.uuid(), candidateId: z.uuid(), baselineXp: z.string().min(1), candidateXp: z.string().min(1), finding: z.enum(["supported", "contradicted", "inconclusive"]), explanation: z.string().min(12).max(3000), selectCandidate: z.boolean() }),
    z.object({ action: z.literal("rollback"), cycleId: z.uuid(), versionId: z.uuid(), reason: z.string().min(8).max(2000) }),
    z.object({ action: z.literal("conclude"), cycleId: z.uuid(), reason: z.string().min(8).max(2000) }),
    z.object({ action: z.literal("idle"), reason: z.string().min(8).max(2000) }),
  ])).min(1).max(4),
  briefing: z.string().max(2000), category: z.enum(["progress", "discovery", "disagreement", "blocked"]),
  evidence: z.array(evidenceRefSchema).max(20),
});
export type ResearchDecision = z.infer<typeof researchDecisionSchema>;
export type ResearchSettings = { student_id: string; enabled: boolean; call_limit: number; game_limit: number; calls_allocated: number; games_allocated: number; expires_at: string; interests: string; active_version_id: string | null };
export type ResearchWake = { id: string; student_id: string; reason: string; token: string; status: string; lease_until: string; attempts: number; result: ResearchDecision | null };
export const settingsSchema = z.object({ enabled: z.boolean(), modelCalls: z.number().int().min(0).max(2000), hostedGames: z.number().int().min(0).max(100), expiresAt: z.iso.datetime(), interests: z.string().max(2000) });

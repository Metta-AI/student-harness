import { z } from "zod";

export const stanceSchema = z.enum(["open", "agree", "disagree"]);
export const evidenceSchema = z.object({
  kind: z.enum(["observation", "experiment", "revision"]),
  ref: z.string().max(200).default(""),
  detail: z.string().trim().min(1).max(1500),
});
export const claimInputSchema = z.object({
  kind: z.enum(["hypothesis", "lesson"]),
  statement: z.string().trim().min(8).max(600),
  situation: z.string().trim().min(5).max(800),
  action: z.string().trim().min(5).max(800),
  expected: z.string().trim().min(5).max(800),
  falsifier: z.string().trim().min(5).max(800),
  evidence: z.array(evidenceSchema).max(20).default([]),
});
export type ClaimInput = z.infer<typeof claimInputSchema>;
export type Actor = "human" | "present";
export type Stance = z.infer<typeof stanceSchema>;
export type Claim = ClaimInput & {
  id: string; version: number; author: Actor; createdAt: string;
  positions: Record<Actor, Stance>;
  history: { actor: Actor; stance: Stance; note: string; at: string }[];
  revision: number | null;
};
export const responseSchema = z.object({
  id: z.string().min(1).max(200), version: z.number().int().nonnegative(),
  stance: stanceSchema, note: z.string().trim().min(5).max(1500),
  evidence: evidenceSchema.optional(),
});
export type ClaimResponse = z.infer<typeof responseSchema>;

export function agreement(claim: Claim): "disputed" | "shared" | "open" {
  if (Object.values(claim.positions).includes("disagree")) return "disputed";
  return claim.positions.human === "agree" && claim.positions.present === "agree" ? "shared" : "open";
}
export function respond(claim: Claim, input: ClaimResponse, actor: Actor, at = new Date().toISOString()): Claim {
  if (claim.version !== input.version) throw new Error("This claim changed. Refresh it before responding.");
  if (claim.history.length >= 200) throw new Error("Start a new claim to continue this investigation.");
  if (input.evidence && claim.evidence.length >= 20) throw new Error("This claim already has 20 evidence references. Start a new claim.");
  return { ...claim, version: claim.version + 1,
    positions: { ...claim.positions, [actor]: input.stance },
    evidence: input.evidence ? [...claim.evidence, input.evidence] : claim.evidence,
    history: [...claim.history, { actor, stance: input.stance, note: input.note, at }],
  };
}
/** Agreement permits reuse; it does not establish empirical truth. */
export function partnerContext(claims: Claim[]) {
  return claims.filter(c => c.kind === "lesson" || agreement(c) === "disputed").map(c => ({
    id: c.id, kind: c.kind, statement: c.statement, situation: c.situation, action: c.action,
    expected: c.expected, falsifier: c.falsifier, positions: c.positions,
    useAsWorkingAgreement: c.kind === "lesson" && agreement(c) === "shared",
    evidence: c.evidence, latestResponses: c.history.slice(-2),
  }));
}

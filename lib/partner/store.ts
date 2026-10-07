import { randomUUID } from "node:crypto";
import { db } from "../db";
import { semanticIrSchema } from "../semantic-ir";
import { claimInputSchema, responseSchema, respond, type Actor, type Claim, type ClaimInput, type ClaimResponse } from "./model";

/** Existing revision hypotheses are projections, never silently rewritten into historical IR. */
export async function readPartner(studentId: string) {
  const [versions, saved] = await Promise.all([
    db().from("policy_versions").select("revision_id,revision_number,summary,ir,evidence,created_at").eq("student_id", studentId).order("created_at", { ascending: false }).limit(200),
    db().from("partner_claims").select("document").eq("student_id", studentId).order("updated_at", { ascending: false }),
  ]);
  if (versions.error) throw new Error("Could not load policy hypotheses.");
  const available = !saved.error;
  if (saved.error && saved.error.code !== "PGRST205" && saved.error.code !== "42P01") throw new Error("Could not load shared work. Please retry.");
  const claims = (saved.data ?? []).map(r => r.document as Claim);
  const known = new Set(claims.map(c => c.id));
  for (const v of versions.data) {
    const id = `revision:${v.revision_id}`;
    if (known.has(id) || /^Baseline:/i.test(v.summary)) continue;
    const ir = semanticIrSchema.parse(v.ir);
    const plan = ir.update.research_plan;
    const rule = ir.strategy.at(-1);
    claims.push({ id, version: 0, author: "present", kind: "hypothesis", statement: plan.hypothesis,
      situation: rule ? ir.situation.predicates[rule.when] : "Review this revision in its recorded game conditions.",
      action: rule?.intent ?? v.summary, expected: plan.expected,
      falsifier: "Check whether the expected behavior occurs in the stated situation. Record contrary observations; a single match does not establish performance.",
      evidence: [{ kind: "revision", ref: String(v.revision_number), detail: v.summary },
        ...(v.evidence as string[]).map(ref => ({ kind: "observation" as const, ref: "", detail: `Original evidence reference (inspect before relying on it): ${ref}` }))],
      revision: v.revision_number, createdAt: v.created_at,
      positions: { human: "open", present: "open" }, history: [],
    });
  }
  return { available, claims: claims.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
}
async function validateEvidence(studentId: string, evidence: ClaimInput["evidence"]) {
  for (const e of evidence) {
    if (e.kind === "observation") continue;
    const table = e.kind === "revision" ? "policy_versions" : "experiments";
    const field = e.kind === "revision" ? "revision_number" : "xp_request_id";
    if (e.kind === "revision" && !/^[1-9]\d*$/.test(e.ref)) throw new Error("Choose a saved revision.");
    const r = await db().from(table).select("id").eq("student_id", studentId).eq(field, e.ref).maybeSingle();
    if (r.error || !r.data) throw new Error("Evidence must belong to your GoTA workspace.");
  }
}
export async function createClaim(studentId: string, raw: ClaimInput, actor: Actor) {
  const input = claimInputSchema.parse(raw);
  await validateEvidence(studentId, input.evidence);
  const at = new Date().toISOString();
  const claim: Claim = { ...input, id: randomUUID(), version: 1, author: actor, createdAt: at, revision: null,
    positions: { human: "open", present: "open" }, history: [],
  };
  const r = await db().from("partner_claims").insert({ student_id: studentId, id: claim.id, version: 1, document: claim });
  if (r.error) throw new Error("Could not save shared work. Check that the partner migration is installed.");
  return claim;
}
export async function respondToClaim(studentId: string, raw: ClaimResponse, actor: Actor) {
  const input = responseSchema.parse(raw);
  const state = await readPartner(studentId);
  if (!state.available) throw new Error("Shared work is read-only until the partner migration is installed.");
  const claim = state.claims.find(c => c.id === input.id);
  if (!claim) throw new Error("Claim not found in your workspace.");
  if (input.evidence) await validateEvidence(studentId, [input.evidence]);
  const next = respond(claim, input, actor);
  const values = { document: next, version: next.version, updated_at: new Date().toISOString() };
  // Compare-and-swap prevents an overlapping conversation or tab from erasing either position.
  const r = claim.version === 0
    ? await db().from("partner_claims").insert({ ...values, student_id: studentId, id: claim.id }).select("id")
    : await db().from("partner_claims").update(values).eq("student_id", studentId).eq("id", claim.id).eq("version", input.version).select("id");
  if (r.error || !r.data?.length) throw new Error("This claim changed or could not be saved. Refresh it before responding.");
  return next;
}

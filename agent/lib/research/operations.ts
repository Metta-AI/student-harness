import type { WorkflowStepToolContext } from "eve/tools";
import { researchIdentity } from "./identity";
import { db, latestPolicyVersion } from "../../../lib/db";
import { readResearch } from "../../../lib/research/store";
import { readPartner } from "../../../lib/partner/store";
import { partnerContext } from "../../../lib/partner/model";
import { readAutonomy, researchDecisionSchema, type ResearchDecision, type ResearchWake } from "../../../lib/research/autonomy";
import { rpc } from "../../../lib/tasks/store";

export async function researchContext(ctx: WorkflowStepToolContext, wakeId: string) {
  const identity = researchIdentity(ctx.session.auth);
  if (!identity || identity.wakeId !== wakeId) throw new Error("Only the research dispatcher may run this investigation");
  const { data, error } = await db().from("research_wakes").select("*").eq("id", wakeId).eq("student_id", identity.studentId).single();
  if (error) throw new Error(error.message);
  const wake = data as ResearchWake;
  if (wake.status === "completed") return { identity, prior: wake.result, context: null };
  if (wake.status !== "running" || wake.token !== identity.token || Date.parse(wake.lease_until) <= Date.now()) throw new Error("Research dispatch expired");
  const [autonomy, research, partner, latest, draft] = await Promise.all([
    readAutonomy(identity.studentId), readResearch(identity.studentId), readPartner(identity.studentId), latestPolicyVersion(identity.studentId),
    db().from("workspace_files").select("path").eq("student_id", identity.studentId).eq("path", "draft/hero.bas").maybeSingle(),
  ]);
  if (draft.error) throw new Error(draft.error.message);
  if (!autonomy.settings?.enabled || Date.parse(autonomy.settings.expires_at) <= Date.now()) throw new Error("Research paused or expired");
  const currentId = autonomy.settings.active_version_id ?? latest?.id;
  const current = currentId ? await db().from("policy_versions").select("id,revision_number,source,summary").eq("id", currentId).eq("student_id", identity.studentId).single() : null;
  if (current?.error) throw new Error(current.error.message);
  return { identity, prior: null, context: { reason: wake.reason, settings: autonomy.settings, research,
    shared: partnerContext(partner.claims), currentPolicy: current?.data ?? null, hasHumanDraft: !!draft.data } };
}
export async function applyResearchDecision(ctx: WorkflowStepToolContext, wakeId: string, input: ResearchDecision) {
  const identity = researchIdentity(ctx.session.auth);
  if (!identity || identity.wakeId !== wakeId) throw new Error("Research identity mismatch");
  return rpc("autoresearch_apply", { p_student: identity.studentId, p_wake: wakeId, p_token: identity.token, p_decision: researchDecisionSchema.parse(input) });
}

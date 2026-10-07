import { db } from "../db";
import { rpc } from "../tasks/store";
import { cycleInputSchema, noteInputSchema, currentMemory, type FundedCycle, type ResearchEvent } from "./model";

export async function readResearch(studentId: string) {
  const cycles = await db().from("research_cycles").select("*").eq("student_id", studentId).order("created_at", { ascending: false });
  if (cycles.error) {
    if (["42P01", "PGRST205"].includes(cycles.error.code)) return { available: false, cycles: [], events: [], memory: [], versions: [] };
    throw new Error("Research cycles could not be loaded");
  }
  const [events, versions, memory, plans, usage, evaluations, experiments, partnership] = await Promise.all([
    db().from("research_events").select("*").eq("student_id", studentId).order("sequence", { ascending: false }).limit(1000),
    db().from("policy_versions").select("id,revision_number,summary,revision_id").eq("student_id", studentId).order("revision_number", { ascending: false }),
    db().from("research_memory").select("*").eq("student_id", studentId).order("sequence"),
    db().from("research_plans").select("*").eq("student_id", studentId).order("priority", { ascending: false }).order("created_at"),
    db().from("agent_tasks").select("id,cycle_id,reported_cost_usd,cost_reports,model_calls,status,checkpoint,result,reason,objective,base_version_id").eq("student_id", studentId).not("cycle_id", "is", null),
    db().from("research_evaluations").select("*").eq("student_id", studentId).order("created_at", { ascending: false }),
    db().from("experiments").select("xp_request_id,policy_version_id,title,status,summary").eq("student_id", studentId).order("created_at", { ascending: false }).limit(200),
    db().from("preston_partnerships").select("id,current_model,created_at").eq("student_id", studentId).maybeSingle(),
  ]);
  if (events.error || versions.error || memory.error || plans.error || usage.error || evaluations.error || experiments.error || partnership.error) throw new Error("Research evidence could not be loaded");
  const record = (events.data as ResearchEvent[]).reverse();
  return { available: true, cycles: cycles.data as FundedCycle[], events: record, memory: currentMemory(memory.data as ResearchEvent[]), versions: versions.data, plans: plans.data, usage: usage.data, evaluations: evaluations.data, experiments: experiments.data, partnership: partnership.data,
    historyTruncated: record.length === 1000 };
}
export async function createCycle(studentId: string, input: unknown) {
  const p = cycleInputSchema.parse(input);
  const result = await rpc<FundedCycle | FundedCycle[]>("research_create_cycle", { p_student: studentId, p_key: p.requestKey, p_question: p.question, p_criteria: p.criteria, p_baseline: p.baselineId });
  return Array.isArray(result) ? result[0] : result;
}
export async function appendNote(studentId: string, input: unknown, actor: "human" | "preston") {
  const p = noteInputSchema.parse(input);
  return rpc<string>("research_append", { p_student: studentId, p_cycle: p.cycleId, p_key: p.requestKey, p_actor: actor, p_kind: p.kind,
    p_payload: { text: p.text, finding: p.finding, ...(p.expiresAt ? { expiresAt: p.expiresAt } : {}) }, p_evidence: p.evidence, p_supersedes: p.supersedes ?? null });
}

export async function grantAllowance(studentId: string, input: unknown) {
  const { grantSchema } = await import("./model");
  const p = grantSchema.parse(input);
  return rpc("research_grant", { p_student: studentId, p_cycle: p.cycleId, p_key: p.requestKey, p_calls: p.modelCalls,
    p_games: p.hostedGames, p_expires: p.expiresAt, p_autonomy: p.autonomy, p_cost: p.costReviewUsd });
}
export async function proposeExperiment(studentId: string, input: unknown, actor: "human" | "preston") {
  const { planSchema } = await import("./model");
  const p = planSchema.parse(input);
  return rpc<string>("research_propose", { p_student: studentId, p_cycle: p.cycleId, p_key: p.requestKey, p_objective: p.objective,
    p_criteria: p.criteria, p_rationale: p.rationale, p_evidence: p.evidence, p_calls: p.maxCalls, p_priority: p.priority, p_actor: actor, p_mode: p.mode });
}

export async function recordMoment(studentId: string, input: unknown) {
  const { z } = await import("zod");
  const { anchorSchema, validAnchor } = await import("./grounding");
  const p = z.object({ cycleId: z.uuid(), requestKey: z.string().min(8).max(160), text: z.string().trim().min(1).max(3000), anchor: anchorSchema }).parse(input);
  if (!validAnchor(p.anchor)) throw new Error("Replay timing is stale. Pause the replay and mark the moment again.");
  return rpc<string>("research_append", { p_student: studentId, p_cycle: p.cycleId, p_key: p.requestKey, p_actor: "human", p_kind: "moment",
    p_payload: { text: p.text, anchor: p.anchor, provenance: "Browser-reported replay position and human observation; not independently verified behavior" },
    p_evidence: [{ kind: "revision", id: p.anchor.versionId }] });
}

/** Prevent the old one-off experiment tools from bypassing an open cycle's allowance. */
export async function requireStandaloneResearch(studentId: string) {
  const { data, error } = await db().from("research_cycles").select("id").eq("student_id", studentId).neq("state", "closed").limit(1);
  if (error) {
    if (["42P01", "PGRST205"].includes(error.code)) return;
    throw new Error("Could not verify research authority");
  }
  if (data.length) throw new Error("Use the research cycle and its allowance for experiments, or close the cycle before starting standalone work.");
}

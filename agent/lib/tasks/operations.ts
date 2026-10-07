import type { WorkflowStepToolContext } from "eve/tools";
import { z } from "zod";
import { taskIdentity } from "./auth";
import { assertExecution, gameRequestKey, terminalGame, type Task } from "../../../lib/tasks/model";
import { checkpoint, rpc, rpcTask, taskById } from "../../../lib/tasks/store";
import { db, studentToken, markPolicyUploaded, toRevision, type PolicyVersionRow, listExperiments } from "../../../lib/db";
import { readPartner } from "../../../lib/partner/store";
import { partnerContext } from "../../../lib/partner/model";
import { reconcilePolicy, numberCandidate, semanticChangeSchema } from "../../../lib/semantic-ir";
import { getPolicyVersionPlayer, requestEpisode, uploadPolicy } from "../../../lib/softmax";
import { resolveStudentPlayer } from "../../../lib/player";
import { resolvePolicyName } from "../policy-name";
import { isProviderRateLimit, isProviderBillingFailure, isTransientInfrastructureFailure } from '../../../lib/tasks/failure';

export async function beginTask(ctx: WorkflowStepToolContext, id: string) {
  const identity = taskIdentity(ctx.session.auth);
  if (!identity || identity.taskId !== id) throw new Error("Only the task dispatcher may execute this task");
  const claimed = await rpcTask("task_claim", { p_task: id, p_student: identity.studentId, p_generation: identity.generation,
    p_execution: `${ctx.session.id}:${ctx.callId}`, p_session: ctx.session.id });
  return claimed?.id ? claimed : null;
}
async function active(id: string, execution: string) {
  const task = await taskById(id);
  if (!task) throw new Error("Task not found");
  assertExecution(task, execution);
  if (!await rpc<boolean>("autoresearch_guard", { p_task: id }).catch(error => { if (/Could not find the function|does not exist/.test(String(error))) return true; throw error; })) throw new Error("Workspace research allowance paused or expired");
  if (task.cycle_id) {
    const { data: cycle, error } = await db().from("research_cycles").select("state,expires_at").eq("id", task.cycle_id).eq("student_id", task.student_id).single();
    if (error || cycle?.state !== "active" || !cycle.expires_at || Date.parse(cycle.expires_at) <= Date.now()) throw new Error("Cycle authority paused or expired");
  }
  return task;
}
async function version(id: string, studentId: string) {
  const { data, error } = await db().from("policy_versions").select("*").eq("id", id).eq("student_id", studentId).single();
  if (error) throw new Error(error.message);
  return data as PolicyVersionRow;
}
export async function taskContext(id: string, execution: string) {
  let task = await active(id, execution);
  const base = await version(task.base_version_id!, task.student_id);
  let guides = task.checkpoint.guides as { host: string; rules: string } | undefined;
  if (!guides) {
    const read = async (slug: string) => {
      const response = await fetch(`https://softmax.com/gods-of-the-arena/wiki/${slug}.md`, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`Game guide unavailable (${response.status})`);
      const text = await response.text();
      if (text.length < 100 || text.length > 100000 || /<html/i.test(text.slice(0, 500))) throw new Error("Game guide did not return markdown");
      return text;
    };
    const [host, rules] = await Promise.all([read("policy-and-host-surface"), read("overview")]);
    guides = { host, rules };
    task = await checkpoint(task, execution, task.phase, { guides });
  }
  let shared = task.checkpoint.partner_context;
  if (shared === undefined) {
    const partner = await readPartner(task.student_id);
    shared = { available: partner.available, claims: partnerContext(partner.claims) };
    task = await checkpoint(task, execution, task.phase, { partner_context: shared });
  }
  return { research_brief: task.checkpoint.research_brief, shared_understanding: shared,
    objective: task.objective, acceptance_criteria: task.acceptance_criteria, student_note: task.checkpoint.student_note,
    base_revision: base.revision_id, source: base.source, host_guide: guides.host, rules: guides.rules,
    evidence: (await listExperiments(task.student_id, base.id)).slice(0, 5) };
}
export async function workerState(id: string, execution: string, key: string, role: string, output?: unknown, failed = false) {
  return rpc<unknown>("task_worker", { p_task: id, p_execution: execution, p_key: key, p_role: role,
    p_finish: output !== undefined, p_output: output ?? null, p_failed: failed });
}
export async function advance(id: string, execution: string, phase: Task["phase"], patch: Record<string, unknown> = {}, status: Task["status"] = "running", reason: string | null = null, result: unknown = null) {
  return checkpoint(await active(id, execution), execution, phase, patch, status, reason, result);
}
export async function saveProposal(id: string, execution: string) {
  const task = await active(id, execution);
  const proposal = semanticChangeSchema.parse(task.checkpoint.proposal);
  const base = await version(task.base_version_id!, task.student_id);
  let revision = reconcilePolicy(toRevision(base), proposal, [`task:${task.id}`]);
  if (task.cycle_id) {
    const { data: latest, error } = await db().from("policy_versions").select("revision_number").eq("student_id", task.student_id).order("revision_number", { ascending: false }).limit(1).single();
    if (error || !latest) throw new Error("Could not assign a candidate revision number");
    revision = numberCandidate(revision, latest.revision_number + 1);
  }
  if (Buffer.byteLength(revision.source, "utf8") > 65536) throw new Error("Proposed policy exceeds 64 KiB");
  await rpc("task_save_policy", { p_task: id, p_execution: execution, p_revision: revision, p_summary: proposal.summary });
  return (await taskById(id))!;
}
export async function uploadTaskPolicy(id: string, execution: string) {
  const task = await active(id, execution);
  const saved = await version(z.uuid().parse(task.checkpoint.version_id), task.student_id);
  if (!saved.softmax_policy_version_id) {
    const name = await resolvePolicyName(task.student_id, undefined, saved.summary);
    const token = await studentToken(task.student_id);
    const intended = await resolveStudentPlayer(task.student_id, token, { refresh: true });
    const policy = await uploadPolicy(token, task.student_id, saved.source, saved.summary, name.name, intended?.id);
    const player = (await getPolicyVersionPlayer(token, policy.id).catch(() => null)) ?? intended;
    await markPolicyUploaded(saved.id, { policyVersionId: policy.id, label: `${policy.name}:v${policy.version}`, player });
  }
  return checkpoint(await active(id, execution), execution, "request_game", {});
}
export async function requestTaskGame(id: string, execution: string) {
  const task = await active(id, execution);
  const prior = await db().from("experiments").select("*").eq("task_id", id).maybeSingle();
  if (prior.error) throw new Error(prior.error.message);
  let xpId = prior.data?.xp_request_id as string | undefined;
  if (!xpId) {
    const saved = await version(z.uuid().parse(task.checkpoint.version_id), task.student_id);
    if (!saved.softmax_policy_version_id) throw new Error("Task policy has not been uploaded");
    if (!await rpc<boolean>("task_reserve_game", { p_task: id, p_execution: execution })) return (await taskById(id))!;
    const experience = await requestEpisode(await studentToken(task.student_id), saved.softmax_policy_version_id,
      `Task: ${task.objective.slice(0, 43)}`, gameRequestKey(id));
    xpId = experience.id;
    // On retry the provider receives the same operation key. Never reset already recorded results.
    const { error } = await db().from("experiments").upsert({ student_id: task.student_id, policy_version_id: saved.id,
      task_id: id, xp_request_id: xpId, title: `Task: ${task.objective.slice(0, 43)}`,
      hypothesis: task.checkpoint.research_mode === "baseline" ? task.acceptance_criteria : semanticChangeSchema.parse(task.checkpoint.proposal).semantic.hypothesis, status: experience.status,
    }, { onConflict: "xp_request_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  }
  return checkpoint(await active(id, execution), execution, "evaluate", { xp_request_id: xpId }, "waiting", "Waiting for hosted game results");
}
export async function evaluationContext(id: string, execution: string) {
  const task = await active(id, execution);
  const { data: experiment, error } = await db().from("experiments").select("*").eq("task_id", id).eq("student_id", task.student_id).single();
  if (error) throw new Error(error.message);
  if (!terminalGame(experiment.status) || !experiment.summary) return null;
  return { objective: task.objective, acceptance_criteria: task.acceptance_criteria, student_note: task.checkpoint.student_note,
    research_brief: task.checkpoint.research_brief, shared_understanding: task.checkpoint.partner_context,
    experiment_mode: task.checkpoint.research_mode === "baseline" ? "Observe unchanged active policy; no candidate improvement is being tested" : "candidate",
    proposal: task.checkpoint.proposal, base_revision: task.base_version_id, revision: task.checkpoint.version_id, experiment,
    baseline: (await listExperiments(task.student_id, task.base_version_id!)).slice(0, 5) };
}
export async function taskFailure(id: string, execution: string, message: string) {
  if (isProviderRateLimit(message)) {
    await rpc('task_provider_cooldown', { p_task: id, p_execution: execution, p_message: message.slice(0, 1000) });
    return;
  }
  const task = await taskById(id);
  if (!task || task.status !== "running" || task.execution_key !== execution) return;
  if(task.session_id&&isTransientInfrastructureFailure(message)){
    // The workflow has exited its work loop. Infrastructure retries preserve
    // completed work instead of consuming all three research attempts.
    await rpc('task_runtime_failed',{p_session:task.session_id,p_message:message.slice(0,1000),p_attention:false});
    return;
  }
  const conflict = isProviderBillingFailure(message) || /Cycle authority|Policy changed|unsaved policy draft|exactly one source span|64 KiB/.test(message);
  await checkpoint(task, execution, task.phase, {}, conflict ? "needs_input" : task.attempts >= task.max_attempts ? "failed" : "queued", message.slice(0, 1000));
}

export async function routeTask(id:string, execution:string, kind:"research"|"experiment", reason:string) {
  const task=await rpcTask("task_route",{p_task:id,p_execution:execution,p_kind:kind,p_reason:reason});
  if(!task)throw Error("Session routing failed");
  return task;
}

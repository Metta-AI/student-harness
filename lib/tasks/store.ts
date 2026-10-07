import { db, latestPolicyVersion, workspaceFile } from "../db";
import { controlAuditSession } from '../campaigns/audit-vm';
import { campaignForTask, controlCampaign } from '../campaigns/store';
import { taskRow, taskInputSchema, type Task, type TaskEvent, type TaskInput, type TaskWorker } from "./model";

export async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db().rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}
export async function rpcTask(name: string, args: Record<string, unknown>): Promise<Task | null> {
  return taskRow(await rpc<Task | Task[] | null>(name, args));
}
export async function taskById(id: string, studentId?: string): Promise<Task | null> {
  let query = db().from("agent_tasks").select("*").eq("id", id);
  if (studentId) query = query.eq("student_id", studentId);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return data as Task | null;
}
export async function listTasks(studentId: string) {
  const [active, recent, budget, campaigns] = await Promise.all([
    db().from("agent_tasks").select("*").eq("student_id",studentId).not("status","in","(completed,failed,canceled)").order("created_at",{ascending:false}),
    db().from("agent_tasks").select("*").eq("student_id",studentId).in("status",["completed","failed","canceled"]).order("updated_at",{ascending:false}).limit(30),
    db().rpc("research_daily_budget", {p_student:studentId}),
    db().from("research_campaigns").select("id,task_id,objective,state,phase,cycle").eq("student_id",studentId).order("updated_at",{ascending:false}).limit(50),
  ]);
  if(active.error || recent.error) throw new Error((active.error || recent.error)!.message);
  if(campaigns.error)throw new Error(campaigns.error.message);
  const tasks = [...active.data,...recent.data] as Task[];
  const missing=campaigns.data.filter(c=>!tasks.some(t=>t.id===c.task_id)).map(c=>c.task_id);
  if(missing.length){const roots=await db().from("agent_tasks").select("*").eq("student_id",studentId).in("id",missing);if(roots.error)throw new Error(roots.error.message);tasks.push(...roots.data as Task[]);}
  if (budget.error) throw new Error(budget.error.message);
  if (!tasks.length) return { tasks, workers: [] as TaskWorker[], campaigns:campaigns.data, budget:budget.data };
  const workers = await db().from("agent_task_workers").select("*").in("task_id", tasks.map(t => t.id)).order("updated_at");
  if (workers.error) throw new Error(workers.error.message);
  return { tasks, workers: workers.data as TaskWorker[], campaigns:campaigns.data, budget:budget.data };
}
export async function createTask(studentId: string, input: TaskInput, sessionId?: string) {
  const parsed = taskInputSchema.parse(input);
  const existing = await db().from("agent_tasks").select("*").eq("student_id", studentId).eq("request_key", parsed.requestKey).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) return existing.data as Task;
  const { requireStandaloneResearch } = await import("../research/store");
  if(parsed.kind === "experiment") await requireStandaloneResearch(studentId);
  const base = await latestPolicyVersion(studentId);
  if (parsed.kind === "experiment" && !base) throw new Error("Save your starter policy before starting a task.");
  if (parsed.kind === "experiment" && await workspaceFile(studentId, "draft/hero.bas")) throw new Error("Finish or discard your unsaved policy draft before starting a task.");
  const { data, error } = await db().from("agent_tasks").insert({
    student_id: studentId, request_key: parsed.requestKey, objective: parsed.objective,
    acceptance_criteria: parsed.acceptanceCriteria, base_version_id: base?.id ?? null, kind: parsed.kind, context:parsed.context, max_games:parsed.kind === "research" ? 0 : 1,
    origin_session_id: sessionId ?? null, max_model_calls: parsed.maxModelCalls, max_cost_usd: parsed.maxCostUsd,
  }).select("*").single();
  if (error) {
    // A retried POST must return the same task, even when both requests raced.
    if (error.code === "23505") {
      const same = await db().from("agent_tasks").select("*").eq("student_id", studentId).eq("request_key", parsed.requestKey).maybeSingle();
      if (same.data) return same.data as Task;
      throw new Error("Finish or cancel your current task before starting another policy writer.");
    }
    throw new Error(error.message);
  }
  // The dispatcher also discovers queued tasks if this enqueue is interrupted.
  await rpc("task_enqueue", { p_task: data.id, p_key: `created:${data.id}`, p_kind: "task.created" });
  return data as Task;
}
export async function controlTask(studentId: string, id: string, action: string, note = "") {
  const current=await taskById(id,studentId);
  if(current?.context?.mode==='audit'){
    await controlAuditSession(studentId,id,action,note);return taskById(id,studentId);
  }
  const campaign=await campaignForTask(id,studentId);
  if(campaign){
    if(action==='steer'){
      await rpc('campaign_control',{p_id:campaign.id,p_student:studentId,p_action:'steer',p_note:note});
    }else if(action==='pause'||action==='resume'||action==='cancel')await controlCampaign(studentId,campaign.id,action,note);
    return taskById(id,studentId);
  }
  const task = action === "steer" ? await rpcTask("task_steer", {p_task:id,p_student:studentId,p_note:note}) : await rpcTask("task_control", { p_task: id, p_student: studentId, p_action: action, p_note: note });
  if (!task) throw new Error("Task not found");
  return task;
}
export async function checkpoint(task: Task, execution: string, phase: Task["phase"], patch: Record<string, unknown>, status: Task["status"] = "running", reason: string | null = null, result: unknown = null) {
  const updated = await rpcTask("task_checkpoint", { p_task: task.id, p_execution: execution, p_phase: phase,
    p_checkpoint: { ...task.checkpoint, ...patch }, p_status: status, p_reason: reason, p_result: result });
  if (!updated) throw new Error("Task checkpoint was not saved");
  return updated;
}
export async function finishDelivery(event: TaskEvent, error?: string) {
  const { error: failure } = await db().from("agent_task_events").update(error ? {
    lease_until: null, error: error.slice(0, 1000), available_at: new Date(Date.now() + Math.min(300, 2 ** Math.min(event.attempts, 8)) * 1000).toISOString(),
  } : { delivered_at: new Date().toISOString(), lease_until: null, error: null }).eq("id", event.id).eq("delivery_token", event.delivery_token);
  if (failure) throw new Error(failure.message);
}

import { z } from "zod";

export const taskInputSchema = z.object({
  kind: z.enum(["experiment", "research"]).default("experiment"),
  context: z.object({title:z.string().trim().max(120).optional(),leagueId:z.string().regex(/^league_[a-zA-Z0-9-]+$/).optional(),policyId:z.uuid().optional(),episodeId:z.string().max(150).optional(),mode:z.enum(["auto","analyze","model","replay","general","candidate"]).optional(),campaignId:z.uuid().optional(),role:z.string().max(80).optional(),baselineHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),releaseFingerprint:z.string().regex(/^[a-f0-9]{64}$/).optional()}).default({}),
  objective: z.string().trim().min(12).max(6000),
  acceptanceCriteria: z.string().trim().min(12).max(2000),
  requestKey: z.string().min(8).max(160),
  maxModelCalls: z.number().int().min(6).max(100).default(24),
  maxCostUsd: z.number().positive().max(25).default(25),
});
export type TaskInput = z.input<typeof taskInputSchema>;
export type TaskStatus = "queued" | "running" | "waiting" | "paused" | "needs_input" | "completed" | "failed" | "canceled";
export type TaskPhase = "propose" | "select" | "save" | "upload" | "request_game" | "evaluate" | "done";
export type Task = {
  model_selection?: import("../model-selection").ModelSelection;
  kind?: "experiment" | "research";
  context?: {leagueId?:string;title?:string;policyId?:string;episodeId?:string;mode?:string;campaignId?:string;role?:string;baselineHash?:string;releaseFingerprint?:string};
  cycle_id?: string | null; plan_id?: string | null;
  id: string; student_id: string; objective: string; acceptance_criteria: string; base_version_id: string | null;
  status: TaskStatus; phase: TaskPhase; checkpoint: Record<string, unknown>; result: unknown;
  reason: string | null; generation: number; execution_key: string | null; lease_until: string | null;
  session_id: string | null; attempts: number; max_attempts: number;
  model_calls: number; max_model_calls: number; reported_cost_usd: number; cost_reports: number; max_cost_usd: number;
  games_requested: number; max_games: number; deadline_at: string; created_at: string; updated_at: string;
};
export type TaskWorker = { task_id: string; worker_key: string; role: string; status: "running" | "completed" | "failed"; output: unknown; updated_at: string };
export type TaskEvent = { id: string; task_id: string; kind: string; event_key: string; delivery_token: string; attempts: number; payload: Record<string, unknown> };
export const terminalTask = (status: TaskStatus) => ["completed", "failed", "canceled"].includes(status);
export const terminalGame = (status: string) => ["completed", "failed", "canceled", "cancelled"].includes(status);
export function assertExecution(task: Task, execution: string, now = Date.now()) {
  if (task.status !== "running" || task.execution_key !== execution || !task.lease_until || Date.parse(task.lease_until) <= now) throw new Error("Task execution is no longer active");
  if (Date.parse(task.deadline_at) <= now) throw new Error("Task deadline reached");
}
// Preserve the legacy prefix so retries of existing durable tasks reuse their original game.
export function gameRequestKey(taskId: string) { return `neuralhub-task-${taskId}-game-1`; }
export function taskAddress(task: Pick<Task, "id" | "generation" | "phase" | "attempts">) {
  return `${task.id}:${task.generation}:${task.phase}:${task.attempts}`;
}

/** PostgREST represents composite RPC results as a row array; adapters may return a single object. */
export function taskRow(value: Task | Task[] | null): Task | null {
  if (Array.isArray(value) && value.length > 1) throw new Error("Task RPC returned multiple rows");
  const row = Array.isArray(value) ? value[0] : value;
  return row?.id ? row : null;
}

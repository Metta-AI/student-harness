import { dispatchResearch } from "../../lib/research/dispatch";
import { defineSchedule } from "eve/schedules";
import tasks from "../channels/tasks";
import research from "../channels/research";
import type { ResearchWake } from "../../lib/research/autonomy";
import { finishDelivery, rpc, taskById } from "../../lib/tasks/store";
import type { TaskEvent } from "../../lib/tasks/model";
import { db, studentToken, experimentByXp } from "../../lib/db";
import { reconcileGame } from "../../lib/reconcile-games";
import {stopIdleAuditVMs,dispatchAuditSessions} from '../../lib/campaigns/audit-vm';
import { dispatchCampaigns } from "../../lib/campaigns/orchestrator";
import {reconcileTaskRuntimes} from '../../lib/tasks/runtime-recovery';

export default defineSchedule({
  cron: "* * * * *",
  async run({ to, appAuth }) {

    // Missing migration keeps legacy deployments working; other failures remain visible.
    const wakes = await db().rpc("autoresearch_claim_wakes");
    if (wakes.error && !["PGRST202", "42883"].includes(wakes.error.code)) throw new Error(wakes.error.message);
    for (const wake of (wakes.data ?? []) as ResearchWake[]) {
      try { await to(research, { wakeId: wake.id, token: wake.token }).send("Continue research", { auth: appAuth }); }
      catch (error) { console.error("Research dispatch failed; leased retry will recover", wake.id, String(error)); }
    }
    await dispatchResearch();
    // Hosted Softmax results currently use server-side polling; no browser must stay open.
    const pending = await db().from("agent_tasks").select("id,student_id,checkpoint").eq("status", "waiting").lte("next_check_at", new Date().toISOString()).order("next_check_at").limit(50);
    if (pending.error) throw new Error(pending.error.message);
    await Promise.allSettled(pending.data.map(async task => {
      // Move the polling cursor even on failures so one broken account cannot starve others.
      const touched = await db().from("agent_tasks").update({ next_check_at: new Date(Date.now() + 60000).toISOString() }).eq("id", task.id);
      if (touched.error) throw new Error(touched.error.message);
      const xp = task.checkpoint.xp_request_id;
      if (typeof xp !== "string") return;
      const experiment = await experimentByXp(task.student_id, xp);
      if (experiment) await reconcileGame(experiment, await studentToken(task.student_id));
    })).then(results => results.forEach(result => { if (result.status === "rejected") console.error("Task result reconciliation failed", result.reason); }));
    await reconcileTaskRuntimes();
    const events = await rpc<TaskEvent[]>("task_claim_events");
    for (const event of events) {
      try {
        const task = await taskById(event.task_id);
        if (task?.status === "queued") await to(tasks, { taskId: task.id }).send("Continue task", { auth: appAuth });
        await finishDelivery(event);
      } catch (error) { await finishDelivery(event, error instanceof Error ? error.message : String(error)); }
    }
    await dispatchCampaigns();
    await dispatchAuditSessions();
    await stopIdleAuditVMs();
  },
});

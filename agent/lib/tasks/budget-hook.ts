import { defineHook } from "eve/hooks";
import { rpc } from "../../../lib/tasks/store";
import { taskIdentity } from "./auth";

export default defineHook({ events: {
  async "step.started"(event, ctx) {
    const identity = taskIdentity(ctx.session.auth);
    if (!identity) return;
    try {
      const call = `${ctx.session.id}:${event.data.turnId}:${event.data.stepIndex}`;
      // Shared across processes and sessions. Wait before reserving a model call,
      // rechecking task ownership/generation on every wake so cancellation wins.
      for (;;) {
        const delay = await rpc<number>("task_model_slot", { p_task: identity.taskId,
          p_student: identity.studentId, p_generation: identity.generation, p_call: call });
        if (delay < 0) { ctx.cancel(); return; }
        if (delay === 0) break;
        await new Promise(resolve => setTimeout(resolve, Math.min(delay, 20000) + Math.floor(Math.random() * 250)));
      }
      const allowed = await rpc<boolean>("task_reserve_call", { p_task: identity.taskId, p_generation: identity.generation,
        p_call: call });
      if (!allowed) ctx.cancel();
    } catch (error) { ctx.cancel(); throw error; } // Fail closed: hook errors alone do not stop Eve.
  },
  async "step.completed"(event, ctx) {
    const identity = taskIdentity(ctx.session.auth);
    if (!identity) return;
    await rpc("task_record_usage", { p_task: identity.taskId,
      p_call: `${ctx.session.id}:${event.data.turnId}:${event.data.stepIndex}`, p_cost: event.data.usage?.costUsd ?? null });
  },
} });

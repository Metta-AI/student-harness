import { defineChannel, GET } from "eve/channels";
import { z } from "zod";
import { taskById, rpc } from "../../lib/tasks/store";
import { taskAddress } from "../../lib/tasks/model";
import { taskIdentity } from "../lib/tasks/auth";
import { db } from "../../lib/db";
import { isProviderBillingFailure, isProviderConfigurationFailure } from '../../lib/tasks/failure';
import {modelSelectionSchema} from '../../lib/model-selection';

/** Internal scheduler channel. Task controls stay on the authenticated Next.js API. */
export default defineChannel({
  // Eve 0.68 registers custom channel bindings through their route inventory.
  // This content-free health route also makes the internal receive handler discoverable.
  routes: [GET("/task-execution/health", async () => new Response(null, { status: 204 }))],
  turnPolicy: "queue",
  events: {
    async "session.failed"(event) {
      // A definitive terminal event also covers failures outside run_task. The
      // transaction fences the exact root session and preserves checkpoints.
      await rpc('task_runtime_failed', {p_session:event.sessionId,p_message:event.message.slice(0,1000),
        p_attention:isProviderBillingFailure(event.message)||isProviderConfigurationFailure(event.message)});
    },
    async "turn.failed"(event, _channel, ctx) {
      const identity = taskIdentity(ctx.session.auth);
      if (!identity) return;
      const message = event.message;
      // The workflow handles claimed tasks. This covers model/configuration
      // failures before run_task, where no workflow execution exists to recover.
      await rpc('task_dispatch_failed', { p_task: identity.taskId, p_student: identity.studentId,
        p_generation: identity.generation, p_session: ctx.session.id, p_message: message.slice(0, 1000),
        p_attention: isProviderBillingFailure(message) || isProviderConfigurationFailure(message) });
    },
    async "turn.started"(_event, _channel, ctx) {
      const identity = taskIdentity(ctx.session.auth);
      if (!identity) return;
      const { error } = await db().from("agent_tasks").update({ session_id: ctx.session.id })
        .eq("id", identity.taskId).eq("generation", identity.generation).eq("status", "queued");
      if (error) throw new Error(error.message);
    },
  },
  async receive({ target, auth }, { from }) {
    if (auth?.principalType !== "runtime" || auth.principalId !== "eve:app") throw new Error("Task dispatch requires the scheduler");
    const task = await taskById(z.uuid().parse(target.taskId));
    if (!task || task.status !== "queued") throw new Error("Task is not queued");
    const selected=modelSelectionSchema.parse(task.model_selection);
    return from(taskAddress(task)).send(`Run durable task ${task.id}. Call run_task with task_id=${task.id} exactly once. The workflow owns all work and status. Do not use other tools or edit files.`, {
      auth: { authenticator: "task-runner", principalId: task.student_id, principalType: "user",
        attributes: { taskId: task.id, generation: String(task.generation), studentId: task.student_id,model:selected.model,effort:selected.effort } },
      taskDeliveryPolicy: "cohort",
    });
  },
});

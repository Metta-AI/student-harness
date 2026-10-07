import { defineHook } from "eve/hooks";
import { rpc } from "../../../lib/tasks/store";
import { db } from "../../../lib/db";
import { researchIdentity } from "./identity";
export default defineHook({ events: {
  async "step.started"(event, ctx) {
    const identity = researchIdentity(ctx.session.auth); if (!identity) return;
    try {
      if (!await rpc("autoresearch_reserve_call", { p_wake: identity.wakeId, p_token: identity.token, p_call: `${ctx.session.id}:${event.data.turnId}:${event.data.stepIndex}` })) ctx.cancel();
    } catch (error) { ctx.cancel(); throw error; }
  },
  async "step.completed"(event, ctx) {
    const identity = researchIdentity(ctx.session.auth); if (!identity) return;
    const { error } = await db().from("research_director_calls").update({ cost_usd: event.data.usage?.costUsd ?? null })
      .eq("wake_id", identity.wakeId).eq("call_key", `${ctx.session.id}:${event.data.turnId}:${event.data.stepIndex}`);
    if (error) throw new Error(error.message);
  },
} });

import { defineChannel, GET } from "eve/channels";
import { z } from "zod";
import { db } from "../../lib/db";
export default defineChannel({
  routes: [GET("/research-execution/health", async () => new Response(null, { status: 204 }))], turnPolicy: "queue",
  async receive({ target, auth }, { from }) {
    if (auth?.principalType !== "runtime" || auth.principalId !== "eve:app") throw new Error("Research requires scheduler identity");
    const { data: wake, error } = await db().from("research_wakes").select("*").eq("id", z.uuid().parse(target.wakeId)).single();
    if (error || !wake || wake.status !== "running" || wake.token !== target.token || Date.parse(wake.lease_until) <= Date.now()) throw new Error("Research wake is no longer active");
    return from(`${wake.id}:${wake.token}`).send(`Run research wake ${wake.id}. Call run_research with wake_id=${wake.id} exactly once. The workflow makes and records all decisions. Do not call other tools or edit files.`, {
      auth: { authenticator: "research-orchestrator", principalId: wake.student_id, principalType: "user", attributes: { studentId: wake.student_id, wakeId: wake.id, token: wake.token } }, taskDeliveryPolicy: "cohort",
    });
  },
});

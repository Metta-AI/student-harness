import { db } from "../db";
import { rpc } from "../tasks/store";

/** Database locking makes overlapping schedulers and user starts converge on one task. */
export async function dispatchResearch() {
  const plans = await db().from("research_plans").select("id,student_id,cycle_id,research_cycles!inner(state,autonomy,expires_at)").eq("status", "proposed")
    .eq("research_cycles.state", "active").eq("research_cycles.autonomy", true).gt("research_cycles.expires_at", new Date().toISOString())
    .order("priority", { ascending: false }).order("created_at").limit(100);
  if (plans.error) {
    if (["42P01", "PGRST205"].includes(plans.error.code)) return; // Existing deployments may not have the research migration yet.
    throw new Error(plans.error.message);
  }
  await rpc("research_resume_tasks");
  for (const plan of plans.data) {
    try { await rpc("research_start_plan", { p_student: plan.student_id, p_plan: plan.id, p_manual: false }); }
    catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (!/allowance|Between-visit|Another experiment|unsaved policy|cost review|not proposed/.test(reason)) throw error;
      await rpc("research_append", { p_student: plan.student_id, p_cycle: plan.cycle_id, p_key: `waiting:${plan.id}:${reason}`,
        p_actor: "system", p_kind: "experiment.waiting", p_payload: { planId: plan.id, reason } });
    }
  }
}

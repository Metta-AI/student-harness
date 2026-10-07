import { db } from "../db";
import { rpc } from "../tasks/store";
import type { ResearchSettings } from "./autonomy-model";
export * from "./autonomy-model";

export async function readAutonomy(studentId: string) {
  const { data, error } = await db().from("research_settings").select("*").eq("student_id", studentId).maybeSingle();
  if (error) {
    if (["42P01", "PGRST205"].includes(error.code)) return { available: false, settings: null };
    throw new Error(error.message);
  }
  return { available: true, settings: data as ResearchSettings | null };
}
export async function wakeResearch(studentId: string, reason: string, key: string) {
  const { settings } = await readAutonomy(studentId);
  if (!settings) await rpc("autoresearch_bootstrap", { p_student: studentId });
  const { error } = await db().from("research_wakes").upsert({ student_id: studentId, event_key: key, reason }, { onConflict: "student_id,event_key", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  return { queued: true, note: "Preston will investigate within the workspace research settings. Paused work stays paused." };
}

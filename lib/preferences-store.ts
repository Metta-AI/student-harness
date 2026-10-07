import { db } from "./db";
import { preferencesSchema, type UserPreferences } from "./preferences";

import {defaultChatModel} from "./model-selection";

const columns = "chat_model, preferred_name, voice_name, response_length, reasoning_effort, live_captions, daily_research_budget_usd, research_budget_enforced";
function fromRow(row: Record<string, unknown>): UserPreferences {
  return preferencesSchema.parse({ chatModel: row.chat_model??defaultChatModel, preferredName: row.preferred_name, voice: row.voice_name, responseLength: row.response_length, reasoningEffort: row.reasoning_effort, researchBudgetEnforced:row.research_budget_enforced, dailyResearchBudgetUsd: row.daily_research_budget_usd, liveCaptions: row.live_captions });
}
export async function userPreferences(subjectId: string): Promise<UserPreferences> {
  const { data, error } = await db().from("students").select(columns).eq("subject_id", subjectId).single();
  if (error || !data) throw new Error("Could not load preferences");
  return fromRow(data);
}
export async function saveUserPreferences(subjectId: string, patch: Partial<UserPreferences>): Promise<UserPreferences> {
  const values: Record<string, unknown> = {};
  const mapping = { chatModel: "chat_model", preferredName: "preferred_name", voice: "voice_name", responseLength: "response_length", reasoningEffort: "reasoning_effort", researchBudgetEnforced:"research_budget_enforced", dailyResearchBudgetUsd: "daily_research_budget_usd", liveCaptions: "live_captions" } as const;
  for (const key of Object.keys(mapping) as (keyof UserPreferences)[]) {
    if (patch[key] !== undefined) values[mapping[key]] = patch[key];
  }
  const { data, error } = await db().from("students").update(values).eq("subject_id", subjectId).select(columns).single();
  if (error || !data) throw new Error("Could not save preferences");
  return fromRow(data);
}

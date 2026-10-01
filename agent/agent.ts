import { defineAgent, defineDynamic } from "eve";
import { anthropic } from "eve/models/anthropic";
import { studentReasoningEffort } from "../lib/db";
import { defaultReasoningEffort, type ReasoningEffort } from "../lib/reasoning";
import { studentFromAuth } from "./lib/student";

// The student picks the reasoning effort in the chat composer. The model is resolved before every
// model call, so a change applies to the next step; a short cache keeps that to one lookup per turn or so.
const cached = new Map<string, { effort: ReasoningEffort; at: number }>();
const cacheMs = 10_000;

async function reasoningFor(subjectId: string | undefined): Promise<ReasoningEffort> {
  if (!subjectId) return defaultReasoningEffort;
  const hit = cached.get(subjectId);
  if (hit && Date.now() - hit.at < cacheMs) return hit.effort;
  // A failed lookup must not fail the turn: fall back to the default effort.
  const effort = await studentReasoningEffort(subjectId).catch(() => defaultReasoningEffort);
  cached.set(subjectId, { effort, at: Date.now() });
  return effort;
}

export default defineAgent({
  model: defineDynamic({
    events: {
      "step.started": async (_event, ctx) => ({
        model: anthropic("claude-sonnet-5-5"),
        reasoning: await reasoningFor(studentFromAuth(ctx.session.auth)?.subjectId),
      }),
    },
  }),
  compaction: { thresholdPercent: 0.8 },
  limits: {
    // One workshop conversation should never run away with spend.
    maxTokenCostUsdPerSession: 5,
    sessionTimeoutMs: 14 * 24 * 60 * 60 * 1000,
  },
});

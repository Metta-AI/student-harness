import { defineAgent } from "eve";
import { anthropic } from "eve/models/anthropic";

export default defineAgent({
  model: anthropic("claude-sonnet-5-5"),
  compaction: { thresholdPercent: 0.8 },
  limits: {
    // One workshop conversation should never run away with spend.
    maxTokenCostUsdPerSession: 5,
    sessionTimeoutMs: 14 * 24 * 60 * 60 * 1000,
  },
});

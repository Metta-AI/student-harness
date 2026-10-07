import {defineAgent} from "eve";
import {selectedModel} from "./lib/selected-model";

export default defineAgent({
  build: { externalDependencies: ["@vercel/sandbox"] },
  model: selectedModel,
  compaction: { thresholdPercent: 0.8 },
  limits: {
    // Research spending is tracked/enforced by the workspace ledger. Avoid a second hidden approval gate.
    maxTokenCostUsdPerSession: false,
    maxInputTokensPerSession: false,
    sessionTimeoutMs: 14 * 24 * 60 * 60 * 1000,
  },
});

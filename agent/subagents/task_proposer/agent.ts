import {selectedModel} from "../../lib/selected-model";
import { defineAgent } from "eve";
export default defineAgent({
  description: "Propose one attributable BASIC policy change from supplied source and evidence.",
  tool: false, defaultTools: false,
  model:selectedModel,
  limits: { maxOutputTokensPerSession:250000, maxInputTokensPerSession:false, maxTokenCostUsdPerSession:false, sessionTimeoutMs: 20 * 60 * 1000 },
});

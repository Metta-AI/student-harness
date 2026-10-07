import {selectedModel} from "../../lib/selected-model";
import { defineAgent } from "eve";
export default defineAgent({
  description: "Independently select policy proposals or evaluate measured hosted results against acceptance criteria.",
  tool: false, defaultTools: false,
  model:selectedModel,
  limits: { maxOutputTokensPerSession:250000, maxInputTokensPerSession:false, maxTokenCostUsdPerSession:false, sessionTimeoutMs: 20 * 60 * 1000 },
});

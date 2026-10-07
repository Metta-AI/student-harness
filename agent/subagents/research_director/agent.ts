import {selectedModel} from "../../lib/selected-model";
import { defineAgent } from "eve";
export default defineAgent({ description: "Choose the next useful GoTA research action and curate an evidence-linked briefing.", tool: false, defaultTools: false,
  model:selectedModel, limits: { maxOutputTokensPerSession:250000, maxInputTokensPerSession:false, maxTokenCostUsdPerSession:false, sessionTimeoutMs: 10 * 60 * 1000 } });

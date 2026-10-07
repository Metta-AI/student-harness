/** Reasoning effort a student can choose for the agent. Shared by the composer, the API, and the agent. */
// Shared supported effort levels; provider-native mapping is handled by Eve.
export const reasoningEfforts = ["low", "medium", "high", "xhigh"] as const;
export type ReasoningEffort = (typeof reasoningEfforts)[number];
export const defaultReasoningEffort: ReasoningEffort = "low";

export const reasoningLabels: Record<ReasoningEffort, { label: string; detail: string }> = {
  low: { label: "Low", detail: "Fastest. The agent thinks only when a step needs it. The default." },
  medium: { label: "Medium", detail: "Thinks through a change before making it." },
  high: { label: "High", detail: "More thorough reasoning. Uses more time and tokens." },
  xhigh: { label: "Extra high", detail: "Deepest available reasoning in this selector. Uses more time and tokens." },
};

export const isReasoningEffort = (value: unknown): value is ReasoningEffort => typeof value === "string" && (reasoningEfforts as readonly string[]).includes(value);

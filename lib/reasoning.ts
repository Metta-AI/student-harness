/** Reasoning effort a student can choose for the agent. Shared by the composer, the API, and the agent. */
// No "off": claude-sonnet-5-5 rejects a disabled thinking setting, so Low is the floor.
export const reasoningEfforts = ["low", "medium", "high"] as const;
export type ReasoningEffort = (typeof reasoningEfforts)[number];
export const defaultReasoningEffort: ReasoningEffort = "low";

export const reasoningLabels: Record<ReasoningEffort, { label: string; detail: string }> = {
  low: { label: "Low", detail: "Fastest. The agent thinks only when a step needs it. The default." },
  medium: { label: "Medium", detail: "Thinks through a change before making it." },
  high: { label: "High", detail: "Slowest and most thorough. Uses more of the session budget." },
};

export const isReasoningEffort = (value: unknown): value is ReasoningEffort => typeof value === "string" && (reasoningEfforts as readonly string[]).includes(value);

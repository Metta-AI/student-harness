import type * as operations from "./operations";
export async function researchContext(...args: Parameters<typeof operations.researchContext>) {
  "use step";
  return (await import("./operations")).researchContext(...args);
}
export async function applyResearchDecision(...args: Parameters<typeof operations.applyResearchDecision>) {
  "use step";
  return (await import("./operations")).applyResearchDecision(...args);
}

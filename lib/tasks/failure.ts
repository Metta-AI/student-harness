/** Eve serializes child-agent errors across the workflow boundary. Never stringify
 * the whole object: it may contain provider request bodies and credentials. */
export function taskErrorMessage(error: unknown, depth = 0): string {
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object" || depth > 4) return "Agent execution failed";
  const value = error as Record<string, unknown>;
  const message = typeof value.message === "string" ? value.message : "";
  const nested = value.cause ?? value.error;
  const cause = nested ? taskErrorMessage(nested, depth + 1) : "";
  return [message, cause === "Agent execution failed" || message.includes(cause) ? "" : cause].filter(Boolean).join(": ") || "Agent execution failed";
}

export function isProviderRateLimit(message: string): boolean {
  return /rate[_ -]?limit|too many requests|\b429\b/i.test(message)
    && !isProviderBillingFailure(message);
}

export function isProviderBillingFailure(message: string): boolean {
  return /credit_balance_exhausted|no credits remaining|insufficient_quota|exceeded your current quota|billing hard limit/i.test(message);
}

export function isProviderConfigurationFailure(message: string): boolean {
  return /Cannot select model|modelContextWindowTokens|invalid[_ -]?api[_ -]?key|incorrect API key|authentication[_ -]?error|ChatGPT subscription transport is local only/i.test(message);
}

export function isTransientInfrastructureFailure(message:string):boolean {
  return !isProviderBillingFailure(message)&&!isProviderConfigurationFailure(message)
    && /statement timeout|Could not load session model selection|fetch failed|ECONNRESET|ETIMEDOUT|SSL handshake failed|Web server is down|Bad gateway|Service unavailable|Gateway timeout|\b(?:HTTP|status(?: code)?)\s*[:=]?\s*(?:502|503|504|521|525)\b/i.test(message);
}

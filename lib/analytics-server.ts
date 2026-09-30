import { PostHog } from "posthog-node";
import type { EventName } from "./analytics-events";

let client: PostHog | null | undefined;

function posthog(): PostHog | null {
  if (client !== undefined) return client;
  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  if (!token) { client = null; return client; }
  // Serverless and durable-workflow steps can end at any time, so send each event immediately.
  client = new PostHog(token, { host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com", flushAt: 1, flushInterval: 0 });
  return client;
}

/**
 * Capture a product event from the server (Next routes and the agent's tools). The student's
 * Softmax subject ID is the distinct ID everywhere, so client and server events join on one person.
 */
export async function trackServer(subjectId: string, event: EventName, properties?: Record<string, unknown>, set?: Record<string, unknown>) {
  const ph = posthog();
  if (!ph) return;
  try {
    ph.capture({ distinctId: subjectId, event, properties: { ...properties, ...(set ? { $set: set } : {}), source: "server" } });
    await ph.flush();
  } catch { /* analytics must never break a tool */ }
}

export async function identifyServer(subjectId: string, properties: Record<string, unknown>) {
  const ph = posthog();
  if (!ph) return;
  try {
    ph.identify({ distinctId: subjectId, properties });
    await ph.flush();
  } catch { /* ignore */ }
}

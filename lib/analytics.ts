"use client";

import posthog from "posthog-js";
import type { EventName } from "./analytics-events";

const enabled = () => typeof window !== "undefined" && !!process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;

/** Capture a product event from the browser. Silent when PostHog is not configured. */
export function track(event: EventName, properties?: Record<string, unknown>) {
  if (!enabled()) return;
  try { posthog.capture(event, properties); } catch { /* analytics must never break the app */ }
}

export function identifyStudent(subjectId: string, email: string) {
  if (!enabled()) return;
  try { posthog.identify(subjectId, { email }); } catch { /* ignore */ }
}

export function resetAnalytics() {
  if (!enabled()) return;
  try { posthog.reset(); } catch { /* ignore */ }
}

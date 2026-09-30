import posthog from "posthog-js";

// Runs before the app's client code. Autocapture, pageviews, and session replay with every
// input masked, so the Softmax token typed at sign-in never reaches a recording.
if (process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN) {
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
    defaults: "2026-05-30",
    capture_pageleave: true,
    session_recording: { maskAllInputs: true },
  });
}

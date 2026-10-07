# Preston live voice

The orb microphone starts a WebRTC call with `gpt-live-1` using the server's `OPENAI_API_KEY`. `OPENAI_BASE_URL` can point to a compatible gateway; the default is `https://api.openai.com/v1`. `OPENAI_VOICE_BACKEND_MODEL` defaults to `gpt-6-astra`. Credentials and provider configuration stay server-side.

GPT-Live handles simultaneous listening and speaking. Responses delegation handles workspace tools and vision while the audio continues. Policy investigations enter the durable research inbox. Closing voice stops microphone tracks immediately and gracefully closes the live session; it does not cancel queued research. Each voice call is bounded to one hour. Muting the microphone disables its tracks and sends the remote mute command. Quiet replies mute playback without blocking tools. The existing screen-sharing/control capability fences all screen operations.

Tool calls are collected from nested `response.output_item.done`, because forwarded `response.completed` has empty output. Results are returned for all collected calls before `response.create`. Calls are deduplicated within the connection; research enqueue keys include the signed live-session ID and call ID. Server tool requests require both the current account cookie and an encrypted, account-bound, expiring voice lease. Backend screenshots are image input items, never text sent to the audio model.

`inspect_view` reads the currently visible workspace. `read_workspace` reads saved policy/results. `start_research` queues autonomous work; `research_status` inspects progress; `pause_research` stops further research operations. During calls, the client checks persisted research updates and passes new findings back to the live partner. It never labels queued work as completed. Research uses the existing Eve policy workers and their standing workspace budgets.

For local development run `npm run dev` and `npm run research:dev`. Eve's development server does not run cron automatically; the second command dispatches its registered schedule every 15 seconds. Production uses Eve's scheduled runner (`eve build && eve start`) or the generated Vercel cron. Apply migrations with `npm run db:migrate` and the intended database connection configured. Do not use the development scheduler against a deployed host.

Validation: `npm run typecheck`, `npm test`, and `npm run test:browser`. Set `TASK_TEST_DATABASE_URL` to an isolated migrated PostgreSQL instance for durable research tests. The browser suite simulates transport to check controls; it does not substitute for a real WebRTC check with a configured account and microphone.

Official references: [GPT-Live](https://developers.openai.com/api/docs/guides/live), [WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc), [delegation and tools](https://developers.openai.com/api/docs/guides/live-delegation), [session lifecycle](https://developers.openai.com/api/docs/guides/live-conversations).

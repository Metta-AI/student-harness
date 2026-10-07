# Softmax + Preston

## Persistent autoresearch

Preston can start an independent campaign from chat, voice or the session form. It resolves the live champion, delegates opponent/replay investigations, shares immutable evidence, constructs isolated candidates, runs matched screening and fresh confirmation studies, and can promote the exact tested source under standing authorization. Every campaign and child session has its own URL and recorded history; starting work does not require putting a task prompt in the user's chat.

Replay auditing runs in its **own session and persistent Vercel microVM**, with automatic pinned-engine setup. The web server does not execute native game simulation. Audit jobs, receipts and evidence remain accessible after the browser closes; idle VMs stop and resume on demand. See [worker setup](workers/README.md) and the [implementation/validation report](docs/preston-autoresearch-parity.md). Apply all migrations through `0040_task_dispatch_recovery.sql`; run `npm run dev` for both the web app and background development dispatcher. Deployment uses the Eve minute schedule.

Daily usage remains tracked without dollar-budget enforcement. Native VM compute charges are not yet imported into the usage ledger. A real recorded replay has passed all 28,909 state-hash checks on its dedicated VM; the complete matched-study-to-promotion path still needs live end-to-end validation.

## Softmax: develop together with Preston

The Softmax header lists live games and active leagues from Softmax. The default is the public
Gods of the Arena league `league_3c60897b-25cf-4b37-9d1a-8554c1198f28`, not NeuralHub.
Other selections have shareable `/?league=...` URLs with official standings, divisions, rounds,
game references, Preston voice and generated analysis tabs. Rating labels come from the league;
GoTA win/loss rules are not applied to other games. Saved views are scoped to both user and league.
The GoTA policy development workspace (strategy, experiments and hero.bas) stays in the default
league; other leagues currently support exploration rather than policy editing. Voice sessions
bind their league in a signed lease so background lookups cannot silently use another league.
Apply migration `0021_view_league_scope.sql` before deploying this version.

The overview is an interactive illustrated loop: Watch → Question → Try → Compare. Each step
opens relevant replays, hypotheses, policy, or test results. The drawings explain a process, not
measured gameplay. Hypotheses use a situation → action → expected outcome flow with an explicit
invalidation branch and linked evidence. Experiments & work expands below the loop, preserving
access to durable activities, worker results, and pause/resume controls without a sessions rail.
A five-second poll updates recorded task progress. Task storage still requires migration 0008;
unavailable data is shown as unavailable rather than as invented activity.

Preston is the persistent AI partner for this GoTA workspace. A dedicated right panel holds its
animated avatar, Chat and Talk buttons, workspace status, and navigation between shared work, matches, policy,
and tasks. Chat opens inside the panel and stays mounted when closed, preserving the conversation
and draft. On mobile, the floating Preston avatar opens the panel over the workspace. The avatar motion is
decorative, can be paused, and respects reduced-motion preferences; the status list reflects the
current chat turn and recorded workspace data.

Talk uses browser speech recognition and speech synthesis in the existing Eve conversation.
It alternates listening and speaking; unsupported browsers and denied microphone access show a
message. Share screen opens the browser capture picker. Preston's `workspace_screen` tool can
request a fresh JPEG frame, which is saved in the conversation and sent to the vision model.
This is on-demand viewing, not continuous video inference. Allow control separately enables
Preston's visible cursor, temporary drawings, scrolling, and a bounded set of workspace navigation
controls. It does not control the OS, arbitrary web pages, human positions, approvals, or a
cross-origin replay iframe. Existing policy and task tools handle substantive changes.

The browser enforces ephemeral grants and rechecks them for every command. Changing control or
ending sharing invalidates queued commands; action receipts prevent duplicate clicks on stream
redelivery within a mounted conversation. Escape, Stop sharing, switching conversations, signing
out, and leaving the page revoke screen access. Talk also stops when the page becomes hidden.
Drawings clear on scrolling or resizing. Existing policy tools retain their approval behavior.

The **Together** view connects hypotheses and working lessons to situations, actions, expected
outcomes, falsifiers, and evidence. Existing revision hypotheses are projected from their immutable
semantic records. The human and Preston each own their own position, with reasons and history;
agreement does not mark a claim scientifically verified. Revision links open the policy, and hosted
test links open its replay when available or a grounded discussion otherwise.

Apply `supabase/migrations/0009_partner_claims.sql` before deploying this experience. Without it,
existing hypotheses remain readable but new claims and responses cannot be saved. The server-only
table uses student-scoped lookups and optimistic version checks, so stale tabs or conversations cannot
overwrite a newer response. No existing policy IR is rewritten.

The `shared_work` tool lets Preston propose and respond to claims; it cannot set the human's stance.
Dynamic instructions recall working lessons and disagreements on each signed-in chat turn. Only
lessons agreed by both participants are marked as working agreements; opening or closing a chat
does not start an experiment. This recall applies to interactive chat, not the isolated background
task proposal workers. Policy behavior and competitive performance still need independent evidence.

Build a BASIC policy for the [default Gods of the Arena league](https://softmax.com/observatory/v2?tab=coworlds&detail=league%3Aleague_3c60897b-25cf-4b37-9d1a-8554c1198f28) from a browser or this one-file starter.

The IDE tracks each policy as one revision containing `hero.bas`, a seven-layer semantic IR, exact source offsets and SHA-256 hashes, parent revision, coaching evidence references, and separate verification receipts. The policy tab links strategy rules to highlighted BASIC lines. Download **IR + BASIC** to inspect the pair. A new agent edit creates a new pair before the BASIC source is uploaded. The semantic description is authored intent; the source map checks representation only. Behavior and competitive performance remain unverified until independent replay and hosted-game checks exist.

This is a source-map adapter for the [optimizer-seed semantic IR ↔ symbolic proposal](https://github.com/Metta-AI/optimizer-seed/blob/aaln/semantic-ir-symbolic-loop/docs/specs/0001-semantic-ir-symbolic-loop.md). Its seven layers and separate receipts follow that proposal. It does not use the proposed whole-program compiler or reverse recognizer, which are not implemented for this `hero.bas` version. Existing policies are imported with unknown intent and retain their executable bytes.
The browser app asks for a Softmax user token and gives the student a durable coach with a real shell over their
policy workspace. The coach edits `hero.bas`, saves revisions, uploads them, requests hosted episodes, and reads
results through typed tools. The student enters the league from the Policy tab or by asking the coach, who must
get their approval in the chat first.
The workspace reads live league status and the student's hosted runs from Softmax. League replay access uses both
local uploads and the signed-in user's Softmax submissions, matching the episode list. League replay coaching binds
the recording to the verified policy and seat in that episode. **Record coaching** captures narration, timed notes,
and bookmarks beside the replay; **Finish & analyze** saves it and starts analysis. Saved moments seek the recording.
**Investigate coaching** starts an independent research session with the saved coaching reference; **Discuss** opens
a conversation about the feedback. Analysis failures can be retried without re-uploading the recording.
Replay coaching is currently enabled per Softmax account. For accounts without that feature, the workspace links to
the replay and lets the student save a timestamped observation in a chat instead.

The sidebar's **New campaign** action opens a visual guide: choose league improvement, opponent research, or a
recurring replay weakness; tailor the direction; then review the research/test loop. Defaults are 40 matched screening
pairs and 256 confirmation pairs with a confidence gate. Continuous research and verified league submission can be
toggled before launch. The same creator retains a **One-off session** option.

Preston's panel leads with voice, a short campaign update linked to its evidence, and conversation starters
that reflect the current workspace tab. **Type instead** opens the keyboard without starting a separate
conversation. Spoken turns appear beside typed messages; the history button opens saved conversations and
raw voice-log downloads. Apply migration `0044_companion_conversations.sql` to retain voice/text links
across reloads. Older databases continue recording voice and expose those calls separately in history.
Existing calls without a recorded league remain readable; they are not automatically assigned to a league.

## Policy and match statistics

Matches lists two different things, kept apart:

- **League rounds** are the episodes the configured GoTA league scheduled for one uploaded policy version against other players' policies. They decide its rank. Each row shows the round number, when it ran, the side and number of heroes the policy controlled, who it played, the result, and its mean score per hero. Rows come from Softmax's episode requests for that policy version (`/api/league-episodes`), newest first, 50 at a time. The result is read from the two side totals: a positive side total is a win for that side, and all ten heroes at 0 is a match that hit the time limit with no fort destroyed.
- **Practice games** are hosted self-play that the student or the agent requested, where one policy controls all ten heroes. They never count in the league. This table sorts by episode, exact policy version, played time, or hosted score.

The page opens on the newest revision that is entered in the league; choose another uploaded version to see its episodes. The league win percentage is counted from the version's own league episodes over the last 72 hours (`/api/league-record`): a win is a destroyed enemy fort, and a game that reaches the time limit scores 0 for both sides and is not a win. Softmax's policy leaderboard reports its own wins that count a tie for first as a win, which would turn every time-limit game into a win, so that figure is not used anywhere in the app or by the coach. The league score and rank still come from that leaderboard; the score is the mean score per game. Practice scores stay separate. A version with no finished league games in that window shows no win percentage. **Discuss results** gives the coach that exact version's league sample and a hosted episode's statistics so recommendations can name a measurable hypothesis. A note on a league replay sends the coach that episode's round, side, result, score, and roster.

Every upload and league entry is credited to a Softmax **player**. The workspace header names the student's default player, the Policy tab names the player each uploaded revision is credited to, and the chat names it on the upload row and on the league approval card before the student approves.

The app may show replay-derived behavior metrics when a dated snapshot contains the exact selected policy version. Those metrics remain separate from live configured GoTA league results.

## Quick start with an AI coding agent

```bash
git clone https://github.com/Metta-AI/student-harness.git
cd student-harness
uv sync
uv run softmax login
```

Ask the agent to read `AGENTS.md` and improve `hero.bas`. The agent uploads the file and creates an experience request.
The live league ID is in `league.json`; `xp.json` uses it. Replace `POLICY_VERSION_ID` in `xp.json` with the ID printed by upload.

## Web app

The web app is a Next.js workspace with an [eve](https://eve.dev) coach mounted at `/eve/v1/*` by
`withEve` in `next.config.ts`. Each chat is a durable eve session on Vercel Workflow with its own
Vercel Sandbox. The sandbox is rebuilt from the student's saved history when the chat opens:
`/workspace/hero.bas` is the working copy, `versions/` holds one file pair per saved revision,
`experiments/` holds checked hosted results, `docs/` holds the game wiki snapshot, and the directory
is a git repository with one commit per revision. The snapshot also carries a clone of
[optimizer-seed](https://github.com/Metta-AI/optimizer-seed/tree/aaln/semantic-ir-symbolic-loop) with a Gods of the
Arena lab whose files are synced to Supabase after every turn, and a pinned `coworld` CLI behind an allowlisting
shim (`agent/sandbox/scripts/`): read commands and `upload-policy --file` only, no Docker, no replay downloads. The
sandbox network reaches only softmax.com, where the student's token is injected at the boundary, and the policy
upload bucket; the token itself never enters the sandbox. Softmax calls that record history run in the app runtime
through typed tools.

## Chat interface

The chat is [assistant-ui](https://www.assistant-ui.com) on top of the eve session
(`components/chat.tsx`). eve owns the durable stream; assistant-ui renders it. The runtime in
`components/use-eve-chat-runtime.ts` follows `useEveAgentRuntime` from `@assistant-ui/eve` and
reuses its message conversion, with one difference: a message sent while a reply is running goes
to eve immediately as steering instead of waiting for the turn to finish. The pieces:

- `components/assistant-ui/elements/` holds the installed registry components (thread, attachments,
  reasoning and tool groups, approval card, option list, elicitation form, chart, data table,
  terminal block). They are owned source: restyle them here.
- `components/assistant-ui/toolkit.tsx` maps each agent tool to a renderer. Schemas and executors
  stay in `agent/tools/`; every toolkit entry is render-only.
- Replies render with Streamdown. Reasoning and routine tool calls fold into a collapsible chain of
  thought; approvals, questions, forms, tables and charts sit in the reply itself.
- `ask_question`, `request_details` and `present` are agent tools that exist for the interface: a
  pick list, a short form, and charts or tables built only from tool results.
- Attachments, read-aloud and dictation are adapters in `components/chat-adapters.ts`. Read-aloud
  and dictation use the browser's Web Speech API, so dictation needs Chrome, Edge or Safari.
- Reloading mid-reply reopens the conversation and follows the in-flight turn. The active session
  id is remembered per browser.
- Conversations use assistant-ui's thread list in a slide-over sidebar opened from the rail header.
  It reads the saved conversations from `/api/chats` and supports search, rename, and archive.
- Model (Astra, GPT-6.1 Sol, Sonnet 5.5, Opus 5.5) and reasoning effort (Low through Extra high)
  are account preferences available in the composer and Settings. Chat resolves the selection
  before each model call. New background sessions freeze that selection; campaign child sessions
  inherit their campaign's model and effort, even if the composer selection later changes.
  Migration `0035_model_selection.sql` stores these selections. Live audio retains its audio model.
- The left sidebar prioritizes campaigns with expandable worker-session lists. Independent work
  stays under Standalone sessions; past campaigns and recent standalone sessions are collapsible.

Experiment titles open a dedicated record with the saved hypothesis, tested policy, per-episode
scores, failures, replay links and verification details. `?view=experiments&experiment=xreq_...`
links directly to a record. Opening a record reads account-scoped workspace data and does not
start a chat or a new hosted test.

The Development tab is a revision-aware policy wiki. Its sections expose the stored semantic
ontology (situations, beliefs, goals, skills, strategy, execution and updates), shared beliefs and
disagreements, the complete BASIC source and source mappings, version history, verification
receipts, linked experiments, and live game references. Ontology search covers full stored fields;
reference links follow actual IR IDs. It does not infer missing causal or belief-to-rule edges.
Wiki pages and objects support links through `?view=development&wiki=ontology&entity=strategy:R_setup`
and optional `revision`. Preston can present the same pages with `present_view`.

Styling: Tailwind v4 is loaded without its global reset. `app/globals.css` maps the theme tokens to
the Ink & Print palette, scopes the reset to `.aui-scope`, and keeps the older `app/styles.css` in
its own cascade layer so the workspace is unaffected.

Students can attach a `.bas` file (up to 64 KiB) or text notes (up to 256 KiB) in chat.
Pastes over 4,000 characters are stored as text attachments and passed to the agent by ID.
Both attachments and unsaved policy drafts survive reopened chats in `workspace_files`.
Drafts carry their parent revision; if another chat saved a newer revision, the old draft is
restored separately for a deliberate merge. The workspace shows saved, uploaded, and hosted-game
stages, plus an in-app updates inbox and toasts. The updates inbox is derived from the durable
revision/game records; read state is kept in the browser.

The daily Eve schedule reconciles hosted-game results and retries a canceled starter game once.
While a student has the page open, the arena feed also reconciles every 30 seconds. Revision
comparison uses hosted self-play score with the number of games shown. Hosted episode statistics
currently expose reward but no death count, so death fields remain blank until Softmax provides it.

Durable state lives in Supabase (`supabase/migrations/0001_workspace.sql`): students and their sealed
Softmax tokens, policy revisions with the semantic IR pair, hosted-game experiments, and chat sessions.
Only the server uses the service key; the tables have row level security enabled with no policies.

Agent files live under `agent/`: `instructions.md` (coach identity and workflow), `tools/` (save,
upload, request and check hosted games, list revisions, league standing, coaching feedback, and an
approval-gated league entry), `skills/gota-rules` (wiki snapshot), `sandbox/sandbox.ts` (Vercel Sandbox with
hydration), and `channels/eve.ts` (accepts the arena's own student cookie).

### Setup

1. Create `.env.local` from `.env.example`. `SESSION_SECRET` is 32 random bytes in hex; it seals the
   student cookie and the stored Softmax tokens, so the Next app and the eve service must share it.
2. Provision Supabase from the linked Vercel project: `vercel integration add supabase`, then
   `vercel env pull .env.local` and `npm run db:migrate` (uses `psql` and `POSTGRES_URL`).
3. `vercel env pull` also writes `VERCEL_OIDC_TOKEN`, which the eve service needs locally to create
   Vercel Sandboxes. Refresh it when sandbox creation starts failing with an auth error.
4. `npm install` and `npm run dev`. Next boots the eve dev server beside it. `npm run eve:info`
   prints what eve discovered under `agent/`.

For local OpenAI research, `PRESTON_OPENAI_TRANSPORT=chatgpt` uses the existing
Codex/ChatGPT login through Eve while preserving the selected model and reasoning
effort. Restart the dev server after changing this setting. The default is API-key
transport. Subscription transport is local only; deployments require funded API
credentials. Provider billing failures preserve the session and request attention
instead of retrying indefinitely; temporary rate limits resume automatically.

Deploy the project to Vercel from the repo root. `withEve` emits the eve service and routes; the same
project environment must carry `SESSION_SECRET`, `ANTHROPIC_API_KEY`, and the Supabase variables.
Students sign in with a Softmax user token; it is encrypted in an HTTP-only cookie and stored sealed
in the students table so the durable coach can act as them between requests.

`league.json` and `xp.json` target the default Gods of the Arena league. The league's
Coworld remains Gods of the Arena; hosted games, standings, and submissions use the configured GoTA league ID.

## Native replay diagnostics

The student harness uses hosted games and a dedicated remote replay-audit VM.
Do not run local game simulation. See [worker setup](workers/README.md) for the
pinned native engine and the candidate diagnostic that stops at the first change
from recorded play. Diagnostics do not replace independent hosted comparisons.

## Persistent background tasks

The left sidebar groups work by campaign, with expandable child sessions and separate
standalone sessions. Its **+** button accepts an objective, completion target and usage target.
A background planner routes ongoing policy improvement and multi-game comparisons to
campaigns; focused analysis and single-change checks can use standalone sessions.
Campaigns run matched screening, independent confirmation and verified league submission.
Creation displays the saved session immediately,
without waiting for the session-list refresh. **Analyze opponent**, **Build/refine
semantic model**, and **Analyze replay** queue sessions directly, without creating or sending chat
messages. Open a session to inspect its progress, workers, evidence and final result, or pause, resume,
redirect or cancel it. **Discuss in chat** is an explicit choice.

Each session has a permanent `/sessions/<task-id>` URL. Its History shows the original objective,
user direction, public agent messages, expandable tool inputs/outputs, progress and results across
worker runs and retries. Eve stores execution events; migration 0027 preserves task lifecycle and
direction changes. History excludes private reasoning and authentication events. Older sessions
retain their Eve logs; lifecycle entries begin when the migration is installed.

Research sessions run concurrently and do not need a saved policy. Their isolated researcher can read
the Softmax CLI and recorded episode statistics, checkpoint findings, and collect/annotate opponent
evidence and semantic IR. It distinguishes structured evidence from visually watching a replay.
Standalone research has no policy-writing or hosted-game tools. Standalone policy experiments retain the existing pipeline:
two independent proposals, reviewer selection, one saved/uploaded change, one hosted game and evaluation.
Only one standalone policy experiment may be active per student. Its league entry remains separate;
campaigns manage isolated candidates and can submit automatically after their frozen gates pass.

Sessions belong to the student, independently of chat history. Objectives, context, worker outputs,
checkpoints, usage, results and execution attempts live in Supabase. Closing a browser or archiving a
chat does not cancel work. Controls fence subsequent tool calls and writes; an operation already in
progress may finish. Redirecting saves the new direction and queues a fresh execution with prior
checkpoints. A session has a seven-day deadline and three execution attempts per stage.
Daily model spend is tracked without monetary enforcement by default; missing provider cost
is labeled. Model-call safeguards remain enforced, and research/builder sessions allow 250k
output tokens each. Campaigns track reported hosted-game costs separately, including how
many reports are missing. Native VM charges are not yet imported.

`npm run dev` starts both Next/Eve and the local dispatcher (every 15 seconds). Keep that server running
for between-visit work. Deployed Eve runs the minute-by-minute schedule. Apply **all migrations**
through 0040 before using the background researcher, model selection and recovery paths.

Apply `supabase/migrations/0008_durable_tasks.sql` before deploying the agent and web app
(`npm run db:migrate` includes it). All task tables use server-only access with RLS; task RPCs are
restricted to `service_role`. The `task-dispatch` Eve schedule runs every minute. It reconciles
waiting hosted games, leases queued events, and starts/resumes an internal task session. An experiment
result and its wake event commit in the same transaction. Duplicate delivery cannot claim a second
coordinator. External game requests reuse a stable task idempotency key. Interrupted executions recover
from their last checkpoint after a 30-minute lease expires, with a new generation that rejects old writes.

The task workflow and its reasoning workers use Eve's durable execution and subagents. It releases its
execution while waiting for a hosted result; a later event can start a fresh Eve session. This avoids
depending on the lifetime of a conversation or sandbox. The dispatcher also recovers a queued task if
its initial event insertion or delivery was interrupted. Errors and results remain visible on the task.
The supported automation in this release is task/game/worker continuation; recurring user-defined
responsibilities and arbitrary dependency graphs are not yet exposed.

For local development, `eve dev` does **not** fire cron schedules. Trigger the dispatcher explicitly:

```bash
curl -X POST http://localhost:2000/eve/v1/dev/schedules/task-dispatch
```

Use the Eve port printed by your dev server. Production must have the generated once-per-minute cron
job enabled on a hosting plan that supports that cadence. No Softmax webhook is assumed or required.

`npm test` covers task boundaries and the real authored workflow with mocked worker/external-operation
boundaries. To also run the PostgreSQL transaction/recovery tests, apply the migrations to a **disposable**
local database and set `TASK_TEST_DATABASE_URL` when running `npm test`. Those tests insert fixtures in
transactions and roll them back. `npx eve build --skip-sandbox-prewarm` validates compilation without
creating a cloud sandbox; do not deploy that diagnostic build as a substitute for the normal build.

## Preston research cycles

The Overview now centers a shared **research cycle**: question, observable evidence criteria,
pinned baseline, selected active policy, experiments and allowance. Start one after saving a baseline.
Discuss an observation with Preston, queue an unchanged baseline test when its evidence is missing, then grant a bounded allowance for the proposed queue. Enable
between-visit work to let the minute dispatcher start experiments without an open browser. Candidate
experiments use the existing parallel proposal/reviewer workflow and request at most one hosted game.
An inconclusive research experiment completes with its finding intact; it does not select its candidate.

Preston's `research_partner` tool reads the record, contributes its own positions, and proposes
experiments. Human decisions requested through chat use `research_authority` and a confirmation card;
the agent cannot authorize its own funds or impersonate the human. Direct Overview controls perform
the same human actions. Separate attributed positions, shared vocabulary, commitments, corrections,
and optional instruction expiry survive conversations. Superseding a statement preserves its history.
The stable partnership ID survives provider/model changes, which generate continuity events.

Call and hosted-game allowances are reserved atomically before task creation. Unused reservations
are released on completion, failure or cancellation; consumed capacity and late reported cost stay
attributable. Pausing/expiry prevents subsequent operations; external work already underway can finish.
Closing a cycle fences new work immediately and the next dispatcher run cancels its remaining tasks,
releasing their unused reservations. Unused allowance can transfer to another cycle within the caps;
the transfer does not extend its expiry or enable autonomous execution. Standalone task/game tools
are blocked while a research cycle is open, so they cannot bypass its allowance.

Use **Compare evidence and select a policy** to record a behavioral finding from completed tests of
both exact versions. A supported review permits explicit selection; rollback returns to the pinned
baseline. A saved candidate is not automatically selected, and selection does not enter the league.
Self-play scores and human observations do not establish competitive improvement or improvement per
dollar. Conversation costs, infrastructure and hosted-game dollar charges are outside this ledger;
reported model dollars may be partial and are a review threshold, not a guaranteed invoice cap.

During replay review, **Talk** captures the playhead at speech onset and saves the utterance with that
anchor when a cycle is selected. **Mark for research** provides a text alternative. Stale timing is
rejected. Browser-reported moments retain that provenance. **Interrupt**, **Quiet replies** and Escape
control voice. Speech recognition/synthesis remains half-duplex, with browser support and permissions
required; authority cards still require a click. This does not implement a full-duplex voice transport,
a new human-controlled game, or autonomous invention of an unlimited experiment chain.

Research tables and RPCs are server-only. The append-only record is an application/database invariant,
not an end-to-end encryption or permanent-retention promise: server operators retain database access.
There is no persona reset, engagement reward, social reputation, or private journal in this increment.

Apply migrations through `0016_research_baseline.sql` with `npm run db:migrate` before enabling cycles.
The runner applies new migrations in one transaction, records checksums, skips applied files, and
rejects edits to tracked migrations. It prefers `POSTGRES_URL_NON_POOLING`, then `POSTGRES_URL`.
The production scheduler must be enabled; local Eve schedules need the explicit trigger described above.
No production migration, live model experiment, upload, or league entry was part of local validation.

The ordered hypotheses, gates and findings are in [the implementation log](docs/preston-implementation.md).
For the UI fixture test, start `npm run dev`, install Chromium once with `npx playwright install chromium`,
then run `npm run test:browser`. Alternatively set `CHROME_EXECUTABLE` to an existing Chrome binary.
`BROWSER_TEST_URL` defaults to `http://localhost:3000`. This test stubs application/agent network boundaries
and exercises desktop/mobile controls without spending experiment funds. Speech recognition is simulated;
real microphone latency and hosted-game quality require a separate pilot. Browser artifacts are written to
`/tmp/preston-research-*.png`. Database tests require a disposable superuser database: the concurrency test
uses committed, uniquely named fixtures with narrowly scoped cleanup; other database tests roll back.

### Preston live conversations and custom views

Voice uses GPT-Live-1 with a GPT-6-Astra Responses backend. Both spoken speakers' exact transcript fragments are saved in `voice_events`, including provider event IDs, session-relative timestamps, receive times and sequence. `voice_sessions` scopes every call to its signed-in account. Tool names/call IDs and connection lifecycle events are recorded alongside speech; audio, credentials and private reasoning are not included. Typed chat continues to use Eve's durable session history.

The browser persists unsent fragments locally, retries in the background, and flushes during call shutdown. **Conversation history** under Preston reopens saved conversations and exports the full transcript/tool log. The save indicator distinguishes pending from acknowledged writes. Browser crashes before a fragment arrives cannot be recovered; unsent local buffers require the same account to sign back in within seven days. New voice calls receive the current conversation’s recent spoken and typed turns; typed messages include recent live context. A new conversation starts without unrelated voice history.

Voice also exposes `start_session` and `session_status`. Substantial spoken requests can queue the same durable tasks as the Sessions sidebar, with an objective, completion criteria, and an AI budget target. The voice session and tool-call ID provide the retry key; results include the permanent session URL. Starting work refreshes the sidebar without sending a chat message or waiting for the worker. Task lookup remains scoped to the signed-in account and GoTA workspace. Existing voice calls must reconnect to receive changed tool definitions.

`softmax_cli` is available to voice and the Eve chat agent. It invokes the installed `softmax`/`coworld` commands with account-specific credentials supplied over stdin to an isolated Python process, without changing local login files. Supported read operations include leagues, divisions, results, rounds, episodes, memberships, submissions, events, docs and hosted-request status. Use `coworld leagues` for discovery, `divisions --league ID --json`, then `results DIVISION_ID --json` for policy rankings. `results LEAGUE_ID` lists divisions. Experiments/writes remain on the persistent research path. Install dependencies with `uv sync`; servers without `.venv/bin/python` must set `SOFTMAX_CLI_PYTHON` to an interpreter with `coworld[auth]` installed.

`create_view` composes saved, evidence-linked text, tables, bar charts and steps. Views render as React components, never model-provided executable HTML. They appear in Preston's pane, honor pins, open at full size, and remain under **Saved views**. They are dated analysis snapshots, not live measurements. Migration `0019_voice_and_views.sql` creates the private application tables for both features.

The Opponents tab keeps a notebook per exact GoTA policy version. Collect data stores a dated
player-standing snapshot and a bounded episode sample from the selected league division.
Observations and hypotheses require Softmax evidence links and retain human/Preston attribution.
Snapshots and notes are isolated by student, league and policy ID. Preston uses `opponent_research`
in chat or voice; collection does not run games or access private policy source.

Opponent profiles include **Analyze opponent** and **Build / Refine semantic model**. Each starts
its own durable Preston conversation, linked back to the exact opponent version and reopenable
from Research sessions. `opponent_research.save_model` stores versioned observational semantic IR:
situations, beliefs, goals, skills, strategies, their relationships, evidence, falsifiers, unknowns
and next tests. Snapshot and episode references are checked against account/league/policy scope.
Internal beliefs/goals remain hypotheses; observed behavior requires episode evidence. The IR
is an observational model, not compiled policy code. Migration `0023_opponent_models.sql` adds
model history and opponent links on chat sessions.

### Research cost tracking

Research runs in **tracking-only mode** by default (`0029_research_cost_tracking.sql`). Daily, per-session, and cycle dollar totals do not stop work. Settings → Research exposes an **Enforce spending limits** switch; the previous $25/day allowance is retained for when enforcement is enabled again. Explicit pauses, execution deadlines, model-step limits and game-count limits still apply.

The shared ledger introduced in `0028_daily_research_budget.sql` continues to record background task and director model calls, task-hosted games, reported costs, and $1 placeholders for unreported costs. Placeholders are not price estimates or actual charges. Reported costs replace placeholders; retries remain deduplicated. Voice-created tasks use the same accounting. Foreground chat and live audio are outside this research ledger. Historical usage before installation is not backfilled.

Task listings (including Preston's `task_status` and voice `session_status`) expose the accounting mode, today's reported and reserved amounts, and configured allowance. Tracking mode returns null for the effective limit and remaining allowance. Accounting days reset at midnight Pacific, including DST. Provider billing may differ from this ledger.

The dispatcher resumes sessions stopped solely by dollar limits when enforcement is disabled, preserving checkpoints. Human pauses, cancellations, and unrelated requests for input remain intact. When enforcement is enabled, budget-parked sessions resume the next day.

Background workers allow 250,000 output tokens each. Workspace model-call limits, deadlines, and optional research spending enforcement still apply; the Eve provider layer does not impose separate dollar or input-token approval prompts.

Background session recovery retains each task's model and effort in its internal
session auth, and records root execution IDs independently of model usage. A
terminal runtime failure is retried from saved checkpoints with backoff; repeated
failures or provider configuration/billing issues become visible attention states.
The dispatcher checks stale root transcripts to recover callbacks lost during a
database outage. It never treats an observation timeout as a failed execution.
For hosted deployments set `PRESTON_RUNTIME_URL` to this app's HTTPS origin so the
watchdog can use its authenticated Eve stream endpoint. Local development defaults
to `http://localhost:3000`. Apply migrations 0042–0043 before running this version.

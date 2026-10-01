# NeuralHub Gods of the Arena

Build a BASIC policy for the [NeuralHub at Diablo Valley College league](https://softmax.com/gods-of-the-arena/neuralhub) from a browser or this one-file starter.

The IDE tracks each policy as one revision containing `hero.bas`, a seven-layer semantic IR, exact source offsets and SHA-256 hashes, parent revision, coaching evidence references, and separate verification receipts. The policy tab links strategy rules to highlighted BASIC lines. Download **IR + BASIC** to inspect the pair. A new agent edit creates a new pair before the BASIC source is uploaded. The semantic description is authored intent; the source map checks representation only. Behavior and competitive performance remain unverified until independent replay and hosted-game checks exist.

This is a source-map adapter for the [optimizer-seed semantic IR ↔ symbolic proposal](https://github.com/Metta-AI/optimizer-seed/blob/aaln/semantic-ir-symbolic-loop/docs/specs/0001-semantic-ir-symbolic-loop.md). Its seven layers and separate receipts follow that proposal. It does not use the proposed whole-program compiler or reverse recognizer, which are not implemented for this `hero.bas` version. Existing policies are imported with unknown intent and retain their executable bytes.
The browser app asks for a Softmax user token and gives the student a durable coach with a real shell over their
policy workspace. The coach edits `hero.bas`, saves revisions, uploads them, requests hosted episodes, and reads
results through typed tools. The student enters the league from the Policy tab or by asking the coach, who must
get their approval in the chat first.
The workspace reads live league status and the student's hosted runs from Softmax. **Watch & coach** opens the
episode replay in Observatory, where students can narrate, mark moments, and record feedback. Completed coaching
sessions appear back in the workspace. **Discuss in chat** starts a saved conversation grounded in that feedback;
an explicit policy edit request passes the coaching proposals to the background agent.
Replay coaching is currently enabled per Softmax account. For accounts without that feature, the workspace links to
the replay and lets the student save a timestamped observation in a chat instead.

## Policy and match statistics

The Matches table sorts by episode, exact policy version, played time, hosted score, or policy win percentage. Choose a policy version to filter hosted matches and compare its mean hosted score with its league result. The live win percentage comes from Softmax's competition policy leaderboard over the last 72 hours (`wins / episodes_played`); ties for first count as wins. Hosted self-play scores stay separate. A version with no league games in that window shows no win percentage. **Discuss results** gives the coach that exact version's league sample and a hosted episode's statistics so recommendations can name a measurable hypothesis.

The app may show replay-derived behavior metrics when a dated snapshot contains the exact selected policy version. Those metrics remain separate from live NeuralHub league results.

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
- Reasoning effort (Low, Medium, High) is a per-student preference set in the composer and stored
  in `students.reasoning_effort`. `agent/agent.ts` resolves it before each model call. There is no
  Off level: the agent's model rejects a disabled thinking setting.

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

Deploy the project to Vercel from the repo root. `withEve` emits the eve service and routes; the same
project environment must carry `SESSION_SECRET`, `ANTHROPIC_API_KEY`, and the Supabase variables.
Students sign in with a Softmax user token; it is encrypted in an HTTP-only cookie and stored sealed
in the students table so the durable coach can act as them between requests.

`league.json` and `xp.json` target the NeuralHub at Diablo Valley College league. The league's
Coworld remains Gods of the Arena; hosted games, standings, and submissions use the NeuralHub league ID.

## I want to simulate on my machine

Local simulation is optional and needs a container runtime. On macOS, follow the
[OrbStack setup guide](https://github.com/Metta-AI/coworld/blob/main/src/coworld/docs/MACOS.md), then use the
[Coworld local runner guide](https://softmax.com/docs/coworld/overview).

# NeuralHub Gods of the Arena

Build a BASIC policy for [Gods of the Arena](https://softmax.com/gods-of-the-arena) from a browser or this one-file starter.

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

The [Polyworld Buff Players page](https://metta-ai.github.io/polyworld-buff/GOTA/players/) provides deeper replay-derived behavior statistics and its [extractor notes](https://github.com/Metta-AI/polyworld-buff/blob/main/tools/PLAYERS.md) describe how those snapshots are generated. When the snapshot contains the exact selected policy version, the app shows its dated behavior sample and passes it to the coach. It does not present those metrics as live results. To add those metrics for new student versions, run the extractor in a hosted worker against verified replays and publish version-keyed aggregates; the workshop browser needs no local game dependencies.

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
is a git repository with one commit per revision. The sandbox has no network access; every Softmax
call runs in the app runtime through typed tools, so the student's token never enters the sandbox.

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

The default `league.json` points to the existing public Gods of the Arena league. Change it to the
class league ID once that league exists.

## I want to simulate on my machine

Local simulation is optional and needs a container runtime. On macOS, follow the
[OrbStack setup guide](https://github.com/Metta-AI/coworld/blob/main/src/coworld/docs/MACOS.md), then use the
[Coworld local runner guide](https://softmax.com/docs/coworld/overview).

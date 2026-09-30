# NeuralHub Gods of the Arena

Build a BASIC policy for [Gods of the Arena](https://softmax.com/gods-of-the-arena) from a browser or this one-file starter.

The IDE tracks each policy as one revision containing `hero.bas`, a seven-layer semantic IR, exact source offsets and SHA-256 hashes, parent revision, coaching evidence references, and separate verification receipts. The policy tab links strategy rules to highlighted BASIC lines. Download **IR + BASIC** to inspect the pair. A new agent edit creates a new pair before the BASIC source is uploaded. The semantic description is authored intent; the source map checks representation only. Behavior and competitive performance remain unverified until independent replay and hosted-game checks exist.

This is a source-map adapter for the [optimizer-seed semantic IR ↔ symbolic proposal](https://github.com/Metta-AI/optimizer-seed/blob/aaln/semantic-ir-symbolic-loop/docs/specs/0001-semantic-ir-symbolic-loop.md). Its seven layers and separate receipts follow that proposal. It does not use the proposed whole-program compiler or reverse recognizer, which are not implemented for this `hero.bas` version. Existing policies are imported with unknown intent and retain their executable bytes.
The browser app asks for a Softmax user token, lets a student describe a strategy in chat, and starts a durable cloud job.
That job edits the policy, uploads it, and requests one hosted episode. The student can then enter the league.
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

Create `.env.local` from `.env.example`. Set `SESSION_SECRET` to a random 32-byte hex string, an Anthropic API key,
and an assistant-ui Cloud project key and frontend URL. The project key stays on the server. Threads and chat history
are saved in assistant-ui Cloud under the signed-in Softmax user.
Run `npm install` and `npm run dev`. Deploy this Next.js project to Vercel from the repo root. Vercel Workflow stores
running jobs; there is no separate worker or database. The Softmax token is encrypted in an HTTP-only cookie and only
sent to `softmax.com` by server routes. Each browser session tracks its latest job. The generated file can be downloaded
from the result panel.

The default `league.json` points to the existing public Gods of the Arena league. Change it to the class league ID once
that league exists. A student can test against the public league before the class league is ready.

## I want to simulate on my machine

Local simulation is optional and needs a container runtime. On macOS, follow the
[OrbStack setup guide](https://github.com/Metta-AI/coworld/blob/main/src/coworld/docs/MACOS.md), then use the
[Coworld local runner guide](https://softmax.com/docs/coworld/overview).

# NeuralHub Gods of the Arena

Build a BASIC policy for [Gods of the Arena](https://softmax.com/gods-of-the-arena) from a browser or this one-file starter.
The browser app asks for a Softmax user token, lets a student describe a strategy in chat, and starts a durable cloud job.
That job edits the policy, uploads it, and requests one hosted episode. The student can then enter the league.
The workspace reads live league status and the student's hosted runs from Softmax. Completed episodes can be
reviewed with optional notes; **Record & analyze** opens a new saved chat with the recorded scores and policy metrics.

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

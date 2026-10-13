# Hermes mode: scope

Proposal, 2026-10-12. Phases 1 and 2 are implemented and live; see Status.

This page preserves the original proposal and its dated status updates. The
proposal's one-sandbox-per-conversation design was superseded by the shared
account sandbox described under Status. For a source-checked current overview,
see [Preston, Eve, Hermes and the model](system-overview.md#preston-eve-hermes-and-the-model).

## Goal

Let a conversation run on Hermes (NousResearch `hermes-agent`) instead of Eve's
built-in model loop, while keeping everything the harness gives Preston today:
the persistent conversation and its link, the workspace tabs, saved policies,
approvals and the Ask/Auto permission setting, credits, and the league tools.
The user picks the mode per conversation, next to the model and permission
selectors.

Why: Hermes brings a mature coding loop (40+ tools, subagents, skills it writes
and refines, FTS session search, context compaction) that we would otherwise
rebuild. We already trust it for Autoresearch.

## What exists today

Hermes already runs inside the harness, but only as the Autoresearch worker:

- Pinned at `f97608f1` and baked into the Vercel Sandbox snapshot
  (`workers/autoresearch/install.sh`, `agent/sandbox/sandbox.ts`).
- Runs as one-shot `hermes chat --query-file` turns under a detached supervisor
  with a single-writer lock, at most 8 turns or 45 minutes per start
  (`workers/autoresearch/supervisor.py`, `lib/terminal/research-loop.ts`).
- Reaches models only through AI Gateway. The real key is injected at the
  sandbox network boundary; the VM holds a placeholder.
- `approvals.mode: off` plus a deny list (`coworld submit*`, `run-episode*`, …).
- Output comes back through files (`terminal.log`, `state.json`, `PLAN.md`),
  polled every 5 seconds. No streaming.
- No access to Preston's tools: no memory, league tools, views or approvals.
- Cost: $5 app reservation plus an account-wide Gateway spend checkpoint. Hermes
  usage is not imported into the app ledger.

## Recommended design

Keep Eve as the durable shell and make Hermes the brain for a Hermes-mode
conversation.

```
Browser rail ──► Eve session (durable, approvals, continuation, events)
                   │ each turn
                   ▼
              hermes_turn workflow tool ──► Hermes gateway in the conversation's
                   ▲   streams progress        Vercel Sandbox (API server :8642)
                   │                               │ tools
                   │                               ▼
                   └──── effect requests ◄── Harness MCP server (Next.js route)
```

1. **Hermes runs as a long-lived gateway, not one-shot turns.** The
   conversation's sandbox starts `hermes gateway` with the OpenAI-compatible API
   server enabled (`API_SERVER_ENABLED`, a per-conversation `API_SERVER_KEY`,
   bound to localhost inside the VM). Eve reaches it through the sandbox's
   exposed port. We use `/v1/responses` streaming, so tool calls, reasoning and
   text arrive as structured events, and Hermes keeps its own conversation
   state between turns.

2. **One Eve tool carries the turn.** In Hermes mode Preston's instructions
   reduce to "forward the human's message with `hermes_turn` and relay the
   result". `hermes_turn` is a durable workflow tool that sends the message,
   streams Hermes events into the Eve stream (so the existing activity rows,
   live status and copy-link all work), and returns the final answer. Eve still
   owns persistence, the session link, continuation after failures, and the
   permission setting.

3. **Harness capabilities reach Hermes through MCP.** A new authenticated route
   (`/api/mcp/harness`) serves the harness tools to Hermes over MCP, scoped to
   one account, league and conversation by a short-lived token:
   - Read: league standings and rounds, replays, game contract, saved policies
     (`container_policy_source list/read`), shared memory and studies.
   - Write without side effects: save a policy revision, create a workspace
     view, record a finding.
   - Effects (build, upload, practice game, league entry, research grants) are
     **requested, not executed** by MCP. The MCP call returns "pending" and the
     request surfaces in the Eve session as a normal tool approval. Ask mode
     shows the approval card; Auto mode approves it. Eve executes it with the
     existing tool and gives Hermes the receipt on its next turn. This keeps one
     approval and idempotency path for both modes.

4. **Safety stays at the boundaries we already have.** Credentials remain
   network-injected (AI Gateway, Softmax). The coworld shim and network
   allowlist stay. Hermes's own `approvals` are set to `smart` with our deny
   list, and `unattended_mode: deny`, so a dangerous shell command is refused
   rather than silently run.

5. **Persistence.** Hermes stores sessions and memory under `HERMES_HOME` in the
   VM. We snapshot `~/.hermes` with the sandbox and copy `MEMORY.md`, `USER.md`
   and new skills into Supabase after each turn, so a rebuilt VM or a continued
   conversation restores Hermes's state. The opening goal and transcript are
   already carried by the conversation-continuation path.

## Phases

| Phase | Delivers | Main work | Exit check |
| --- | --- | --- | --- |
| 1. Hermes chat | Mode selector; Hermes answers in the rail with streamed activity; read-only harness tools | Gateway launch in the sandbox, `hermes_turn` tool, event mapping, MCP read tools | A Hermes conversation reads the league and saved policy, survives reload and a VM restart, and shows cost |
| 2. Effects | Hermes can request builds, uploads, practice and league entry | MCP effect requests bridged to Eve approvals; receipts back to Hermes | Ask and Auto both work; no duplicate build on retry |
| 3. Memory and skills | Hermes memory and skills survive VM rebuilds and inform Preston | Post-turn sync of `MEMORY.md`, `USER.md`, skills into Supabase; Brain pages show them | A new VM restores Hermes state; skills listed under Preston's brain |
| 4. Unify Autoresearch | Autoresearch runs on the same gateway | Replace the one-shot supervisor loop with gateway sessions and cron | Existing supervisor tests pass against the gateway |

Phase 1 is the shippable slice: roughly a week for one engineer, mostly in the
sandbox launch and the event mapping.

## Cost and limits

- Model spend goes through AI Gateway as today, but Hermes also spends on
  auxiliary calls (smart approvals, compaction, titles). Phase 1 imports
  Gateway usage per conversation into the credit ledger so the header credit
  count stays true.
- A gateway per active conversation means one warm sandbox each. Sandboxes
  stop after idle and resume on the next message (Vercel snapshot), so cost is
  per active hour, not per conversation.
- Hermes context and tool schemas are larger than Preston's; expect higher
  per-turn input tokens until prompt caching settles.

## Risks

- **Two agents, two personalities.** Hermes has its own system prompt and
  memory. We set its `SOUL.md` from Preston's instructions so tone and rules
  match, and keep league rules in the MCP tool descriptions.
- **Upstream churn.** Hermes moves fast (tens of thousands of commits). Keep the
  pin, upgrade deliberately, and run the supervisor and Hermes-mode tests on
  each bump.
- **Approval latency.** Bridged effects add one round trip through Eve. Auto
  mode hides it; Ask mode shows the card as today.
- **Debuggability.** Two event streams. The `hermes_turn` tool records Hermes
  run ids so a turn can be traced from the rail to Hermes logs.

## Status, 2026-10-12

Decisions taken: mode is per conversation (new conversations start in the
last-used mode); Hermes gets the full harness toolset from the start, with
approvals bridged; Hermes uses the conversation's selected model; one shared,
persistent Hermes sandbox per account, one Hermes session per conversation.

Built and verified live against production:

- `lib/hermes/host.ts` builds the base image (Hermes v0.21.7 via the official
  installer) and runs one gateway per account in the named sandbox
  `preston-hermes-<hash>`. Credentials stay outside the VM: AI Gateway,
  softmax.com and the harness MCP server get their Authorization headers from
  the sandbox network policy. A marker file records the config the running
  gateway loaded; a changed config stops the old gateway and starts a new one.
- `agent/channels/hermes.ts` serves the harness tools over MCP at
  `/hermes/mcp`. `agent/lib/hermes-tools.ts` exposes 49 eve tools with their
  own schemas and approval policies. Every call names its conversation, which
  must belong to the account in the bearer token.
- `agent/tools/hermes_turn.ts` is offered only in Hermes-mode conversations.
  Preston relays each message to Hermes, streams tool progress, and shows the
  reply. `lib/hermes/turn.ts` reads tool names from Hermes events, including
  calls made through Hermes's lazy `tool_call` wrapper.
- Ask mode: a gated call is held, Hermes stops, and the turn returns it as a
  pending approval with its exact input. Preston runs it through the normal
  approval card and sends the outcome back. Auto mode runs it directly, as in
  a Preston conversation.
- End-to-end test: Hermes listed saved container sources and read live
  standings through MCP; in Ask mode a build request came back as a pending
  approval and did not run.

- In the live app, a Hermes-mode conversation calls Hermes from the real
  composer; Hermes read the league and uploaded policies through MCP.
- Fixed during live testing: the gateway restart never killed the old process
  (it kept the old MCP path); tool names were read from the wrong event field;
  production has no Gateway key in its environment, so the per-request Vercel
  OIDC token is used; eve takes a streaming tool's last yielded value as its
  output, so `hermes_turn` now yields its final result. That last fix is
  deployed but not yet re-run in the app, because the account hit its daily
  research budget.

Credit metering (2026-10-13):

- Hermes's model calls, auxiliary ones included, go to
  `/api/hermes/gateway/v1/*` on the harness (`lib/hermes/gateway-meter.ts`),
  not to AI Gateway. The sandbox network policy no longer allows
  `ai-gateway.vercel.sh`, so no call can skip the meter.
- Each POST reserves $1 (`chat:hermes:<uuid>`, shown as a chat model call in
  Usage), forwards to AI Gateway with the server's Gateway credential, and
  settles the gateway-priced `usage.cost` plus tokens. Rejected requests settle
  at $0; a call whose usage never arrives keeps its hold. Out of credits → 402,
  and Hermes stops.
- Hermes sends reasoning settings only to hosts it recognizes as AI Gateway, so
  `startGateway` patches that one check (`REASONING_PATCH`) before each start
  and fails if the pinned source has moved.
- Hermes session titles must be unique per host; titles carry a suffix.
- The sandbox network proxy re-signs TLS for header-injected hosts with
  one-day certificates and was seen serving an expired one (every MCP and model
  call failed with "certificate has expired"). `ensureHermesHost` probes for
  it and removes/re-adds the harness rule, which issues a fresh certificate.

Not done yet:

- `SOUL.md` is Hermes's default, not derived from Preston's instructions.
- Eve sandbox tools (bash, files, save_policy_version) are not exposed; Hermes
  uses its own shell in its own sandbox, so files are not shared with Preston's
  sandbox.
- Phases 3 and 4 (memory and skills sync, Autoresearch on the gateway).
- Local development points Hermes at the production MCP server, because a
  cloud sandbox cannot reach localhost.

## Decisions needed (answered above)

1. Per conversation, or account-wide default with a per-conversation override?
2. Should Hermes-mode conversations get the full write toolset in phase 1, or
   stay read-only until the approval bridge (phase 2) lands?
3. Which model should Hermes use by default: the conversation's selected model
   (today's behavior for Autoresearch), or a separate Hermes default?
4. Is a warm sandbox per active Hermes conversation acceptable for cost, or
   should Hermes run in one shared per-account sandbox with Hermes profiles?

## Sources

- Repository: `workers/autoresearch/`, `lib/terminal/`, `agent/tools/research_terminal.ts`,
  `app/api/research/terminal/route.ts`, [historical autoresearch notes](archive/implementation-notes-2026-10-13.md#terminal-autoresearch-workspace).
- Hermes docs: <https://hermes-agent.nousresearch.com/docs> (API server, approvals,
  terminal backends, MCP), repository <https://github.com/NousResearch/hermes-agent>.

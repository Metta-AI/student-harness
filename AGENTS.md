# Student policy project

This repo is for one Gods of the Arena BASIC policy: `hero.bas`. Keep policy changes in that file.

Read the [policy and host guide](https://softmax.com/gods-of-the-arena/wiki/policy-and-host-surface),
the [game rules](https://softmax.com/gods-of-the-arena/wiki/overview), and `league.json` before editing.
The source was copied from
[`base.bas`](https://github.com/Metta-AI/polyworld/blob/main/examples/gods_of_the_arena/players/base.bas).
The live game can change, so check its wiki and source before relying on old host functions.

Do not run `coworld download` or `coworld run-episode`. Those commands are outside the hosted student path.
Do not set up local simulation during the class.

To evaluate a change without local game dependencies:

1. Edit `hero.bas`. Explain the intended gameplay change in one sentence.
2. `uv run softmax login` (after `uv sync`), then `uv run coworld upload-policy --file ./hero.bas`.
3. Use the returned policy version ID in `xp.json`, then
   `uv run coworld xp-request create xp.json`.
4. Inspect `uv run coworld xp-request get xreq_... --json` and the replay before another edit.

An upload creates a policy version. Enter the league only when the student asks:
`uv run coworld submit POLICY_NAME:vN --league LEAGUE_ID`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

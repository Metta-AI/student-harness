# Student policy workspace

This directory is the student's Gods of the Arena workspace for the
[default Gods of the Arena league](https://softmax.com/observatory/v2?tab=coworlds&detail=league%3Aleague_3c60897b-25cf-4b37-9d1a-8554c1198f28)
(`league_3c60897b-25cf-4b37-9d1a-8554c1198f28`). It is rebuilt from the
student's saved history whenever a new chat session opens its sandbox.

- `hero.bas` — the working copy of the policy. Edit this file.
- `versions/rN.bas`, `versions/rN.json` — every saved revision and its summary, hypothesis,
  Softmax policy version ID, and hosted results so far.
- `experiments/<xp_request_id>.json` — results of hosted games that have been checked.
- `docs/` — the Gods of the Arena wiki snapshot (rules, kits, BASIC host functions).
- `optimizer-seed/` — the optimizer method (Metta-AI/optimizer-seed, branch
  `aaln/semantic-ir-symbolic-loop`). Read its `AGENTS.md`. The student's lab is
  `optimizer-seed/games/gods-of-the-arena/`; files there and the seed's root memory files
  (`WORKING_CONTEXT.md`, `TENTATIVE_LESSONS.md`, `best_practices.md`, `closed_levers.md`,
  `user_preferences.md`) are saved after every turn and restored next session.
- The directory is a git repository with one commit per saved revision. Use `git log`,
  `git diff r2..r3 -- hero.bas` style commands to review history.

Saving, uploading, and running games happen through tools, not from this shell:
`save_policy_version` records `hero.bas` as the next revision, `upload_policy` sends it to
Softmax, `request_hosted_game` starts a hosted match, and `hosted_game_status` fetches results.

`coworld` and `softmax` are installed and signed in as the student, limited to read commands
and `upload-policy --file`. Docker, local runs, and replay downloads are refused, and the
network reaches only softmax.com.

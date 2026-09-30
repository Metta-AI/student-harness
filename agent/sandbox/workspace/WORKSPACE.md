# Student policy workspace

This directory is the student's Gods of the Arena workspace. It is rebuilt from the
student's saved history whenever a new chat session opens its sandbox.

- `hero.bas` — the working copy of the policy. Edit this file.
- `versions/rN.bas`, `versions/rN.json` — every saved revision and its summary, hypothesis,
  Softmax policy version ID, and hosted results so far.
- `experiments/<xp_request_id>.json` — results of hosted games that have been checked.
- `docs/` — the Gods of the Arena wiki snapshot (rules, kits, BASIC host functions).
- The directory is a git repository with one commit per saved revision. Use `git log`,
  `git diff r2..r3 -- hero.bas` style commands to review history.

Saving, uploading, and running games happen through tools, not from this shell:
`save_policy_version` records `hero.bas` as the next revision, `upload_policy` sends it to
Softmax, `request_hosted_game` starts a hosted match, and `hosted_game_status` fetches results.

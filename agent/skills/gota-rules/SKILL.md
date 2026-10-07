---
description: Use when reasoning about Gods of the Arena rules, hero kits, items, the BASIC policy API, host functions, or league scoring before proposing or editing a policy change.
---

# Gods of the Arena rules and policy surface

This IDE targets only the [default Gods of the Arena league](https://softmax.com/observatory/v2?tab=coworlds&detail=league%3Aleague_3c60897b-25cf-4b37-9d1a-8554c1198f28).
Use `league_3c60897b-25cf-4b37-9d1a-8554c1198f28` for hosted games, standings, and league entry.

Snapshot of the official wiki taken on 2026-09-30. The live game can change, so when a
detail matters (a host function name, an item stat, a scoring rule), confirm it against the
live page with `web_fetch` before relying on it. Every page is served as markdown:

- Overview: https://softmax.com/gods-of-the-arena/wiki/overview.md
- Mechanics and reference: https://softmax.com/gods-of-the-arena/wiki/mechanics.md
- Game guide (kits and items): https://softmax.com/gods-of-the-arena/wiki/game-guide.md
- Hero statistics: https://softmax.com/gods-of-the-arena/wiki/hero-statistics.md
- Policy model and host surface (the BASIC API): https://softmax.com/gods-of-the-arena/wiki/policy-and-host-surface.md
- For current GoTA league standings, use `league_standing` or the league page. The wiki's player standings may describe another league.
- Wiki search: https://softmax.com/api/observatory/v2/wikis/Gods%20of%20the%20Arena/search.md?q=<query>

The same pages are seeded into the sandbox under `/workspace/docs/` so you can `grep` them:

- `references/overview.md`
- `references/mechanics.md`
- `references/game-guide.md`
- `references/hero-statistics.md`
- `references/policy-and-host-surface.md`
- `references/player-standings.md`
- `references/league-participation.md` (how uploads, experience requests, and league entry work)

Rules of thumb when editing `hero.bas`:

- Only call host functions that appear in the policy-and-host-surface page or already in the file.
- Keep the file under 64 KiB and keep it valid Polyworld BASIC. Do not use Python, Nim, or imports.
- Make one focused gameplay change per revision so a hosted game can test one hypothesis.

import assert from "node:assert/strict";
import { test } from "node:test";
import { bestLeagueRevision, leagueState } from "../lib/league-results.ts";
import { listLeagueSubmissions } from "../lib/softmax.ts";

test("a placed revision with no leaderboard row remains submitted", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ entries: [{
    id: "sub_r2", status: "placed", policy_version: { id: "pv_r2" },
    auto_champion: "always", created_at: "2026-09-30T22:00:00Z",
  }], next_cursor: null });
  try {
    const submissions = await listLeagueSubmissions("test-token");
    assert.equal(submissions[0].policy_version?.id, "pv_r2");
    assert.equal(leagueState("pv_r2", submissions.some((item) => item.policy_version?.id === "pv_r2"), 0), "entered_no_games");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("best league revision uses score with played games, not win rate or hosted results", () => {
  assert.equal(bestLeagueRevision([
    { revision: 1, league_result_72h: { score: 52.8, games: 506 } },
    { revision: 2, league_result_72h: null },
    { revision: 3, league_result_72h: { score: 60, games: 40 } },
    { revision: 4, league_result_72h: { score: 100, games: 0 } },
  ]), 3);
});

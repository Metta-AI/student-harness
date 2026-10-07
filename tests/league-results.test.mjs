import assert from "node:assert/strict";
import { test } from "node:test";
import { bestLeagueRevision, leagueState } from "../lib/league-results.ts";
import { getLeagueStandings, listLeagueSubmissions } from "../lib/softmax.ts";

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


test("official standings use player MMR endpoint, preserving rank independently of policy win rate", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.match(String(url), /\/v2\/divisions\/division-test\/leaderboard$/);
    return Response.json([{rank:36,player_id:"ours",player_name:"a-aron",score:7.38,score_label:"MMR",rounds_played:3,policy_label:"hunter:v1",settling:true}]);
  };
  try {
    const rows = await getLeagueStandings("test-token", "division-test");
    assert.equal(rows[0].rank, 36);
    assert.equal(rows[0].score, 7.38);
    assert.equal(rows[0].score_label, "MMR");
  } finally { globalThis.fetch = originalFetch; }
});

test("an empty official leaderboard stays unranked", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json(null);
  try { assert.deepEqual(await getLeagueStandings("test-token", "division-test"), []); }
  finally { globalThis.fetch = originalFetch; }
});

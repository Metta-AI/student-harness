import assert from "node:assert/strict";
import { test } from "node:test";
import league from "../league.json" with { type: "json" };
import xp from "../xp.json" with { type: "json" };
import { getLeague, getCompetitionDivision, listExperiences, requestEpisode, submitPolicy, hostedGameRequestKey } from "../lib/softmax.ts";

test("default league is consistent across navigation, hosted games, standings and entry", async () => {
  const id = "league_3c60897b-25cf-4b37-9d1a-8554c1198f28";
  assert.equal(league.id, id);
  assert.equal(new URL(league.url).searchParams.get("detail"), `league:${id}`);
  assert.equal(xp.target.league_id, id);
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    const parsed = new URL(url);
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({ parsed, body });
    if (parsed.pathname.endsWith(`/leagues/${id}`)) return Response.json({ id, name: league.name, description: null, rounds_paused_at: null, submissions_locked_at: null, settings: { ladder: { enabled: true } } });
    if (body?.target) return Response.json({ id: "test-game", status: "pending" });
    if (body?.league_id) return Response.json({ id: "test-submission", status: "pending" });
    assert.equal(parsed.searchParams.get("league_id"), id);
    if (parsed.pathname.endsWith("/divisions")) return Response.json([{ id: "division", name: "Competition", type: "competition" }]);
    return Response.json({ entries: [], next_cursor: null });
  };
  try {
    await getLeague("test-token");
    await getCompetitionDivision("test-token");
    await listExperiences("test-token");
    await requestEpisode("test-token", "policy", "Test candidate");
    await requestEpisode("test-token", "policy", "Retry", "existing-durable-key");
    await submitPolicy("test-token", "policy");
    const games = requests.filter(r => r.body?.target).map(r => r.body);
    assert.ok(games.every(game => game.target.league_id === id && game.roster.length === 10 && game.num_episodes === 1));
    assert.equal(games[0].idempotency_key, hostedGameRequestKey("policy"));
    assert.ok(games[0].idempotency_key.includes(id));
    assert.notEqual(hostedGameRequestKey("policy", 1), hostedGameRequestKey("policy", 2));
    assert.equal(games[1].idempotency_key, "existing-durable-key");
    assert.equal(requests.at(-1).body.league_id, id);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

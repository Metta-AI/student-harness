import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeLeagueEpisode, tallyLeagueOutcomes } from "../lib/league-episodes.ts";

const seats = (first, second) => [...Array(10).keys()].map((position) => {
  const team = position < 5 ? first : second;
  return { position, policy_version_id: team.id, policy_name: team.name, version: team.version, player_name: team.player };
});
const mine = { id: "pv_mine", name: "hunter-lane-3939", version: 2, player: "a-aron" };
const rival = { id: "pv_rival", name: "push-retreat-0be8", version: 1, player: "Lily" };
const scores = (values) => values.map((score, position) => ({ position, score }));

test("a team episode on the Red side that scored is a win against one named opponent", () => {
  const summary = summarizeLeagueEpisode("pv_mine", seats(mine, rival), scores([120, 433, 173, 229, 250, 0, 0, 0, 0, 0]), true);
  assert.deepEqual(summary.seats, [0, 1, 2, 3, 4]);
  assert.equal(summary.side, "Red");
  assert.equal(summary.format, "team");
  assert.equal(summary.outcome, "won");
  assert.equal(summary.score, 241);
  assert.deepEqual(summary.opponents, [{ policyVersionId: "pv_rival", policy: "push-retreat-0be8:v1", player: "Lily", seats: 5 }]);
});

test("the Blue side loses when only Red scored", () => {
  const summary = summarizeLeagueEpisode("pv_mine", seats(rival, mine), scores([103, 252, 123, 80, 177, 0, 0, 0, 0, 0]), true);
  assert.equal(summary.side, "Blue");
  assert.equal(summary.outcome, "lost");
  assert.equal(summary.score, 0);
});

test("all ten heroes at zero is the time limit, not a loss", () => {
  const summary = summarizeLeagueEpisode("pv_mine", seats(mine, rival), scores(Array(10).fill(0)), true);
  assert.equal(summary.outcome, "time_limit");
  assert.equal(summary.score, 0);
});

test("one seat on a mixed side is judged by the side total and lists teammates", () => {
  const roster = [...Array(10).keys()].map((position) => position === 7
    ? { position, policy_version_id: "pv_mine", policy_name: mine.name, version: 2, player_name: "a-aron" }
    : { position, policy_version_id: `pv_${position}`, policy_name: `other-${position}`, version: 1, player_name: `player ${position}` });
  const summary = summarizeLeagueEpisode("pv_mine", roster, scores([0, 0, 0, 0, 0, 90, 80, 0, 70, 60]), true);
  assert.equal(summary.format, "mixed");
  assert.equal(summary.side, "Blue");
  assert.equal(summary.outcome, "won");
  assert.equal(summary.teammates.length, 4);
  assert.equal(summary.opponents.length, 5);
});

test("an episode that has not finished has no score or outcome", () => {
  const summary = summarizeLeagueEpisode("pv_mine", seats(mine, rival), [], false);
  assert.equal(summary.score, null);
  assert.equal(summary.outcome, null);
  assert.equal(summary.side, "Red");
});

test("time-limit games are counted on their own and never as wins", () => {
  const tally = tallyLeagueOutcomes(["won", "time_limit", "time_limit", "lost", "time_limit", null]);
  assert.deepEqual(tally, { games: 5, wins: 1, losses: 1, time_limits: 3 });
  assert.equal(tally.wins / tally.games, 0.2);
});

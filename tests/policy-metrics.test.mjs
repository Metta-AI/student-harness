import assert from "node:assert/strict";
import { test } from "node:test";
import { episodeScore, policyScore } from "../lib/policy-metrics.ts";

test("mixed matches use the selected policy's recorded score", () => {
  const match = {
    scores: [{ policy_version_id: "alpha", score: 0 }, { policy_version_id: "beta", score: 1 }],
    participant_scores: [{ position: 0, score: 0 }, { position: 1, score: 1 }],
  };
  assert.equal(episodeScore(match), 0.5);
  assert.equal(policyScore(match, "alpha"), 0);
  assert.equal(policyScore(match, "beta"), 1);
  assert.equal(policyScore(match, "other"), null);
});

test("missing scores remain unknown", () => {
  assert.equal(episodeScore({ scores: [], participant_scores: [] }), null);
});

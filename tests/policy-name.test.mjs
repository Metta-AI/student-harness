import assert from "node:assert/strict";
import { test } from "node:test";
import { policyStyleFromSummary } from "../lib/softmax.ts";

test("first upload without a name derives a safe playstyle from the saved change", () => {
  assert.equal(policyStyleFromSummary("Prioritize enemy towers; retreat before dying"), "tower-retreat");
  assert.equal(policyStyleFromSummary("Retreat before dying"), "retreat-focus");
  assert.equal(policyStyleFromSummary("Baseline: official starter policy"), "balanced-starter");
  assert.equal(policyStyleFromSummary("Alice wants a new policy"), "balanced-starter");
});

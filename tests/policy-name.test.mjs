import assert from "node:assert/strict";
import { test } from "node:test";
import { policyNameFor, policyStyleFromSummary } from "../lib/softmax.ts";

test("first upload without a name derives a safe playstyle from the saved change", () => {
  assert.equal(policyStyleFromSummary("Prioritize enemy towers; retreat before dying"), "tower-retreat");
  assert.equal(policyStyleFromSummary("Retreat before dying"), "retreat-focus");
  assert.equal(policyStyleFromSummary("Baseline: official starter policy"), "balanced-starter");
  assert.equal(policyStyleFromSummary("Alice wants a new policy"), "balanced-starter");
});

test("a one-word student name gets a distinct public name within the upload limit", () => {
  assert.match(policyNameFor("student-id", "Degen"), /^degen-[0-9a-f]{4}$/);
  assert.equal(policyNameFor("student-id", "x".repeat(100)).length, 40);
});

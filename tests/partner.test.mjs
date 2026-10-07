import assert from "node:assert/strict";
import { test } from "node:test";
import { agreement, claimInputSchema, partnerContext, respond } from "../lib/partner/model.ts";

const input = { kind: "lesson", statement: "Check whether the intended situation occurred before judging a change.", situation: "When reviewing a hosted test", action: "Find the triggering situation in the replay", expected: "Separate untested ideas from failed behaviors", falsifier: "The check repeatedly misses relevant situations", evidence: [] };
const claim = { ...input, id: "claim-a", version: 1, author: "human", createdAt: "2026-10-02T00:00:00Z", revision: null, positions: { human: "open", present: "open" }, history: [] };
test("a proposal requires an operational meaning and explicitly permits missing evidence", () => {
  assert.equal(claimInputSchema.safeParse(input).success, true);
  for (const key of ["statement", "situation", "action", "expected", "falsifier"]) assert.equal(claimInputSchema.safeParse({ ...input, [key]: "" }).success, false);
});
test("participants own separate positions; agreement can be withdrawn without erasing history", () => {
  const human = respond(claim, { id: claim.id, version: 1, stance: "agree", note: "This matches our last evaluation." }, "human");
  assert.equal(agreement(human), "open"); assert.equal(human.positions.present, "open");
  const shared = respond(human, { id: claim.id, version: 2, stance: "agree", note: "I will check the condition before interpreting results." }, "present");
  assert.equal(agreement(shared), "shared");
  const disputed = respond(shared, { id: claim.id, version: 3, stance: "disagree", note: "This procedure missed the relevant moment." }, "human");
  assert.equal(agreement(disputed), "disputed"); assert.equal(disputed.positions.present, "agree");
  assert.equal(disputed.history.length, 3); assert.equal(claim.history.length, 0);
});
test("a stale response cannot erase a newer position", () => {
  assert.throws(() => respond({ ...claim, version: 2 }, { id: claim.id, version: 1, stance: "agree", note: "Outdated view" }, "present"), /changed/);
});
test("only mutual working lessons become active context; disagreement survives recall", () => {
  const shared = { ...claim, positions: { human: "agree", present: "agree" } };
  const disputed = { ...shared, id: "disputed", positions: { human: "disagree", present: "agree" } };
  const hypothesis = { ...shared, id: "hypothesis", kind: "hypothesis" };
  const recalled = partnerContext([claim, shared, disputed, hypothesis]);
  assert.equal(recalled.length, 3);
  assert.deepEqual(recalled.map(r => r.useAsWorkingAgreement), [false, true, false]);
  assert.equal(recalled[2].positions.human, "disagree");
});

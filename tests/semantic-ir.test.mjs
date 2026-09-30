import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { importPolicy, reconcilePolicy } from "../lib/semantic-ir.ts";

const starter = readFileSync(new URL("../hero.bas", import.meta.url), "utf8");
const change = {
  before: "sub chooseHero()",
  after: "' Draft preference experiment\nsub chooseHero()",
  summary: "Document a draft preference experiment.",
  semantic: {
    condition: "The hero draft is active.",
    action: "Document the intended draft preference.",
    goal: "Choose a useful team role.",
    hypothesis: "A draft preference will improve team balance.",
    expected: "A draft decision will favor the named role.",
    non_trigger: "No draft change after drafting is complete.",
  },
};

test("official starter has a complete ordered source map", () => {
  const { ir, receipts } = importPolicy(starter, true);
  assert.equal(ir.strategy[0].source.start, 0);
  assert.equal(ir.strategy.at(-1).source.end, starter.length);
  for (let index = 1; index < ir.strategy.length; index++) {
    assert.equal(ir.strategy[index - 1].source.end, ir.strategy[index].source.start);
  }
  assert.equal(receipts.representation, "partial");
  assert.equal(receipts.fidelity, "not_run");
});

test("a change links intent to exact edited BASIC and records evidence", () => {
  const parent = importPolicy(starter, true);
  const updated = reconcilePolicy(parent, change, ["coaching-session:csn_test"]);
  assert.equal(updated.source, starter.replace(change.before, change.after));
  assert.equal(updated.ir.update.parent, parent.revisionId);
  assert.deepEqual(updated.ir.update.evidence, ["coaching-session:csn_test"]);
  assert.equal(updated.ir.strategy.find((rule) => rule.id === "R_chooseHero").source.status, "stale");
  const patch = updated.ir.strategy.at(-1);
  assert.equal(updated.source.slice(patch.source.start, patch.source.end), change.after);
  assert.equal(updated.receipts.performance, "not_run");
});

test("rejects ambiguous edits and changed parent revisions", () => {
  const parent = importPolicy(starter, true);
  assert.throws(() => reconcilePolicy(parent, { ...change, before: "  end if\n" }, []), /exactly one/);
  assert.throws(() => reconcilePolicy({ ...parent, source: `${parent.source}\n` }, change, []), /source bytes/);
});

test("existing policies import without invented gameplay intent", () => {
  const imported = importPolicy("sub run()\nend sub\n", false);
  assert.equal(imported.ir.strategy[0].intent, "Imported executable; intent not reconstructed");
});

test("reconcileSource links a whole-file edit to the changed lines", async () => {
  const { reconcileSource } = await import("../lib/semantic-ir.ts");
  const parent = importPolicy(starter, true);
  const next = starter.replace("sub chooseHero()", "' Draft preference experiment\nsub chooseHero()");
  const revision = reconcileSource(parent, next, change.summary, change.semantic, ["csn_test"]);
  assert.equal(revision.source, next);
  assert.equal(revision.ir.update.revision, 1);
  const rule = revision.ir.strategy.at(-1);
  assert.equal(rule.source.status, "mapped");
  assert.ok(next.slice(rule.source.start, rule.source.end).includes("Draft preference experiment"));
  assert.ok(revision.ir.strategy.some((item) => item.source.status === "stale"));
  assert.throws(() => reconcileSource(parent, starter, change.summary, change.semantic, []), /unchanged/);
});

test("reconcileSource survives a pure deletion by widening to whole lines", async () => {
  const { reconcileSource } = await import("../lib/semantic-ir.ts");
  const parent = importPolicy(starter, true);
  const lines = starter.split("\n");
  const index = lines.findIndex((line, position) => position > 0 && line.trim() === "");
  assert.ok(index > 0, "starter has a blank line to delete");
  const next = [...lines.slice(0, index), ...lines.slice(index + 1)].join("\n");
  const revision = reconcileSource(parent, next, "Remove a comment line.", change.semantic, []);
  const rule = revision.ir.strategy.at(-1);
  assert.ok(rule.source.end > rule.source.start);
  assert.equal(revision.source, next);
});

test("baselineRevision records the unchanged starter as revision 1", async () => {
  const { baselineRevision } = await import("../lib/semantic-ir.ts");
  const parent = importPolicy(starter, true);
  const baseline = baselineRevision(parent, "Baseline: official starter policy", change.semantic, []);
  assert.equal(baseline.source, starter);
  assert.equal(baseline.ir.update.revision, 1);
  assert.equal(baseline.ir.update.parent, parent.revisionId);
  assert.notEqual(baseline.revisionId, parent.revisionId);
  assert.ok(baseline.ir.strategy.every((rule) => rule.source.status === "mapped"));
});

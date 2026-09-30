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

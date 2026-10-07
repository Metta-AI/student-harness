import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (e) { if (e.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(`${specifier}.ts`, context); throw e; }
} });
let tables;
const db = () => ({ from(table) {
  let mode = "read", values, filters = [], single = false;
  const query = {
    select() { return query; }, order() { return query; }, limit() { return query; },
    eq(key, value) { filters.push(row => String(row[key]) === String(value)); return query; },
    insert(v) { mode = "insert"; values = v; return query; },
    update(v) { mode = "update"; values = v; return query; },
    maybeSingle() { single = true; return query; },
    then(resolve) {
      let rows = tables[table].filter(r => filters.every(f => f(r)));
      if (mode === "insert") {
        if (tables[table].some(r => r.id === values.id && r.student_id === values.student_id)) return Promise.resolve({ error: { code: "23505" }, data: null }).then(resolve);
        tables[table].push(structuredClone(values)); rows = [values];
      } else if (mode === "update") rows.forEach(r => Object.assign(r, structuredClone(values)));
      return Promise.resolve({ data: structuredClone(single ? rows[0] ?? null : rows), error: null }).then(resolve);
    },
  }; return query;
} });
mock.module("../lib/db.ts", { namedExports: { db, studentToken: async () => { throw new Error("Unexpected token access"); } } });
const { createClaim, readPartner, respondToClaim } = await import("../lib/partner/store.ts");
const { default: tool } = await import("../agent/tools/shared_work.ts");
const { default: instructions } = await import("../agent/instructions/partnership.ts");
const input = { kind: "lesson", statement: "Check the situation before judging a change", situation: "Reviewing game evidence", action: "Find the relevant replay moment", expected: "Distinguish a missing trigger", falsifier: "We still misclassify the result", evidence: [] };
const reset = () => { tables = { partner_claims: [], policy_versions: [], experiments: [] }; };
test("shared work is tenant-scoped, including evidence and response lookup", async () => {
  reset(); const claim = await createClaim("alice", input, "human");
  assert.equal((await readPartner("bob")).claims.length, 0);
  await assert.rejects(respondToClaim("bob", { id: claim.id, version: 1, stance: "agree", note: "Not my claim" }, "human"), /not found/);
  tables.experiments.push({ id: "other-game", student_id: "bob", xp_request_id: "xp-bob" });
  await assert.rejects(createClaim("alice", { ...input, evidence: [{ kind: "experiment", ref: "xp-bob", detail: "Other user's private game" }] }, "human"), /belong to your/);
});
test("simultaneous responses cannot silently overwrite each other", async () => {
  reset(); const claim = await createClaim("alice", input, "human");
  const response = { id: claim.id, version: 1, stance: "agree", note: "We should try this procedure." };
  const results = await Promise.allSettled([respondToClaim("alice", response, "human"), respondToClaim("alice", response, "present")]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal((await readPartner("alice")).claims[0].history.length, 1);
});
test("the agent tool can change only Present's position even when given a forged actor", async () => {
  reset(); const claim = await createClaim("alice", input, "human");
  const ctx = { session: { auth: { current: { authenticator: "student-harness", principalId: "alice", attributes: {} } } } };
  const updated = await tool.execute({ action: "respond", response: { id: claim.id, version: 1, stance: "agree", note: "I will use this procedure.", actor: "human" } }, ctx);
  assert.equal(updated.positions.human, "open"); assert.equal(updated.positions.present, "agree");
});
test("a new turn recalls mutual lessons and immediately reflects withdrawn agreement", async () => {
  reset(); const claim = await createClaim("alice", input, "human");
  await respondToClaim("alice", { id: claim.id, version: 1, stance: "agree", note: "This would help our work." }, "human");
  await respondToClaim("alice", { id: claim.id, version: 2, stance: "agree", note: "I will check the triggering situation." }, "present");
  const ctx = { session: { auth: { current: { authenticator: "student-harness", principalId: "alice", attributes: {} } } } };
  const first = await instructions.events["turn.started"]({}, ctx);
  assert.equal(first.role, "user"); assert.match(first.content, /"useAsWorkingAgreement":true/);
  await respondToClaim("alice", { id: claim.id, version: 3, stance: "disagree", note: "The check missed an important case." }, "human");
  const next = await instructions.events["turn.started"]({}, ctx);
  assert.match(next.content, /"useAsWorkingAgreement":false/);
  assert.match(next.content, /The check missed an important case/);
  assert.equal(await instructions.events["turn.started"]({}, { session: { auth: {} } }), null);
});

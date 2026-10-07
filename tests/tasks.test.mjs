import assert from "node:assert/strict";
import { test } from "node:test";
import { assertExecution, gameRequestKey, taskAddress, taskInputSchema, terminalGame, terminalTask } from "../lib/tasks/model.ts";

const now = Date.parse("2026-10-01T00:00:00Z");
const active = { status: "running", execution_key: "attempt-1", lease_until: new Date(now + 60000).toISOString(), deadline_at: new Date(now + 600000).toISOString() };
test("only the live task attempt can perform work", () => {
  assert.doesNotThrow(() => assertExecution(active, "attempt-1", now));
  for (const status of ["paused", "canceled", "queued", "completed", "needs_input", "failed", "waiting"]) {
    assert.throws(() => assertExecution({ ...active, status }, "attempt-1", now), /no longer active/);
  }
  assert.throws(() => assertExecution(active, "stale-attempt", now), /no longer active/);
  assert.throws(() => assertExecution({ ...active, lease_until: new Date(now).toISOString() }, "attempt-1", now), /no longer active/);
  assert.throws(() => assertExecution({ ...active, deadline_at: new Date(now).toISOString() }, "attempt-1", now), /deadline/);
});
test("external game operation identity survives session and attempt replacement", () => {
  assert.equal(gameRequestKey("task-123"), "neuralhub-task-task-123-game-1");
  assert.notEqual(gameRequestKey("task-a"), gameRequestKey("task-b"));
  const task = { id: "task-a", generation: 0, phase: "propose", attempts: 0 };
  assert.equal(taskAddress(task), taskAddress({ ...task }));
  assert.notEqual(taskAddress(task), taskAddress({ ...task, generation: 1 }));
  assert.notEqual(taskAddress(task), taskAddress({ ...task, phase: "evaluate" }));
});
test("task input requires a concrete objective and completion criteria with bounded budget", () => {
  const input = { objective: "Improve retreat behavior", acceptanceCriteria: "Report measured results and uncertainty", requestKey: "request-123" };
  assert.equal(taskInputSchema.parse(input).maxModelCalls, 24);
  assert.equal(taskInputSchema.parse(input).maxCostUsd, 25);
  for (const patch of [{ objective: "hi" }, { acceptanceCriteria: "" }, { maxModelCalls: 101 }, { maxCostUsd: 0 }]) {
    assert.equal(taskInputSchema.safeParse({ ...input, ...patch }).success, false);
  }
});
test("waiting for input does not complete a task, and canceled games do settle", () => {
  assert.equal(terminalTask("needs_input"), false);
  assert.equal(terminalTask("paused"), false);
  assert.equal(terminalTask("completed"), true);
  assert.equal(terminalGame("cancelled"), true);
  assert.equal(terminalGame("running"), false);
});

test("an older chat must explicitly merge a newer background policy before saving", async () => {
  const { needsPolicyMerge } = await import("../lib/policy-parent.ts");
  assert.equal(needsPolicyMerge("r1", "r2"), true);
  assert.equal(needsPolicyMerge(null, "r2"), true);
  assert.equal(needsPolicyMerge("r2", "r2"), false);
  assert.equal(needsPolicyMerge("r1", "r2", "r2"), false);
  assert.equal(needsPolicyMerge("r1", "r3", "r2"), true);
});

test("PostgREST composite task results normalize arrays, objects and SQL null rows", async () => {
  const { taskRow } = await import("../lib/tasks/model.ts");
  const row = { id: "task-1" };
  assert.deepEqual(taskRow([row]), row);
  assert.deepEqual(taskRow(row), row);
  assert.equal(taskRow([]), null);
  assert.equal(taskRow(null), null);
  assert.equal(taskRow([{ id: null }]), null);
  assert.throws(() => taskRow([row, row]), /multiple rows/);
});

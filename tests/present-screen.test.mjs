import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHooks } from "node:module";
import { authorizeScreenAction, screenActionSchema, screenReceiptSchema } from "../lib/partner/screen.ts";

registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (error.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(`${specifier}.ts`, context);
    throw error;
  }
} });
const { default: screenTool } = await import("../agent/tools/workspace_screen.ts");

test("sharing grants fence stale actions and viewing never grants control", () => {
  const look = { grant: "current", action: "look" };
  assert.doesNotThrow(() => authorizeScreenAction(look, "current", false));
  for (const action of ["move", "click", "select", "scroll", "draw", "clear"]) {
    assert.throws(() => authorizeScreenAction({ ...look, action }, "current", false), /control is off/);
    assert.doesNotThrow(() => authorizeScreenAction({ ...look, action }, "current", true));
  }
  for (const grant of [null, "new-activation"]) assert.throws(() => authorizeScreenAction(look, grant, true), /ended or changed/);
});

test("screen commands reject arbitrary code, selectors, oversized drawings and invalid coordinates", () => {
  for (const input of [
    { action: "eval", value: "document.cookie" }, { action: "click", selector: "button" },
    { action: "move", point: { x: -1, y: .5 } }, { action: "move", point: { x: .5, y: Infinity } },
    { action: "draw", points: Array.from({ length: 81 }, () => ({ x: .5, y: .5 })) },
  ]) assert.equal(screenActionSchema.safeParse({ grant: "current", ...input }).success, false);
  assert.equal(screenReceiptSchema.safeParse({ ok: true, detail: "frame", image: "not a base64 image" }).success, false);
});

test("screen workflow confirms only valid browser receipts and exposes pixels to the model", async () => {
  let asks = 0;
  const receipt = { ok: true, detail: "captured", snapshot: "current targets", image: "aGVsbG8=" };
  const output = await screenTool.execute({ grant: "current", action: "look" }, { ask: async () => { asks++; return { status: "answered", text: JSON.stringify(receipt) }; } });
  assert.equal(asks, 1); assert.deepEqual(output, receipt);
  const model = await screenTool.toModelOutput(output);
  assert.equal(model.type, "content"); assert.equal(model.value.length, 2);
  for (const answer of [{ status: "dismissed" }, { status: "unavailable" }, { status: "answered", text: "done" }, { status: "answered", text: '{"ok":true}' }]) {
    const result = await screenTool.execute({ grant: "current", action: "click", target: "p1" }, { ask: async () => answer });
    assert.equal(result.ok, false);
  }
});

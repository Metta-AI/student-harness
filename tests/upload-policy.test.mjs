import assert from "node:assert/strict";
import { test } from "node:test";
import { uploadPolicy } from "../lib/softmax.ts";

const source = "sub main()\nend sub\n";
const version = { id: "a951ea67-31b3-479f-ae53-a5085f3ad44b", name: "neuralhub-test", version: 2 };

test("an already stored hash completes without uploading bytes again", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ path: new URL(url).pathname, method: options.method });
    if (new URL(url).pathname.endsWith("/files/upload")) {
      return new Response(JSON.stringify({ detail: "content hash is already stored; call complete" }), { status: 409 });
    }
    assert.match(new URL(url).pathname, /\/files\/complete$/);
    return Response.json(version);
  };
  try {
    assert.deepEqual(await uploadPolicy("test-token", "student-id", source, "Baseline"), version);
    assert.deepEqual(requests.map(({ path }) => path.split("/").at(-1)), ["upload", "complete"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a new hash uploads the bytes before completing", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    const path = new URL(url).pathname;
    requests.push(path);
    if (path.endsWith("/files/upload")) return Response.json({ upload_url: "https://upload.example/file", existing_policy_version: null });
    if (path === "/file") {
      assert.equal(options.method, "PUT");
      assert.equal(options.body.toString(), source);
      return new Response(null, { status: 200 });
    }
    assert.match(path, /\/files\/complete$/);
    return Response.json(version);
  };
  try {
    assert.deepEqual(await uploadPolicy("test-token", "student-id", source, "Baseline"), version);
    assert.deepEqual(requests.map((path) => path.split("/").at(-1)), ["upload", "file", "complete"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an authorization failure remains an error", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ detail: "forbidden" }), { status: 403 });
  };
  try {
    await assert.rejects(uploadPolicy("test-token", "student-id", source, "Baseline"), /returned 403/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

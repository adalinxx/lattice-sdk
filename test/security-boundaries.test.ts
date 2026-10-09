import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeNodeURL, getJSON } from "@adalinxx/lattice-client";
import { encodeDagCbor, decodeDagCbor } from "@adalinxx/lattice-core";

test("empty query and fragment delimiters cannot control node route suffixes", () => {
  for (const url of ["https://node.test/?", "https://node.test/#", "https://node.test/?x", "https://node.test/#x"]) {
    assert.throws(() => normalizeNodeURL(url), /query, or a fragment/);
  }
  assert.equal(normalizeNodeURL("https://node.test/rpc/"), "https://node.test/rpc");
});

test("DAG-CBOR preserves BOM strings and treats __proto__ as data", () => {
  assert.equal(decodeDagCbor(encodeDagCbor("\uFEFFchild")), "\uFEFFchild");
  const input = Object.fromEntries([["__proto__", { polluted: true }]]);
  const result = decodeDagCbor(encodeDagCbor(input)) as Record<string, unknown>;
  assert.ok(Object.hasOwn(result, "__proto__"));
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("bounded JSON requests forbid redirects and carry cancellation", async () => {
  await getJSON(async (_url, init) => {
      assert.equal(init?.redirect, "error");
      assert.ok(init?.signal instanceof AbortSignal);
      return new Response("{}");
    }, new URL("https://node.test/rpc/api/deposits"), 8000, 1024);
});

test("bounded JSON rejects an oversized streamed response", async () => {
  await assert.rejects(getJSON(async () => new Response("x".repeat(1025)), new URL("https://node.test"), 8000, 1024), /response too large/);
});

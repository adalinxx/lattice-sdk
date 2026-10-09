import assert from "node:assert/strict";
import { test } from "node:test";
import { vectorDigest, verifyVectorDigest } from "../scripts/vector-integrity.mjs";

test("vector digests bind exact bytes, failing closed on missing or changed content", () => {
  const bytes = new TextEncoder().encode("abc");
  const digest = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
  assert.equal(vectorDigest(bytes), digest);
  verifyVectorDigest(bytes, digest);
  assert.throws(() => verifyVectorDigest(new TextEncoder().encode("abd"), digest), /mismatch/);
  assert.throws(() => verifyVectorDigest(bytes, undefined), /missing digest/);
});

import { createHash } from "node:crypto";

export function vectorDigest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function verifyVectorDigest(bytes, expected) {
  if (
    typeof expected !== "string" ||
    !/^[0-9a-f]{64}$/.test(expected) ||
    vectorDigest(bytes) !== expected
  ) {
    throw new Error("Vector SHA-256 mismatch or missing digest");
  }
}

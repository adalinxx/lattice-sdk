import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes, equalBytes } from "./bytes.js";

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
const CID_VERSION = 1;
const DAG_CBOR_CODEC = 0x71;
const IDENTITY_HASH = 0x00;
const SHA2_256_HASH = 0x12;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31]!;
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31]!;
  return output;
}

export function base32Decode(value: string): Uint8Array {
  if (!/^[a-z2-7]+$/.test(value)) throw new Error("CID base32 must be lowercase and unpadded");
  const output: number[] = [];
  let bits = 0;
  let accumulator = 0;
  for (const character of value) {
    const digit = BASE32.indexOf(character);
    accumulator = (accumulator << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      output.push((accumulator >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  if (bits > 0 && (accumulator & ((1 << bits) - 1)) !== 0) {
    throw new Error("CID base32 has non-zero trailing bits");
  }
  return Uint8Array.from(output);
}

function encodeVarint(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("invalid CID varint");
  const output: number[] = [];
  let remaining = value;
  while (remaining >= 0x80) {
    output.push((remaining % 0x80) | 0x80);
    remaining = Math.floor(remaining / 0x80);
  }
  output.push(remaining);
  return Uint8Array.from(output);
}

function decodeVarint(
  bytes: Uint8Array,
  start: number,
): { readonly value: number; readonly end: number } {
  let value = 0;
  let multiplier = 1;
  let offset = start;
  while (true) {
    const byte = bytes[offset];
    if (byte === undefined || offset - start >= 9) throw new Error("invalid CID varint");
    value += (byte & 0x7f) * multiplier;
    if (!Number.isSafeInteger(value)) throw new Error("CID varint is too large");
    offset += 1;
    if ((byte & 0x80) === 0) break;
    multiplier *= 0x80;
  }
  if (!equalBytes(bytes.slice(start, offset), encodeVarint(value))) {
    throw new Error("CID contains a non-canonical varint");
  }
  return { value, end: offset };
}

export interface ParsedCID {
  readonly version: 1;
  readonly codec: number;
  readonly multihashCode: number;
  readonly digest: Uint8Array;
  readonly bytes: Uint8Array;
}

export function parseCID(cid: string): ParsedCID {
  if (!cid.startsWith("b")) throw new Error("CID must use lowercase base32 multibase");
  const bytes = base32Decode(cid.slice(1));
  if (`b${base32Encode(bytes)}` !== cid) throw new Error("CID is not canonical");
  const version = decodeVarint(bytes, 0);
  if (version.value !== CID_VERSION) throw new Error("only canonical CIDv1 is supported");
  const codec = decodeVarint(bytes, version.end);
  const algorithm = decodeVarint(bytes, codec.end);
  const length = decodeVarint(bytes, algorithm.end);
  const digest = bytes.slice(length.end);
  if (digest.length === 0 || digest.length !== length.value) {
    throw new Error("CID multihash length does not match its digest");
  }
  return {
    version: 1,
    codec: codec.value,
    multihashCode: algorithm.value,
    digest,
    bytes,
  };
}

export function cidV1(codec: number, blockBytes: Uint8Array): string {
  const digest = sha256(blockBytes);
  return `b${base32Encode(
    concatBytes(
      encodeVarint(CID_VERSION),
      encodeVarint(codec),
      encodeVarint(SHA2_256_HASH),
      encodeVarint(digest.length),
      digest,
    ),
  )}`;
}

export function cidV1DagCbor(blockBytes: Uint8Array): string {
  return cidV1(DAG_CBOR_CODEC, blockBytes);
}

export function dagCborCIDBytes(cid: string): Uint8Array {
  const parsed = parseCID(cid);
  if (
    parsed.codec !== DAG_CBOR_CODEC ||
    parsed.multihashCode !== SHA2_256_HASH ||
    parsed.digest.length !== 32
  ) {
    throw new Error("CID must be CIDv1 dag-cbor with a sha2-256 multihash");
  }
  return parsed.bytes;
}

export function verifyCID(cid: string, content: Uint8Array): boolean {
  try {
    const parsed = parseCID(cid);
    if (parsed.multihashCode === IDENTITY_HASH) return equalBytes(parsed.digest, content);
    if (parsed.multihashCode === SHA2_256_HASH && parsed.digest.length === 32) {
      return equalBytes(parsed.digest, sha256(content));
    }
    return false;
  } catch {
    return false;
  }
}

export function assertCID(cid: string, content: Uint8Array): void {
  if (!verifyCID(cid, content)) throw new Error(`content does not match CID ${cid}`);
}

export function verifyDagCborCID(cid: string, blockBytes: Uint8Array): boolean {
  try {
    dagCborCIDBytes(cid);
    return verifyCID(cid, blockBytes);
  } catch {
    return false;
  }
}

export function assertDagCborCID(cid: string, blockBytes: Uint8Array): void {
  if (!verifyDagCborCID(cid, blockBytes)) {
    throw new Error(`content does not match CID ${cid}`);
  }
}

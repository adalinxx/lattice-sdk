import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  SIGNATURE_DOMAIN,
  addressFromMultikey,
  buildTransfer,
  bytesToHex,
  cidV1DagCbor,
  decodeEd25519Multikey,
  encodeDagCbor,
  encodeEd25519Multikey,
  encodeSignedTransaction,
  encodeTransactionBody,
  hexToBytes,
  publicKeyFromPrivate,
  signPreimage,
  transactionSigningPreimage,
  utf8,
  verifyPreimage,
  type DagCborValue,
} from "@adalinxx/lattice-core";
import { verifyUint64SparseProof } from "@adalinxx/lattice-volumes";

const vectorDirectory = new URL("../.cache/lattice-vectors/", import.meta.url);
const load = (name: string): any =>
  JSON.parse(readFileSync(new URL(name, vectorDirectory), "utf8"));
const addresses = load("addresses.json");
const encoding = load("encoding.json");
const signing = load("signing.json");
const proofs = load("proofs.json");

function asDagCbor(value: unknown): DagCborValue {
  if (typeof value === "number") return BigInt(value);
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(asDagCbor);
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        asDagCbor(entry),
      ]),
    );
  }
  throw new Error("unsupported vector value");
}

const privateKeys = new Map<string, string>(
  addresses.vectors
    .filter((vector: { privateKey?: string }) => vector.privateKey !== undefined)
    .map((vector: { publicKey: string; privateKey: string }) => [
      vector.publicKey,
      vector.privateKey,
    ]),
);

for (const vector of addresses.vectors) {
  test(`address vector: ${vector.name}`, () => {
    assert.equal(encodeEd25519Multikey(hexToBytes(vector.publicKeyEd25519Hex)), vector.publicKey);
    assert.equal(
      bytesToHex(encodeDagCbor({ key: vector.publicKey })),
      vector.publicKeyNodeDagCborHex,
    );
    assert.equal(addressFromMultikey(vector.publicKey), vector.address);
    if (vector.privateKey !== undefined) {
      assert.equal(
        encodeEd25519Multikey(publicKeyFromPrivate(hexToBytes(vector.privateKey))),
        vector.publicKey,
      );
    }
  });
}

for (const vector of encoding.vectors) {
  test(`encoding vector: ${vector.name}`, () => {
    const bytes = encodeDagCbor(asDagCbor(vector.value));
    assert.equal(bytesToHex(bytes), vector.dagCborHex);
    assert.equal(cidV1DagCbor(bytes), vector.cid);
  });
}

for (const vector of encoding.vectors.filter(
  (candidate: { type: string }) => candidate.type === "Transaction",
)) {
  test(`signed transaction CID: ${vector.name}`, () => {
    // Feed the signatures in reverse with upper-case hex: the encoder must
    // normalize and sort them exactly as the node does.
    const signatures = Object.fromEntries(
      [...vector.value.signatures]
        .reverse()
        .map((entry: { key: string; value: string }) => [
          entry.key.toUpperCase(),
          entry.value.toUpperCase(),
        ]),
    );
    const encoded = encodeSignedTransaction(signatures, vector.value.body.rawCID);
    assert.equal(bytesToHex(encoded.bytes), vector.dagCborHex);
    assert.equal(encoded.cid, vector.cid);
  });
}

test("transfer builder reproduces the normative account-action vector", () => {
  const vector = encoding.vectors.find(
    (candidate: { name: string }) => candidate.name === "transaction-body/account-action",
  );
  const [debit, credit] = vector.value.accountActions;
  const body = buildTransfer({
    from: debit.owner,
    to: credit.owner,
    amount: BigInt(credit.delta),
    fee: BigInt(-debit.delta - credit.delta),
    nonce: BigInt(vector.value.nonce),
    chainPath: vector.value.chainPath,
  });
  const encoded = encodeTransactionBody(body);
  assert.equal(bytesToHex(encoded.bytes), vector.dagCborHex);
  assert.equal(encoded.cid, vector.cid);
});

const bodiesByCID = new Map<string, { nonce: number; chainPath: string[] }>(
  encoding.vectors
    .filter((vector: { type: string }) => vector.type === "TransactionBody")
    .map((vector: { cid: string; value: { nonce: number; chainPath: string[] } }) => [
      vector.cid,
      vector.value,
    ]),
);

for (const vector of signing.vectors) {
  test(`signing vector: ${vector.name}`, () => {
    assert.equal(bytesToHex(utf8(SIGNATURE_DOMAIN + vector.message)), vector.signedBytesHex);
    let verifies = false;
    try {
      verifies =
        /^[0-9a-f]{128}$/.test(vector.signature) &&
        verifyPreimage(vector.message, vector.signature, decodeEd25519Multikey(vector.publicKey));
    } catch {
      verifies = false;
    }
    if (vector.scheme === "transaction") {
      assert.equal(
        cidV1DagCbor(hexToBytes(vector.transactionBodyDagCborHex)),
        vector.transactionBodyCid,
      );
      const body = bodiesByCID.get(vector.transactionBodyCid);
      if (body !== undefined) {
        verifies =
          verifies &&
          vector.message ===
            transactionSigningPreimage(
              vector.transactionBodyCid,
              body.chainPath,
              BigInt(body.nonce),
            );
      }
    }
    assert.equal(verifies, vector.valid);
    const privateKey = privateKeys.get(vector.publicKey);
    if (vector.valid && privateKey !== undefined) {
      assert.equal(signPreimage(vector.message, hexToBytes(privateKey)), vector.signature);
    }
  });
}

for (const vector of proofs.vectors) {
  test(`sparse-proof vector: ${vector.name}`, () => {
    const verified = verifyUint64SparseProof({
      rootCID: vector.root,
      key: vector.key,
      ...(vector.value === undefined ? {} : { value: BigInt(vector.value) }),
      entries: vector.entries.map((entry: { cid: string; dagCborHex: string }) => ({
        cid: entry.cid,
        bytes: hexToBytes(entry.dagCborHex),
      })),
    });
    assert.equal(verified, vector.valid);
  });
}

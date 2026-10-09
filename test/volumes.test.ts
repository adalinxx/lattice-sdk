import assert from "node:assert/strict";
import { test } from "node:test";

import { cidV1, cidV1DagCbor, encodeDagCbor } from "@adalinxx/lattice-core";
import {
  MemoryVolumeTransport,
  VolumeClient,
  VolumeError,
  verifyVolume,
} from "@adalinxx/lattice-volumes";

test("complete Volumes are CID-verified before use", async () => {
  const leafBytes = encodeDagCbor({ value: 42n });
  const leafCID = cidV1DagCbor(leafBytes);
  const rootBytes = encodeDagCbor({ child: { rawCID: leafCID } });
  const rootCID = cidV1DagCbor(rootBytes);
  const serialized = {
    rootCID,
    entries: [
      { cid: rootCID, bytes: rootBytes },
      { cid: leafCID, bytes: leafBytes },
    ],
  };
  const transport = new MemoryVolumeTransport([serialized]);
  const volume = await new VolumeClient(transport).get(rootCID);
  assert.equal(volume.size, 2);
  assert.deepEqual(
    volume.decodeRoot(),
    Object.assign(Object.create(null), {
      child: Object.assign(Object.create(null), { rawCID: leafCID }),
    }),
  );
});

test("a tampered member invalidates the whole Volume", () => {
  const bytes = encodeDagCbor({ value: 1n });
  const cid = cidV1DagCbor(bytes);
  const tampered = bytes.slice();
  tampered[tampered.length - 1] ^= 1;
  assert.throws(
    () => verifyVolume({ rootCID: cid, entries: [{ cid, bytes: tampered }] }),
    (error: unknown) => error instanceof VolumeError && error.code === "invalid-entry",
  );
});

test("a Volume must contain the requested root", () => {
  const rootBytes = encodeDagCbor({ root: true });
  const rootCID = cidV1DagCbor(rootBytes);
  const otherBytes = encodeDagCbor({ other: true });
  const otherCID = cidV1DagCbor(otherBytes);
  assert.throws(
    () => verifyVolume({ rootCID, entries: [{ cid: otherCID, bytes: otherBytes }] }),
    (error: unknown) => error instanceof VolumeError && error.code === "missing-root",
  );
});

test("Volume verification accepts non-DAG-CBOR members by CID", () => {
  const moduleBytes = Uint8Array.of(0x00, 0x61, 0x73, 0x6d);
  const moduleCID = cidV1(0x55, moduleBytes); // multicodec raw
  const volume = verifyVolume({
    rootCID: moduleCID,
    entries: [{ cid: moduleCID, bytes: moduleBytes }],
  });
  assert.deepEqual(volume.rootBytes(), moduleBytes);
  assert.throws(() => volume.decodeRoot(), /DAG-CBOR/);
});

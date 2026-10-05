# Lattice SDK

TypeScript-first developer SDK for building applications on Lattice.

This repository sits above the protocol and infrastructure repositories:

```text
Lattice              consensus, canonical encoding, proofs, conformance vectors
VolumeBroker / DHT   complete Volume storage and retrieval
lattice-node         chain runtime, bounded public reads, private operator writes
        ↓
lattice-sdk          application-facing composition of those capabilities
```

The SDK deliberately separates three capabilities:

1. **Read plane:** `@adalinxx/lattice-client` reads the node's unversioned,
   public, read-only JSON API. Consensus integers become JavaScript `bigint`s.
2. **Content plane:** `@adalinxx/lattice-volumes` accepts a content-service or
   DHT transport and validates every member of each complete Volume against its
   CID before exposing it.
3. **Submission plane:** `@adalinxx/lattice-relay` submits only through an
   application-selected third-party relay or private node. The read client has
   no submission method.

Canonical blocks, transactions, and state are not copied into a second JSON
content format. Node reads discover Volume roots; the content service/DHT
returns the complete Volumes; the SDK verifies and follows their authenticated
references.

## Packages

| Package                     | Responsibility                                                       |
| --------------------------- | -------------------------------------------------------------------- |
| `@adalinxx/lattice-core`    | DAG-CBOR, CIDs, addresses, Ed25519 signing, transaction construction |
| `@adalinxx/lattice-volumes` | Complete-Volume transport interface, bounds, and CID verification    |
| `@adalinxx/lattice-client`  | Read-only node API and node/content composition                      |
| `@adalinxx/lattice-relay`   | Explicit relay or private-node submission                            |
| `@adalinxx/lattice-sdk`     | Convenience re-export of the four packages                           |

Package names are reserved in the workspace but are not published yet.

## Example

```ts
import {
  LatticeClient,
  NodeClient,
  VolumeClient,
  type VolumeTransport,
} from "@adalinxx/lattice-sdk";

// Implement this adapter with the application's existing content service or
// DHT client. It must return one complete Volume boundary for the requested root.
const content: VolumeTransport = myContentService;

const client = new LatticeClient(
  new NodeClient("https://reads.example.org", ["Nexus"]),
  new VolumeClient(content),
);

const { view, volume } = await client.latestBlock();
console.log(view.height, volume.decodeRoot());
```

Transaction submission is a separate, explicit capability:

```ts
import {
  HTTPTransactionSubmitter,
  buildTransfer,
  signTransactionBody,
  signedTransactionCID,
  transactionPayload,
} from "@adalinxx/lattice-sdk";

const body = buildTransfer({
  from,
  to,
  amount: 1000n,
  fee: 2n,
  nonce,
  chainPath: ["Nexus"],
});
const signed = signTransactionBody(body, privateKey);
const payload = transactionPayload({ [signed.publicKey]: signed.signature }, body);

const relay = new HTTPTransactionSubmitter("https://relay.example.org/transactions");
const result = await relay.submit(payload);
// The node's reported CID is recomputable locally; don't trust it blindly.
if (result.transactionCID !== signedTransactionCID(payload.transaction.signatures, body)) {
  throw new Error("relay reported a different transaction");
}
```

## Conformance

`vectors.lock.json` pins the authoritative vectors from
[`adalinxx/Lattice`](https://github.com/adalinxx/Lattice/tree/main/Vectors).
Tests fetch that exact commit and reproduce every address, encoding, CID, and
signature vector. The SDK does not maintain an independent copy of consensus
fixtures.

```sh
npm install
npm test
```

To review a newer vector set:

```sh
npm run vectors:update
npm test
```

The lock-file change and any conformance change must be reviewed together.

## Status

This initial foundation implements canonical primitives, exact wire integers,
verified Volume boundaries, UInt64 sparse-proof verification, the read-only
node client, and explicit submission transports. Typed decoding and traversal
for every Lattice block and state wrapper are the next protocol-facing
additions; applications must not treat an unimplemented typed traversal as
verified state.

## License

MIT

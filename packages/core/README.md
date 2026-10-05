# @adalinxx/lattice-core

Canonical Lattice primitives for TypeScript: DAG-CBOR, CIDs, addresses,
Ed25519 signing, transaction construction, typed Block and LatticeState
decoding, proof-of-work checks, and block continuity checks.

```ts
import { buildTransfer, signTransactionBody } from "@adalinxx/lattice-core";
```

This package implements protocol-facing values. Applications should normally
start with [`@adalinxx/lattice-sdk`](https://github.com/adalinxx/lattice-sdk),
which also composes node reads and verified content retrieval.

MIT

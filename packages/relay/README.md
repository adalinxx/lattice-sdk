# @adalinxx/lattice-relay

Explicit transaction submission through an application-selected third-party
relay or private Lattice node.

```ts
import { HTTPTransactionSubmitter } from "@adalinxx/lattice-relay";

const relay = new HTTPTransactionSubmitter("https://relay.example.org/transactions");
const result = await relay.submit(payload);
```

Submission is deliberately separate from the public read client. Remote
origins require HTTPS; loopback HTTP is available for private-node development.

MIT

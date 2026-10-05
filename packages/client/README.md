# @adalinxx/lattice-client

Read-only Lattice node access composed with CID-verified Volume retrieval.

```ts
import { LatticeClient, NodeClient } from "@adalinxx/lattice-client";
import { HTTPVolumeTransport, VolumeClient } from "@adalinxx/lattice-volumes";

const client = new LatticeClient(
  new NodeClient("https://reads.example.org", ["Nexus"]),
  new VolumeClient(new HTTPVolumeTransport("https://content.example.org/volumes")),
);
const { view, canonical } = await client.latestBlock();
```

The package has no transaction-submission API. Use an application-selected
third-party relay or private node through `@adalinxx/lattice-relay`.

MIT

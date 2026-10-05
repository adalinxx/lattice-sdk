# @adalinxx/lattice-volumes

Verified complete-Volume retrieval for Lattice content services and DHTs.
Every member is checked against its CID before it is exposed.

```ts
import { HTTPVolumeTransport, VolumeClient } from "@adalinxx/lattice-volumes";

const volumes = new VolumeClient(
  new HTTPVolumeTransport("https://content.example.org/volumes", {
    chainPath: ["Nexus"],
  }),
);
const volume = await volumes.get(rootCID);
```

The HTTP transport uses Ivy's canonical binary complete-Volume archive. Native
applications can implement `VolumeTransport` directly over Ivy or a DHT.

MIT

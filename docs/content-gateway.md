# Content gateway contract

Lattice content remains a CID-addressed complete Volume. An HTTP gateway is a
bridge to Ivy/VolumeBroker for web and TypeScript clients; it is not a second
canonical-content API.

## Request

```http
GET /volumes/<root-CID>
Accept: application/vnd.lattice.volume
```

The gateway returns `404` when it cannot supply the complete Volume. It must
not return a partial Volume with `200`. Deployments may require an
`Authorization` header. SDK requests never follow redirects, so credentials
cannot be redirected to another host.

## Successful response

```http
200 OK
Content-Type: application/vnd.lattice.volume
Content-Length: <bounded archive length>
```

The body is Ivy's canonical `VolumeArchive`:

```text
UInt16BE entryCount
repeat entryCount times, strictly ascending by CID string:
  UInt16BE cidUTF8Length
  cidUTF8
  UInt32BE contentLength
  content
```

The archive is at most 64 MiB, contains at most 65,535 entries, contains no
duplicate CID, and includes the requested root. The SDK defaults to a tighter
4,096-entry application limit. It hashes every member against its CID before
returning the Volume.

`HTTPVolumeTransport` accepts HTTPS endpoints and loopback HTTP only. A native
application that speaks Ivy directly can implement `VolumeTransport` without
HTTP and receives the same post-retrieval verification.

A lattice-node gateway has one local Volume store per hosted chain. Pass the
same path used by `NodeClient` as `chainPath`; the transport sends it as the
node's `?chainPath=Nexus/Alpha` selector:

```ts
const path = ["Nexus", "Alpha"];
const node = new NodeClient("https://reads.example.org", path);
const content = new HTTPVolumeTransport("https://reads.example.org/volumes", {
  chainPath: path,
});
```

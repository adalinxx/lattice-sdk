import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  EndpointResolver,
  NodeClient,
  OPERATOR_DECLARED,
  declaredEndpointURL,
} from "@adalinxx/lattice-client";

const fixture = (name: string): string =>
  readFileSync(new URL(`fixtures/live/${name}`, import.meta.url), "utf8");

const READ = "https://lattice-mainnet-read.fly.dev";
const FOLLOWER = "https://lattice-mainnet-testnet.fly.dev";
const TIP = "bafyreicmsum2butkopy4xxyzxmirzkcagzjxi2cuubzzuyowk7uzq2sh7i";
const CHILD = "bafyreiaomyjl7iryqain2l4jkz4knp5cvukkhgrbngjfl53llkeql7dnb4";

type Routes = Record<string, string | (() => Response | Promise<Response>)>;

function network(routes: Routes, dialed: string[] = []) {
  return async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const key = `${url.origin}${url.pathname}?${url.searchParams.toString()}`;
    dialed.push(key);
    const route = routes[key];
    if (route === undefined) return new Response("{}", { status: 404 });
    if (typeof route === "function") {
      return new Promise((resolve, reject) => {
        // AbortSignal.timeout's timer does not hold the event loop open.
        const alive = setInterval(() => {}, 1_000);
        init?.signal?.addEventListener("abort", () => {
          clearInterval(alive);
          reject(init.signal?.reason);
        });
        Promise.resolve(route())
          .then(resolve, reject)
          .finally(() => clearInterval(alive));
      });
    }
    return new Response(route);
  };
}

const liveRoutes: Routes = {
  [`${READ}/api/chain/endpoints?chainPath=Nexus%2Ftestnet`]: fixture("read-endpoints-testnet.json"),
  [`${FOLLOWER}/api/block/${CHILD}?chainPath=Nexus%2Ftestnet`]: fixture("testnet-child-block.json"),
  [`${READ}/api/block/latest?chainPath=Nexus`]: fixture("read-latest.json"),
  [`${READ}/api/block/${TIP}/children?chainPath=Nexus`]: fixture("read-children.json"),
};

test("the live testnet declaration resolves once the follower serves the committed block", async () => {
  const dialed: string[] = [];
  const fetch = network(liveRoutes, dialed);
  const root = new NodeClient(READ, ["Nexus"], { fetch });
  const resolver = new EndpointResolver(root, { fetch });
  assert.deepEqual(await resolver.resolve(["Nexus", "testnet"]), [
    {
      url: FOLLOWER,
      chainPath: ["Nexus", "testnet"],
      committedBlock: CHILD,
      declaresSubmit: false,
      trust: OPERATOR_DECLARED,
    },
  ]);
  assert.equal(OPERATOR_DECLARED, "operator-declared, not independently verified");
  assert.deepEqual(dialed, [
    `${READ}/api/chain/endpoints?chainPath=Nexus%2Ftestnet`,
    `${FOLLOWER}/api/block/${CHILD}?chainPath=Nexus%2Ftestnet`,
  ]);
});

test("the tree walk finds children from the root's latest block commitments", async () => {
  const fetch = network(liveRoutes);
  const resolver = new EndpointResolver(new NodeClient(READ, ["Nexus"], { fetch }), {
    fetch,
    maximumDepth: 2,
  });
  const found = await resolver.tree();
  assert.deepEqual(
    found.map((entry) => [entry.chainPath.join("/"), entry.url]),
    [["Nexus/testnet", FOLLOWER]],
  );
});

test("a host that does not serve the committed block is not accepted", async () => {
  const forged = { ...JSON.parse(fixture("testnet-child-block.json")), hash: "bafyother" };
  const fetch = network({
    ...liveRoutes,
    [`${FOLLOWER}/api/block/${CHILD}?chainPath=Nexus%2Ftestnet`]: JSON.stringify(forged),
  });
  const resolver = new EndpointResolver(new NodeClient(READ, ["Nexus"], { fetch }), { fetch });
  assert.deepEqual(await resolver.resolve(["Nexus", "testnet"]), []);

  const wrongChain = { ...JSON.parse(fixture("testnet-child-block.json")), chain: ["Nexus"] };
  const fetch2 = network({
    ...liveRoutes,
    [`${FOLLOWER}/api/block/${CHILD}?chainPath=Nexus%2Ftestnet`]: JSON.stringify(wrongChain),
  });
  const resolver2 = new EndpointResolver(new NodeClient(READ, ["Nexus"], { fetch: fetch2 }), {
    fetch: fetch2,
  });
  assert.deepEqual(await resolver2.resolve(["Nexus", "testnet"]), []);
});

test("declared hosts that are not public HTTPS are never dialed", async () => {
  const declared = [
    "http://reads.example.org",
    "https://localhost:8080",
    "https://127.0.0.1",
    "https://2130706433",
    "https://10.1.2.3",
    "https://172.16.0.1",
    "https://192.168.1.1",
    "https://169.254.169.254",
    "https://100.64.0.1",
    "https://0.0.0.0",
    "https://[::1]",
    "https://[fe80::1]",
    "https://[fd00::1]",
    "https://[::ffff:127.0.0.1]",
    "https://[::ffff:10.0.0.1]",
    "https://[64:ff9b::a00:1]",
    "https://[2002:a00:1::1]",
    "https://[2001:0:4136:e378::1]",
    "https://[2001:db8::1]",
    "https://[100::1]",
    "https://198.51.100.7",
    "https://203.0.113.7",
    "https://192.0.2.7",
    "https://192.88.99.1",
    "https://0x7f.1",
    "https://intranet",
    "https://printer.local",
    "https://db.internal",
    "https://user:pass@reads.example.org",
    "https://reads.example.org/?x=1",
    "not a url",
  ];
  for (const url of declared) assert.equal(declaredEndpointURL(url), undefined, url);
  assert.equal(declaredEndpointURL("https://reads.example.org/"), "https://reads.example.org");
  assert.equal(declaredEndpointURL("https://8.8.8.8"), "https://8.8.8.8");
  assert.equal(declaredEndpointURL("https://192.0.1.1"), "https://192.0.1.1");
  assert.equal(declaredEndpointURL("https://[64:ff9b::808:808]"), "https://[64:ff9b::808:808]");
  assert.equal(declaredEndpointURL("https://[2002:808:808::1]"), "https://[2002:808:808::1]");
  assert.equal(declaredEndpointURL("https://[2001:4860::8888]"), "https://[2001:4860::8888]");

  const dialed: string[] = [];
  const fetch = network(
    {
      [`${READ}/api/chain/endpoints?chainPath=Nexus%2Ftestnet`]: JSON.stringify({
        chainPath: ["Nexus", "testnet"],
        committedBlock: CHILD,
        endpoints: declared,
        submitEndpoints: declared,
      }),
    },
    dialed,
  );
  const resolver = new EndpointResolver(new NodeClient(READ, ["Nexus"], { fetch }), { fetch });
  assert.deepEqual(await resolver.resolve(["Nexus", "testnet"]), []);
  assert.deepEqual(dialed, [`${READ}/api/chain/endpoints?chainPath=Nexus%2Ftestnet`]);
});

test("submit capability is declared data only, and a null committedBlock verifies nothing", async () => {
  const block = (chain: string[]) =>
    JSON.stringify({ ...JSON.parse(fixture("testnet-child-block.json")), chain });
  const fetch = network({
    [`${READ}/api/chain/endpoints?chainPath=Nexus%2Ftestnet`]: JSON.stringify({
      chainPath: ["Nexus", "testnet"],
      committedBlock: CHILD,
      endpoints: ["https://a.example.org", "https://b.example.org"],
      submitEndpoints: ["https://b.example.org/"],
    }),
    [`https://a.example.org/api/block/${CHILD}?chainPath=Nexus%2Ftestnet`]: block([
      "Nexus",
      "testnet",
    ]),
    [`https://b.example.org/api/block/${CHILD}?chainPath=Nexus%2Ftestnet`]: block([
      "Nexus",
      "testnet",
    ]),
  });
  const resolver = new EndpointResolver(new NodeClient(READ, ["Nexus"], { fetch }), { fetch });
  const resolved = await resolver.resolve(["Nexus", "testnet"]);
  assert.deepEqual(
    resolved.map((entry) => [entry.url, entry.declaresSubmit]),
    [
      ["https://a.example.org", false],
      ["https://b.example.org", true],
    ],
  );
  for (const entry of resolved) assert.equal("submit" in entry, false);

  const unanchored = network({
    [`${READ}/api/chain/endpoints?chainPath=Nexus%2Ftestnet`]: JSON.stringify({
      chainPath: ["Nexus", "testnet"],
      committedBlock: null,
      endpoints: ["https://a.example.org"],
      submitEndpoints: [],
    }),
  });
  const resolver2 = new EndpointResolver(new NodeClient(READ, ["Nexus"], { fetch: unanchored }), {
    fetch: unanchored,
  });
  assert.deepEqual(await resolver2.resolve(["Nexus", "testnet"]), []);
});

test("an older node without submitEndpoints reads as none", async () => {
  const resolver = new EndpointResolver(new NodeClient(READ, ["Nexus"]), {
    fetch: network({
      [`${READ}/api/chain/endpoints?chainPath=Nexus%2Ftestnet`]: JSON.stringify({
        chainPath: ["Nexus", "testnet"],
        committedBlock: CHILD,
        endpoints: [FOLLOWER],
      }),
    }),
  });
  const declared = await resolver.declared(READ, ["Nexus", "testnet"]);
  assert.deepEqual(declared.submitEndpoints, []);
});

test("an answer naming a different chain is refused", async () => {
  const resolver = new EndpointResolver(new NodeClient(READ, ["Nexus"]), {
    fetch: network({
      [`${READ}/api/chain/endpoints?chainPath=Nexus%2Ftestnet`]: JSON.stringify({
        chainPath: ["Nexus", "other"],
        committedBlock: CHILD,
        endpoints: [FOLLOWER],
        submitEndpoints: [],
      }),
    }),
  });
  await assert.rejects(resolver.declared(READ, ["Nexus", "testnet"]), /different chainPath/);
});

test("the walk recurses through verified hosts only, bounded and timed per request", async () => {
  const childBlock = (hash: string, chain: string[]) =>
    JSON.stringify({ ...JSON.parse(fixture("testnet-child-block.json")), hash, chain });
  const many = Array.from({ length: 20 }, (_, index) => `https://h${index}.example.org`);
  const dialed: string[] = [];
  const fetch = network(
    {
      [`${READ}/api/chain/endpoints?chainPath=Nexus%2FA`]: JSON.stringify({
        chainPath: ["Nexus", "A"],
        committedBlock: "bafyA",
        endpoints: ["https://a.example.org", "https://slow.example.org", ...many],
        submitEndpoints: [],
      }),
      [`https://a.example.org/api/block/bafyA?chainPath=Nexus%2FA`]: childBlock("bafyA", [
        "Nexus",
        "A",
      ]),
      [`https://slow.example.org/api/block/bafyA?chainPath=Nexus%2FA`]: () => new Promise(() => {}),
      [`https://a.example.org/api/chain/endpoints?chainPath=Nexus%2FA%2FB`]: JSON.stringify({
        chainPath: ["Nexus", "A", "B"],
        committedBlock: "bafyB",
        endpoints: ["https://b.example.org"],
        submitEndpoints: ["https://b.example.org"],
      }),
      [`https://b.example.org/api/block/bafyB?chainPath=Nexus%2FA%2FB`]: childBlock("bafyB", [
        "Nexus",
        "A",
        "B",
      ]),
    },
    dialed,
  );
  const resolver = new EndpointResolver(new NodeClient(READ, ["Nexus"], { fetch }), {
    fetch,
    timeoutMilliseconds: 50,
    maximumCandidates: 4,
  });
  const resolved = await resolver.resolve(["Nexus", "A", "B"]);
  assert.deepEqual(
    resolved.map((entry) => [entry.url, entry.chainPath.join("/"), entry.declaresSubmit]),
    [["https://b.example.org", "Nexus/A/B", true]],
  );
  const probes = dialed.filter((key) => key.includes("/api/block/bafyA"));
  assert.equal(probes.length, 4);
  // The slow host was never a source for the next level.
  assert.equal(dialed.filter((key) => key.startsWith("https://slow.")).length, 1);

  await assert.rejects(resolver.resolve(["Nexus"]), /descendant/);
  await assert.rejects(resolver.resolve(["Other", "A"]), /descendant/);
});

test("requests refuse redirects so a declared host cannot steer them elsewhere", async () => {
  const modes: (RequestRedirect | undefined)[] = [];
  const inner = network(liveRoutes);
  const fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    modes.push(init?.redirect);
    return inner(input, init);
  };
  const resolver = new EndpointResolver(new NodeClient(READ, ["Nexus"], { fetch }), { fetch });
  assert.equal((await resolver.resolve(["Nexus", "testnet"])).length, 1);
  assert.deepEqual(modes, ["error", "error"]);
});

test("with a lookup, a declared name resolving to a private address is never dialed", async () => {
  const dialed: string[] = [];
  const fetch = network(liveRoutes, dialed);
  const looked: string[] = [];
  const resolver = new EndpointResolver(new NodeClient(READ, ["Nexus"], { fetch }), {
    fetch,
    lookup: async (host) => {
      looked.push(host);
      return ["66.241.124.1", "10.0.0.5"];
    },
  });
  assert.deepEqual(await resolver.resolve(["Nexus", "testnet"]), []);
  assert.deepEqual(looked, ["lattice-mainnet-testnet.fly.dev"]);
  assert.equal(dialed.filter((key) => key.startsWith(FOLLOWER)).length, 0);

  const publicOnly = new EndpointResolver(new NodeClient(READ, ["Nexus"], { fetch }), {
    fetch,
    lookup: async () => ["66.241.124.1", "2a09:8280:1::1"],
  });
  assert.equal((await publicOnly.resolve(["Nexus", "testnet"])).length, 1);
});

test("a source naming a wrong committed block cannot spoil another source's candidate", async () => {
  const fetch = network({
    [`${READ}/api/chain/endpoints?chainPath=Nexus%2FA`]: JSON.stringify({
      chainPath: ["Nexus", "A"],
      committedBlock: "bafyA",
      endpoints: ["https://a.example.org", "https://b.example.org"],
      submitEndpoints: [],
    }),
    [`https://a.example.org/api/block/bafyA?chainPath=Nexus%2FA`]: JSON.stringify({
      ...JSON.parse(fixture("testnet-child-block.json")),
      hash: "bafyA",
      chain: ["Nexus", "A"],
    }),
    [`https://b.example.org/api/block/bafyA?chainPath=Nexus%2FA`]: JSON.stringify({
      ...JSON.parse(fixture("testnet-child-block.json")),
      hash: "bafyA",
      chain: ["Nexus", "A"],
    }),
    [`https://a.example.org/api/chain/endpoints?chainPath=Nexus%2FA%2FB`]: JSON.stringify({
      chainPath: ["Nexus", "A", "B"],
      committedBlock: "bafyWrong",
      endpoints: ["https://c.example.org"],
      submitEndpoints: [],
    }),
    [`https://b.example.org/api/chain/endpoints?chainPath=Nexus%2FA%2FB`]: JSON.stringify({
      chainPath: ["Nexus", "A", "B"],
      committedBlock: "bafyB",
      endpoints: ["https://c.example.org"],
      submitEndpoints: [],
    }),
    [`https://c.example.org/api/block/bafyB?chainPath=Nexus%2FA%2FB`]: JSON.stringify({
      ...JSON.parse(fixture("testnet-child-block.json")),
      hash: "bafyB",
      chain: ["Nexus", "A", "B"],
    }),
  });
  const resolver = new EndpointResolver(new NodeClient(READ, ["Nexus"], { fetch }), { fetch });
  assert.deepEqual(
    (await resolver.resolve(["Nexus", "A", "B"])).map((entry) => [entry.url, entry.committedBlock]),
    [["https://c.example.org", "bafyB"]],
  );
});

test("a walk stops at its request budget however wide the declared tree is", async () => {
  let requests = 0;
  const fetch = async (input: string | URL): Promise<Response> => {
    requests += 1;
    const url = new URL(input);
    const path = (url.searchParams.get("chainPath") ?? "").split("/");
    if (url.pathname === "/api/block/latest") {
      return new Response(
        JSON.stringify({ height: "1", hash: "bafytip", transactionCount: 0, timestamp: "1" }),
      );
    }
    if (url.pathname.endsWith("/children")) {
      return new Response(
        JSON.stringify({
          children: Array.from({ length: 50 }, (_, index) => ({
            directory: `c${index}`,
            blockHash: "bafychild",
          })),
        }),
      );
    }
    if (url.pathname === "/api/chain/endpoints") {
      return new Response(
        JSON.stringify({
          chainPath: path,
          committedBlock: "bafychild",
          endpoints: Array.from({ length: 20 }, (_, index) => `https://h${index}.example.org`),
          submitEndpoints: [],
        }),
      );
    }
    return new Response(
      JSON.stringify({
        ...JSON.parse(fixture("testnet-child-block.json")),
        hash: "bafychild",
        chain: path,
      }),
    );
  };
  const resolver = new EndpointResolver(new NodeClient(READ, ["Nexus"], { fetch }), {
    fetch,
    maximumRequests: 30,
  });
  const found = await resolver.tree();
  assert.ok(requests <= 30, `made ${requests} requests`);
  assert.ok(found.length > 0);
});

test("a lookup that never answers is timed like any request", async () => {
  const fetch = network(liveRoutes);
  const resolver = new EndpointResolver(new NodeClient(READ, ["Nexus"], { fetch }), {
    fetch,
    timeoutMilliseconds: 50,
    lookup: (_host, signal) =>
      new Promise(() => {
        const alive = setInterval(() => {}, 1_000);
        signal?.addEventListener("abort", () => clearInterval(alive));
      }),
  });
  assert.deepEqual(await resolver.resolve(["Nexus", "testnet"]), []);
});

test("the resolver's default fetch is called with a valid receiver", async () => {
  const original = globalThis.fetch;
  const routed = network(liveRoutes);
  globalThis.fetch = function (this: unknown, input: string | URL, init?: RequestInit) {
    // Browsers throw "Illegal invocation" when fetch's receiver is not the global.
    if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
    return routed(input, init);
  } as typeof fetch;
  try {
    const resolver = new EndpointResolver(new NodeClient(READ, ["Nexus"]));
    assert.equal((await resolver.resolve(["Nexus", "testnet"]))[0]?.url, FOLLOWER);
  } finally {
    globalThis.fetch = original;
  }
});

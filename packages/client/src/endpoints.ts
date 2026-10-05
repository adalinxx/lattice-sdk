import { getJSON } from "./http.js";
import { type Fetch, NodeClient, normalizeNodeURL } from "./node-client.js";
import { optionalString, record, stringArray } from "./wire.js";

/**
 * Operator-declared read endpoints of child chains.
 *
 * This module is deliberately separate from `NodeClient`: a declared URL is a
 * third party's claim relayed by the node, not something the node vouches
 * for. The resolver accepts a declared host only after it serves the block the
 * parent chain commits for that child, and even then the result is labeled
 * {@link OPERATOR_DECLARED}. Submit capability is reported as data only; a
 * caller that wants to send a transaction must construct a
 * `TransactionSubmitter` itself.
 */
export const OPERATOR_DECLARED = "operator-declared, not independently verified" as const;

/** The raw `GET /api/chain/endpoints?chainPath=P/D` answer. */
export interface DeclaredEndpoints {
  readonly chainPath: readonly string[];
  /** Absent when the answering node hosts the child but its parent commits none recently. */
  readonly committedBlock?: string;
  readonly endpoints: readonly string[];
  readonly submitEndpoints: readonly string[];
}

export function parseDeclaredEndpoints(value: unknown): DeclaredEndpoints {
  const body = record(value, "endpoints");
  const committedBlock =
    body.committedBlock === null
      ? undefined
      : optionalString(body.committedBlock, "endpoints.committedBlock");
  return {
    chainPath: stringArray(body.chainPath, "endpoints.chainPath"),
    ...(committedBlock === undefined ? {} : { committedBlock }),
    endpoints: stringArray(body.endpoints, "endpoints.endpoints"),
    // A node predating the field omits it; that reads as empty.
    submitEndpoints:
      body.submitEndpoints === undefined
        ? []
        : stringArray(body.submitEndpoints, "endpoints.submitEndpoints"),
  };
}

/** A declared host that served the committed child block. */
export interface ResolvedEndpoint {
  readonly url: string;
  readonly chainPath: readonly string[];
  /** The parent-committed child block this host served. */
  readonly committedBlock: string;
  /** The host's declared `POST /transactions` support; unverified data only. */
  readonly declaresSubmit: boolean;
  readonly trust: typeof OPERATOR_DECLARED;
}

export interface EndpointResolverOptions {
  readonly fetch?: Fetch;
  /** Per request. */
  readonly timeoutMilliseconds?: number;
  readonly maximumResponseBytes?: number;
  /** Declared URLs probed per child, across all parent sources. */
  readonly maximumCandidates?: number;
  /** Verified hosts of one level asked about the next level. */
  readonly maximumSources?: number;
  /** Child directories followed per chain by {@link EndpointResolver.tree}. */
  readonly maximumChildren?: number;
  /** Levels below the root walked by {@link EndpointResolver.tree}. */
  readonly maximumDepth?: number;
}

function ipv4(host: string): number[] | undefined {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^[0-9]{1,3}$/.test(part))) return undefined;
  const octets = parts.map(Number);
  return octets.every((octet) => octet <= 255) ? octets : undefined;
}

function publicIPv4([a, b]: number[]): boolean {
  if (a === undefined || b === undefined) return false;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function publicIPv6(host: string): boolean {
  // WHATWG URL parsing has already canonicalized the literal.
  if (host === "::" || host === "::1") return false;
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (mapped !== null) {
    const high = parseInt(mapped[1]!, 16);
    const low = parseInt(mapped[2]!, 16);
    return publicIPv4([high >> 8, high & 0xff, low >> 8, low & 0xff]);
  }
  const first = parseInt(host.split(":")[0] || "0", 16);
  return !(
    (first & 0xfe00) === 0xfc00 || // unique local
    (first & 0xffc0) === 0xfe80 || // link local
    (first & 0xffc0) === 0xfec0 || // site local
    (first & 0xff00) === 0xff00 || // multicast
    first === 0 // unspecified, loopback, IPv4-compatible/mapped
  );
}

/**
 * A third party's declared read URL, or undefined when it must not be dialed:
 * HTTPS only, a public host only (no loopback, private, link-local, or
 * single-label names), no credentials, query, or fragment.
 */
export function declaredEndpointURL(input: string): string | undefined {
  let normalized: string;
  let url: URL;
  try {
    normalized = normalizeNodeURL(input);
    url = new URL(normalized);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:") return undefined;
  const host = url.hostname.toLowerCase();
  if (host.startsWith("[")) return publicIPv6(host.slice(1, -1)) ? normalized : undefined;
  const octets = ipv4(host);
  if (octets !== undefined) return publicIPv4(octets) ? normalized : undefined;
  const name = host.replace(/\.$/, "");
  if (!name.includes(".")) return undefined;
  if (/\.(?:localhost|local|internal|home\.arpa)$/.test(name)) return undefined;
  return normalized;
}

function childPath(parent: readonly string[], directory: string): string[] {
  if (directory.length === 0 || directory.includes("/")) {
    throw new TypeError("child directory must be one non-empty path component");
  }
  return [...parent, directory];
}

function samePath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

/**
 * Walks operator-declared endpoints down from a caller-chosen root node. The
 * root is the only host trusted to be dialed as given; every other host is a
 * declared URL that passed {@link declaredEndpointURL} and served the
 * committed child block.
 */
export class EndpointResolver {
  readonly root: NodeClient;
  readonly #fetch: Fetch;
  readonly #timeoutMilliseconds: number;
  readonly #maximumResponseBytes: number;
  readonly #maximumCandidates: number;
  readonly #maximumSources: number;
  readonly #maximumChildren: number;
  readonly #maximumDepth: number;

  constructor(root: NodeClient, options: EndpointResolverOptions = {}) {
    this.root = root;
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMilliseconds = options.timeoutMilliseconds ?? 4_000;
    this.#maximumResponseBytes = options.maximumResponseBytes ?? 64 * 1024;
    this.#maximumCandidates = options.maximumCandidates ?? 8;
    this.#maximumSources = options.maximumSources ?? 4;
    this.#maximumChildren = options.maximumChildren ?? 16;
    this.#maximumDepth = options.maximumDepth ?? 4;
  }

  #client(baseURL: string, chainPath: readonly string[]): NodeClient {
    return new NodeClient(baseURL, chainPath, {
      fetch: this.#fetch,
      timeoutMilliseconds: this.#timeoutMilliseconds,
      maximumResponseBytes: this.#maximumResponseBytes,
    });
  }

  /** One node's raw, unverified declaration for `chainPath`. */
  async declared(
    sourceURL: string,
    chainPath: readonly string[],
    signal?: AbortSignal,
  ): Promise<DeclaredEndpoints> {
    const url = new URL(`${normalizeNodeURL(sourceURL)}/api/chain/endpoints`);
    url.searchParams.set("chainPath", chainPath.join("/"));
    const declared = parseDeclaredEndpoints(
      await getJSON(
        this.#fetch,
        url,
        this.#timeoutMilliseconds,
        this.#maximumResponseBytes,
        signal,
      ),
    );
    if (!samePath(declared.chainPath, chainPath)) {
      throw new TypeError("endpoints answer names a different chainPath");
    }
    return declared;
  }

  /** Whether `baseURL` serves `committedBlock` on `chainPath`. */
  async #serves(
    baseURL: string,
    chainPath: readonly string[],
    committedBlock: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    try {
      const block = await this.#client(baseURL, chainPath).block(committedBlock, signal);
      return block.hash === committedBlock && samePath(block.chain, chainPath);
    } catch {
      return false;
    }
  }

  /** Verified endpoints of `parentSources`' child `chainPath`. */
  async #level(
    parentSources: readonly string[],
    chainPath: readonly string[],
    signal?: AbortSignal,
  ): Promise<ResolvedEndpoint[]> {
    const answers = await Promise.all(
      parentSources.slice(0, this.#maximumSources).map(async (source) => {
        try {
          return await this.declared(source, chainPath, signal);
        } catch {
          return undefined;
        }
      }),
    );
    const candidates = new Map<string, { committedBlock: string; declaresSubmit: boolean }>();
    for (const answer of answers) {
      if (answer?.committedBlock === undefined) continue;
      const submit = new Set(answer.submitEndpoints.map(declaredEndpointURL));
      for (const declared of answer.endpoints) {
        if (candidates.size >= this.#maximumCandidates) break;
        const url = declaredEndpointURL(declared);
        if (url === undefined || candidates.has(url)) continue;
        candidates.set(url, {
          committedBlock: answer.committedBlock,
          declaresSubmit: submit.has(url),
        });
      }
    }
    const verified = await Promise.all(
      [...candidates].map(async ([url, { committedBlock, declaresSubmit }]) =>
        (await this.#serves(url, chainPath, committedBlock, signal))
          ? {
              url,
              chainPath: [...chainPath],
              committedBlock,
              declaresSubmit,
              trust: OPERATOR_DECLARED,
            }
          : undefined,
      ),
    );
    return verified.filter((entry) => entry !== undefined);
  }

  /**
   * Verified declared endpoints for `chainPath`, which must extend the root's
   * chain path. Each level's verified hosts are asked about the next level.
   */
  async resolve(chainPath: readonly string[], signal?: AbortSignal): Promise<ResolvedEndpoint[]> {
    const rootPath = this.root.chainPath;
    if (
      chainPath.length <= rootPath.length ||
      !samePath(chainPath.slice(0, rootPath.length), rootPath)
    ) {
      throw new RangeError("chainPath must name a descendant of the root's chain");
    }
    if (chainPath.some((part) => part.length === 0 || part.includes("/"))) {
      throw new RangeError("chainPath components must be non-empty and contain no '/'");
    }
    let sources = [this.root.baseURL];
    let resolved: ResolvedEndpoint[] = [];
    for (let depth = rootPath.length + 1; depth <= chainPath.length; depth += 1) {
      const level = chainPath.slice(0, depth);
      resolved = await this.#level(sources, level, signal);
      if (resolved.length === 0) return [];
      sources = resolved.map((entry) => entry.url);
    }
    return resolved;
  }

  /**
   * Breadth-first walk of the hosted tree below the root: children come from
   * a source's latest block commitments (`/api/block/:cid/children`), bounded
   * by depth and per-chain child count.
   */
  async tree(signal?: AbortSignal): Promise<ResolvedEndpoint[]> {
    const found: ResolvedEndpoint[] = [];
    let frontier: { path: readonly string[]; sources: readonly string[] }[] = [
      { path: this.root.chainPath, sources: [this.root.baseURL] },
    ];
    for (let depth = 0; depth < this.#maximumDepth && frontier.length > 0; depth += 1) {
      const next: typeof frontier = [];
      for (const { path, sources } of frontier) {
        const directories = await this.#childDirectories(sources, path, signal);
        for (const directory of directories) {
          const level = childPath(path, directory);
          const resolved = await this.#level(sources, level, signal);
          found.push(...resolved);
          if (resolved.length > 0) next.push({ path: level, sources: resolved.map((e) => e.url) });
        }
      }
      frontier = next;
    }
    return found;
  }

  async #childDirectories(
    sources: readonly string[],
    chainPath: readonly string[],
    signal?: AbortSignal,
  ): Promise<string[]> {
    for (const source of sources.slice(0, this.#maximumSources)) {
      try {
        const client = this.#client(source, chainPath);
        const latest = await client.latestBlock(signal);
        const directories = new Set<string>();
        for (const child of await client.children(latest.hash, signal)) {
          if (child.directory.length === 0 || child.directory.includes("/")) continue;
          directories.add(child.directory);
          if (directories.size >= this.#maximumChildren) break;
        }
        return [...directories];
      } catch {
        continue;
      }
    }
    return [];
  }
}

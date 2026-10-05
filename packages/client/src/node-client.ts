import {
  type AccountState,
  type BlockChild,
  type BlocksPage,
  type BlockView,
  type ChainInfo,
  type LatestBlockView,
  type NodeStatus,
  type TransactionProjection,
  parseAccount,
  parseBlock,
  parseBlockChildren,
  parseBlocksPage,
  parseChainInfo,
  parseLatestBlock,
  parseNodeStatus,
  parseTransactionProjection,
} from "./models.js";
import { type Fetch, getJSON } from "./http.js";

export { type Fetch, NodeError } from "./http.js";
import { integer, record, string, stringArray } from "./wire.js";

export interface NodeClientOptions {
  readonly fetch?: Fetch;
  readonly timeoutMilliseconds?: number;
  readonly maximumResponseBytes?: number;
}

function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "::1" || /^127(?:\.[0-9]{1,3}){3}$/.test(host);
}

export function normalizeNodeURL(input: string): string {
  const url = new URL(input);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("node URL must not contain credentials, a query, or a fragment");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) {
    throw new Error("node URL must use HTTPS, except for loopback HTTP");
  }
  return url.toString().replace(/\/$/, "");
}

export class NodeClient {
  readonly baseURL: string;
  readonly chainPath: readonly string[];
  readonly #fetch: Fetch;
  readonly #timeoutMilliseconds: number;
  readonly #maximumResponseBytes: number;

  constructor(baseURL: string, chainPath: readonly string[], options: NodeClientOptions = {}) {
    if (chainPath.length === 0) throw new Error("chainPath must not be empty");
    this.baseURL = normalizeNodeURL(baseURL);
    this.chainPath = [...chainPath];
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#timeoutMilliseconds = options.timeoutMilliseconds ?? 8_000;
    this.#maximumResponseBytes = options.maximumResponseBytes ?? 4 * 1024 * 1024;
  }

  #url(path: string, parameters: Readonly<Record<string, string>> = {}): URL {
    const url = new URL(`${this.baseURL}${path}`);
    url.searchParams.set("chainPath", this.chainPath.join("/"));
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    return url;
  }

  async #request(
    path: string,
    parser: (value: unknown) => unknown,
    signal?: AbortSignal,
    parameters: Readonly<Record<string, string>> = {},
  ): Promise<unknown> {
    return parser(
      await getJSON(
        this.#fetch,
        this.#url(path, parameters),
        this.#timeoutMilliseconds,
        this.#maximumResponseBytes,
        signal,
      ),
    );
  }

  health(signal?: AbortSignal): Promise<NodeStatus> {
    return this.#request("/health", parseNodeStatus, signal) as Promise<NodeStatus>;
  }

  block(id: string | bigint, signal?: AbortSignal): Promise<BlockView> {
    return this.#request(
      `/api/block/${encodeURIComponent(id.toString())}`,
      parseBlock,
      signal,
    ) as Promise<BlockView>;
  }

  latestBlock(signal?: AbortSignal): Promise<LatestBlockView> {
    return this.#request("/api/block/latest", parseLatestBlock, signal) as Promise<LatestBlockView>;
  }

  /**
   * A page of canonical block summaries, newest first. `before` is exclusive;
   * `limit` is 1...25 (the node's cap). The page is presentation: rows must
   * descend strictly below `before` and never exceed `limit`.
   */
  async blocks(
    options: { readonly before?: bigint; readonly limit?: number } = {},
    signal?: AbortSignal,
  ): Promise<BlocksPage> {
    const { before, limit } = options;
    if (before !== undefined && before < 0n) throw new RangeError("before must not be negative");
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > 25)) {
      throw new RangeError("limit must be an integer from 1 to 25");
    }
    const page = (await this.#request("/api/blocks", parseBlocksPage, signal, {
      ...(before === undefined ? {} : { before: before.toString() }),
      ...(limit === undefined ? {} : { limit: limit.toString() }),
    })) as BlocksPage;
    if (page.blocks.length > (limit ?? 25)) throw new TypeError("blocks page exceeds its limit");
    let ceiling = before;
    for (const row of page.blocks) {
      if (ceiling !== undefined && row.height >= ceiling) {
        throw new TypeError("blocks page is not strictly descending below before");
      }
      ceiling = row.height;
    }
    if (
      page.nextBefore !== undefined &&
      (page.nextBefore < 1n || (ceiling !== undefined && page.nextBefore > ceiling))
    ) {
      throw new TypeError("blocks.nextBefore does not continue the page");
    }
    return page;
  }

  /** Child commitments of a block at this client's chain level. */
  children(blockCID: string, signal?: AbortSignal): Promise<BlockChild[]> {
    return this.#request(
      `/api/block/${encodeURIComponent(blockCID)}/children`,
      parseBlockChildren,
      signal,
    ) as Promise<BlockChild[]>;
  }

  account(owner: string, signal?: AbortSignal): Promise<AccountState> {
    return this.#request(
      `/api/state/account/${encodeURIComponent(owner)}`,
      parseAccount,
      signal,
    ) as Promise<AccountState>;
  }

  transaction(cid: string, signal?: AbortSignal): Promise<TransactionProjection> {
    return this.#request(
      `/api/transaction/${encodeURIComponent(cid)}`,
      parseTransactionProjection,
      signal,
    ) as Promise<TransactionProjection>;
  }

  transactionContent(
    cid: string,
    signal?: AbortSignal,
  ): Promise<{ readonly cid: string; readonly bodyCID: string }> {
    return this.#request(
      `/transactions/${encodeURIComponent(cid)}`,
      (value) => {
        const response = record(value, "transaction response");
        const transaction = record(response.transaction, "transaction response.transaction");
        const body = record(transaction.body, "transaction response.transaction.body");
        return {
          cid: string(response.cid, "transaction response.cid"),
          bodyCID: string(body.rawCID, "transaction response.transaction.body.rawCID"),
        };
      },
      signal,
    ) as Promise<{ readonly cid: string; readonly bodyCID: string }>;
  }

  chainInfo(signal?: AbortSignal): Promise<ChainInfo> {
    return this.#request("/api/chain/info", parseChainInfo, signal) as Promise<ChainInfo>;
  }

  mempool(
    signal?: AbortSignal,
  ): Promise<{ readonly count: number; readonly transactions: string[] }> {
    return this.#request(
      "/api/mempool",
      (value) => {
        const body = record(value, "mempool");
        return {
          count: integer(body.count, "mempool.count"),
          transactions: stringArray(body.transactions, "mempool.transactions"),
        };
      },
      signal,
    ) as Promise<{ readonly count: number; readonly transactions: string[] }>;
  }
}

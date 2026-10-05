import {
  type AccountState,
  type BlockView,
  type ChainInfo,
  type NodeStatus,
  type TransactionProjection,
  parseAccount,
  parseBlock,
  parseChainInfo,
  parseNodeStatus,
  parseTransactionProjection,
} from "./models.js";
import { integer, record, string, stringArray } from "./wire.js";

export type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface NodeClientOptions {
  readonly fetch?: Fetch;
  readonly timeoutMilliseconds?: number;
  readonly maximumResponseBytes?: number;
}

export class NodeError extends Error {
  readonly status: number;
  readonly refusal?: string;

  constructor(status: number, refusal?: string) {
    super(refusal ?? `HTTP ${status}`);
    this.name = "NodeError";
    this.status = status;
    if (refusal !== undefined) this.refusal = refusal;
  }
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

function refusal(text: string): string | undefined {
  try {
    const body = record(JSON.parse(text));
    const error = body.error;
    if (typeof error === "string") return error;
    if (error !== undefined) {
      const message = record(error).message;
      if (typeof message === "string") return message;
    }
  } catch {
    // The status remains useful even when the response is not JSON.
  }
  return undefined;
}

async function boundedText(response: Response, maximumBytes: number): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > maximumBytes) {
    throw new NodeError(response.status, "response too large");
  }
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel();
      throw new NodeError(response.status, "response too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
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
    this.#fetch = options.fetch ?? fetch;
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
  ): Promise<unknown> {
    const timeout = AbortSignal.timeout(this.#timeoutMilliseconds);
    const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
    const response = await this.#fetch(this.#url(path), {
      headers: { Accept: "application/json" },
      signal: combined,
    });
    const text = await boundedText(response, this.#maximumResponseBytes);
    if (!response.ok) throw new NodeError(response.status, refusal(text));
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new NodeError(response.status, "invalid JSON response");
    }
    return parser(value);
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

  latestBlock(signal?: AbortSignal): Promise<unknown> {
    return this.#request("/api/block/latest", (value) => value, signal);
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

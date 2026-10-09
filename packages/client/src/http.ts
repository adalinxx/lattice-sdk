import { record } from "./wire.js";

export type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

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

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

async function boundedText(
  response: Response,
  maximumBytes: number,
  signal: AbortSignal,
): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > maximumBytes) {
    throw new NodeError(response.status, "response too large");
  }
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        throw new NodeError(response.status, "response too large");
      }
      chunks.push(value);
    }
  } catch (error) {
    // A hostile injected stream may also hang in cancel; never await it.
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export interface JSONRequestOptions {
  fetch?: Fetch;
  timeoutMilliseconds?: number;
  maximumResponseBytes?: number;
  signal?: AbortSignal | undefined;
  authorization?: string | undefined;
}

/** Bounded JSON GET. Callers must validate/normalize the base URL themselves;
 * this transport primitive deliberately permits query-bearing route URLs. */
export async function getJSON(url: URL, options: JSONRequestOptions = {}): Promise<unknown> {
  const {
    fetch = globalThis.fetch.bind(globalThis),
    timeoutMilliseconds = 8000,
    maximumResponseBytes = 4 * 1024 * 1024,
    signal,
    authorization,
  } = options;
  if (
    !Number.isInteger(timeoutMilliseconds) ||
    timeoutMilliseconds <= 0 ||
    !Number.isSafeInteger(maximumResponseBytes) ||
    maximumResponseBytes <= 0
  )
    throw new RangeError("Invalid JSON request limits");
  const timeout = AbortSignal.timeout(timeoutMilliseconds);
  const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
  combined.throwIfAborted();
  const response = await abortable(
    fetch(url, {
      headers: {
        Accept: "application/json",
        ...(authorization === undefined ? {} : { Authorization: authorization }),
      },
      // A redirect would let any answering host steer the request to another
      // host or scheme; node routes never redirect.
      redirect: "error",
      signal: combined,
    }),
    combined,
  );
  const text = await boundedText(response, maximumResponseBytes, combined);
  if (!response.ok) throw new NodeError(response.status, refusal(text));
  try {
    return JSON.parse(text);
  } catch {
    throw new NodeError(response.status, "invalid JSON response");
  }
}

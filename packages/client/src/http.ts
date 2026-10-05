import { NodeError, type Fetch } from "./node-client.js";
import { record } from "./wire.js";

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

/** One bounded, timed GET whose body must be JSON; a non-2xx is a NodeError. */
export async function getJSON(
  fetch: Fetch,
  url: URL,
  timeoutMilliseconds: number,
  maximumResponseBytes: number,
  signal?: AbortSignal,
): Promise<unknown> {
  const timeout = AbortSignal.timeout(timeoutMilliseconds);
  const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: combined,
  });
  const text = await boundedText(response, maximumResponseBytes);
  if (!response.ok) throw new NodeError(response.status, refusal(text));
  try {
    return JSON.parse(text);
  } catch {
    throw new NodeError(response.status, "invalid JSON response");
  }
}

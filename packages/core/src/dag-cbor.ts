import { concatBytes, utf8 } from "./bytes.js";

export type DagCborValue =
  | null
  | boolean
  | number
  | bigint
  | string
  | Uint8Array
  | readonly DagCborValue[]
  | { readonly [key: string]: DagCborValue };

function unsigned(value: bigint, major: number): Uint8Array {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
    throw new Error("DAG-CBOR integer is outside the 64-bit range");
  }
  const prefix = major << 5;
  if (value < 24n) return Uint8Array.of(prefix | Number(value));
  if (value <= 0xffn) return Uint8Array.of(prefix | 24, Number(value));
  if (value <= 0xffffn) {
    return Uint8Array.of(prefix | 25, Number(value >> 8n), Number(value & 0xffn));
  }
  if (value <= 0xffff_ffffn) {
    return Uint8Array.of(
      prefix | 26,
      Number((value >> 24n) & 0xffn),
      Number((value >> 16n) & 0xffn),
      Number((value >> 8n) & 0xffn),
      Number(value & 0xffn),
    );
  }
  const output = new Uint8Array(9);
  output[0] = prefix | 27;
  let remaining = value;
  for (let index = 8; index >= 1; index -= 1) {
    output[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return output;
}

function integer(value: bigint): Uint8Array {
  return value >= 0n ? unsigned(value, 0) : unsigned(-1n - value, 1);
}

function compareMapKeys(left: string, right: string): number {
  const leftBytes = utf8(left);
  const rightBytes = utf8(right);
  if (leftBytes.length !== rightBytes.length) return leftBytes.length - rightBytes.length;
  for (let index = 0; index < leftBytes.length; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return leftBytes[index]! - rightBytes[index]!;
  }
  return 0;
}

export function encodeDagCbor(value: DagCborValue): Uint8Array {
  if (value === null) return Uint8Array.of(0xf6);
  if (typeof value === "boolean") return Uint8Array.of(value ? 0xf5 : 0xf4);
  if (typeof value === "bigint") return integer(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("DAG-CBOR numbers must be safe integers");
    return integer(BigInt(value));
  }
  if (typeof value === "string") {
    const bytes = utf8(value);
    return concatBytes(unsigned(BigInt(bytes.length), 3), bytes);
  }
  if (value instanceof Uint8Array) {
    return concatBytes(unsigned(BigInt(value.length), 2), value);
  }
  if (Array.isArray(value)) {
    return concatBytes(
      unsigned(BigInt(value.length), 4),
      ...value.map((entry) => encodeDagCbor(entry)),
    );
  }
  const record = value as { readonly [key: string]: DagCborValue };
  const keys = Object.keys(record).sort(compareMapKeys);
  const parts: Uint8Array[] = [unsigned(BigInt(keys.length), 5)];
  for (const key of keys) {
    parts.push(encodeDagCbor(key), encodeDagCbor(record[key]!));
  }
  return concatBytes(...parts);
}

class Decoder {
  readonly #bytes: Uint8Array;
  #offset = 0;

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes;
  }

  get finished(): boolean {
    return this.#offset === this.#bytes.length;
  }

  #take(): number {
    const byte = this.#bytes[this.#offset];
    if (byte === undefined) throw new Error("truncated DAG-CBOR value");
    this.#offset += 1;
    return byte;
  }

  #argument(additional: number): bigint {
    if (additional < 24) return BigInt(additional);
    const length =
      additional === 24
        ? 1
        : additional === 25
          ? 2
          : additional === 26
            ? 4
            : additional === 27
              ? 8
              : 0;
    if (length === 0) throw new Error("indefinite or reserved DAG-CBOR length");
    let value = 0n;
    for (let index = 0; index < length; index += 1) value = (value << 8n) | BigInt(this.#take());
    const minimum = length === 1 ? 24n : 1n << BigInt(8 * (length / 2));
    if (value < minimum) throw new Error("non-canonical DAG-CBOR integer or length");
    return value;
  }

  #length(value: bigint): number {
    if (value > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error("DAG-CBOR collection is too large");
    return Number(value);
  }

  decode(): DagCborValue {
    const initial = this.#take();
    const major = initial >> 5;
    const additional = initial & 31;
    if (major === 7) {
      if (additional === 20) return false;
      if (additional === 21) return true;
      if (additional === 22) return null;
      throw new Error("DAG-CBOR floats and unsupported simple values are forbidden");
    }
    const argument = this.#argument(additional);
    if (major === 0) return argument;
    if (major === 1) return -1n - argument;
    if (major === 2 || major === 3) {
      const length = this.#length(argument);
      const end = this.#offset + length;
      if (end > this.#bytes.length) throw new Error("truncated DAG-CBOR bytes or string");
      const bytes = this.#bytes.slice(this.#offset, end);
      this.#offset = end;
      if (major === 2) return bytes;
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new Error("invalid UTF-8 in DAG-CBOR string");
      }
    }
    if (major === 4) {
      const output: DagCborValue[] = [];
      for (let index = 0; index < this.#length(argument); index += 1) output.push(this.decode());
      return output;
    }
    if (major === 5) {
      const output: Record<string, DagCborValue> = {};
      let previous: string | undefined;
      for (let index = 0; index < this.#length(argument); index += 1) {
        const key = this.decode();
        if (typeof key !== "string") throw new Error("DAG-CBOR map keys must be strings");
        if (previous !== undefined && compareMapKeys(previous, key) >= 0) {
          throw new Error("DAG-CBOR map keys are duplicated or out of canonical order");
        }
        output[key] = this.decode();
        previous = key;
      }
      return output;
    }
    throw new Error(`unsupported DAG-CBOR major type ${major}`);
  }
}

export function decodeDagCbor(bytes: Uint8Array): DagCborValue {
  const decoder = new Decoder(bytes);
  const value = decoder.decode();
  if (!decoder.finished) throw new Error("trailing bytes after DAG-CBOR value");
  return value;
}

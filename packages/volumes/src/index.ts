import { assertCID, decodeDagCbor, type DagCborValue } from "@adalinxx/lattice-core";

export interface VolumeEntry {
  readonly cid: string;
  readonly bytes: Uint8Array;
}

/** A complete Volume boundary, rooted at `rootCID`. */
export interface SerializedVolume {
  readonly rootCID: string;
  readonly entries: readonly VolumeEntry[];
}

/**
 * Transport implemented by the Lattice content service, a DHT client, an
 * application gateway, or an in-memory test source. Transport selection is an
 * application decision; this package owns verification after retrieval.
 */
export interface VolumeTransport {
  getVolume(rootCID: string, signal?: AbortSignal): Promise<SerializedVolume | null>;
}

export interface VolumeLimits {
  readonly maximumEntries: number;
  readonly maximumBytes: number;
}

export const DEFAULT_VOLUME_LIMITS: VolumeLimits = {
  maximumEntries: 4096,
  maximumBytes: 64 * 1024 * 1024,
};

export class VolumeError extends Error {
  readonly code:
    | "not-found"
    | "wrong-root"
    | "missing-root"
    | "duplicate-entry"
    | "too-many-entries"
    | "too-large"
    | "invalid-entry";

  constructor(code: VolumeError["code"], message: string) {
    super(message);
    this.name = "VolumeError";
    this.code = code;
  }
}

export class VerifiedVolume {
  readonly rootCID: string;
  readonly #entries: ReadonlyMap<string, Uint8Array>;

  constructor(rootCID: string, entries: ReadonlyMap<string, Uint8Array>) {
    this.rootCID = rootCID;
    this.#entries = entries;
  }

  get size(): number {
    return this.#entries.size;
  }

  has(cid: string): boolean {
    return this.#entries.has(cid);
  }

  bytes(cid: string): Uint8Array | undefined {
    return this.#entries.get(cid)?.slice();
  }

  rootBytes(): Uint8Array {
    return this.#entries.get(this.rootCID)!.slice();
  }

  decodeRoot(): DagCborValue {
    return decodeDagCbor(this.rootBytes());
  }

  entries(): readonly VolumeEntry[] {
    return [...this.#entries].map(([cid, bytes]) => ({ cid, bytes: bytes.slice() }));
  }
}

export function verifyVolume(
  volume: SerializedVolume,
  expectedRoot = volume.rootCID,
  limits: VolumeLimits = DEFAULT_VOLUME_LIMITS,
): VerifiedVolume {
  if (volume.rootCID !== expectedRoot) {
    throw new VolumeError("wrong-root", `expected Volume ${expectedRoot}, got ${volume.rootCID}`);
  }
  if (volume.entries.length > limits.maximumEntries) {
    throw new VolumeError("too-many-entries", "Volume exceeds the entry limit");
  }
  const entries = new Map<string, Uint8Array>();
  let totalBytes = 0;
  for (const entry of volume.entries) {
    if (entries.has(entry.cid)) {
      throw new VolumeError("duplicate-entry", `Volume repeats ${entry.cid}`);
    }
    totalBytes += entry.bytes.byteLength;
    if (totalBytes > limits.maximumBytes) {
      throw new VolumeError("too-large", "Volume exceeds the byte limit");
    }
    try {
      assertCID(entry.cid, entry.bytes);
    } catch (error) {
      throw new VolumeError(
        "invalid-entry",
        error instanceof Error ? error.message : `invalid Volume entry ${entry.cid}`,
      );
    }
    entries.set(entry.cid, entry.bytes.slice());
  }
  if (!entries.has(expectedRoot)) {
    throw new VolumeError("missing-root", `Volume does not contain its root ${expectedRoot}`);
  }
  return new VerifiedVolume(expectedRoot, entries);
}

export class VolumeClient {
  readonly #transport: VolumeTransport;
  readonly #limits: VolumeLimits;

  constructor(transport: VolumeTransport, limits: VolumeLimits = DEFAULT_VOLUME_LIMITS) {
    this.#transport = transport;
    this.#limits = limits;
  }

  async get(rootCID: string, signal?: AbortSignal): Promise<VerifiedVolume> {
    const serialized = await this.#transport.getVolume(rootCID, signal);
    if (serialized === null) throw new VolumeError("not-found", `Volume ${rootCID} was not found`);
    return verifyVolume(serialized, rootCID, this.#limits);
  }
}

export class MemoryVolumeTransport implements VolumeTransport {
  readonly #volumes = new Map<string, SerializedVolume>();

  constructor(volumes: readonly SerializedVolume[] = []) {
    for (const volume of volumes) this.put(volume);
  }

  put(volume: SerializedVolume): void {
    this.#volumes.set(volume.rootCID, {
      rootCID: volume.rootCID,
      entries: volume.entries.map(({ cid, bytes }) => ({ cid, bytes: bytes.slice() })),
    });
  }

  async getVolume(rootCID: string, _signal?: AbortSignal): Promise<SerializedVolume | null> {
    const volume = this.#volumes.get(rootCID);
    if (volume === undefined) return null;
    return {
      rootCID: volume.rootCID,
      entries: volume.entries.map(({ cid, bytes }) => ({ cid, bytes: bytes.slice() })),
    };
  }
}

export interface Uint64SparseProof {
  readonly rootCID: string;
  readonly key: string;
  readonly value?: bigint;
  readonly entries: readonly VolumeEntry[];
}

function object(value: DagCborValue): { readonly [key: string]: DagCborValue } | undefined {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Uint8Array)
    ? (value as { readonly [key: string]: DagCborValue })
    : undefined;
}

function referencedCID(value: DagCborValue | undefined): string | undefined {
  if (value === undefined) return undefined;
  const header = object(value);
  return typeof header?.rawCID === "string" ? header.rawCID : undefined;
}

/**
 * Verifies a Lattice sparse-radix proof for an optional UInt64 value. The proof
 * is sealed to its supplied entries: a missing referenced child is invalid and
 * never triggers a network fetch.
 */
export function verifyUint64SparseProof(proof: Uint64SparseProof): boolean {
  if (proof.value !== undefined && (proof.value < 0n || proof.value > 0xffff_ffff_ffff_ffffn)) {
    return false;
  }
  let volume: VerifiedVolume;
  try {
    volume = verifyVolume({ rootCID: proof.rootCID, entries: proof.entries });
  } catch {
    return false;
  }
  let cid = proof.rootCID;
  let remaining = proof.key;
  const visited = new Set<string>();
  while (true) {
    if (visited.has(cid)) return false;
    visited.add(cid);
    const bytes = volume.bytes(cid);
    if (bytes === undefined) return false;
    let node: { readonly [key: string]: DagCborValue } | undefined;
    try {
      node = object(decodeDagCbor(bytes));
    } catch {
      return false;
    }
    if (node === undefined) return false;
    if (node.prefix !== undefined) {
      if (typeof node.prefix !== "string") return false;
      if (!remaining.startsWith(node.prefix)) return proof.value === undefined;
      remaining = remaining.slice(node.prefix.length);
    }
    if (remaining.length === 0) {
      if (node.value === undefined) return proof.value === undefined;
      return typeof node.value === "bigint" && node.value === proof.value;
    }
    if (!Array.isArray(node.children)) return false;
    let next: string | undefined;
    for (const childValue of node.children) {
      const child = object(childValue);
      if (child === undefined || typeof child.key !== "string" || child.key.length !== 1) {
        return false;
      }
      const childCID = referencedCID(child.value);
      if (childCID === undefined) return false;
      if (child.key === remaining[0]) {
        if (next !== undefined) return false;
        next = childCID;
      }
    }
    if (next === undefined) return proof.value === undefined;
    if (!volume.has(next)) return false;
    cid = next;
  }
}

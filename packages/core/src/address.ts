import { cidV1DagCbor } from "./cid.js";
import { encodeDagCbor } from "./dag-cbor.js";
import { encodeEd25519Multikey } from "./multikey.js";

export function addressFromMultikey(multikey: string): string {
  return cidV1DagCbor(encodeDagCbor({ key: multikey }));
}

export function addressFromPublicKey(publicKey: Uint8Array): string {
  return addressFromMultikey(encodeEd25519Multikey(publicKey));
}

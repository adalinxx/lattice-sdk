import * as ed25519 from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8 } from "./bytes.js";

if (!ed25519.hashes.sha512) ed25519.hashes.sha512 = sha512;

export const SIGNATURE_DOMAIN = "lattice-tx-v1:";

export function publicKeyFromPrivate(privateKey: Uint8Array): Uint8Array {
  if (privateKey.length !== 32) throw new Error("Ed25519 private key must be 32 bytes");
  return ed25519.getPublicKey(privateKey);
}

export function generatePrivateKey(): Uint8Array {
  return ed25519.utils.randomSecretKey();
}

export function signPreimage(preimage: string, privateKey: Uint8Array): string {
  return bytesToHex(ed25519.sign(utf8(SIGNATURE_DOMAIN + preimage), privateKey));
}

export function verifyPreimage(
  preimage: string,
  signature: string,
  publicKey: Uint8Array,
): boolean {
  try {
    return ed25519.verify(hexToBytes(signature), utf8(SIGNATURE_DOMAIN + preimage), publicKey);
  } catch {
    return false;
  }
}

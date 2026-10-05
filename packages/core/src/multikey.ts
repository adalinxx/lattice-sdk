import { bytesToHex, hexToBytes } from "./bytes.js";

export function encodeEd25519Multikey(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) throw new Error("Ed25519 public key must be 32 bytes");
  return `ed01${bytesToHex(publicKey)}`;
}

export function decodeEd25519Multikey(multikey: string): Uint8Array {
  const bytes = hexToBytes(multikey);
  if (bytes.length !== 34 || bytes[0] !== 0xed || bytes[1] !== 0x01) {
    throw new Error("public key is not an Ed25519 Multikey");
  }
  return bytes.slice(2);
}

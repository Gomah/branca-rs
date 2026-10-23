import { BrancaError } from "./errors.ts";

/** The version byte every Branca token starts with. */
export const TOKEN_VERSION = 0xba;
/** Key length in bytes (XChaCha20-Poly1305). */
export const KEY_LENGTH = 32;
/** Nonce length in bytes (XChaCha20). */
export const NONCE_LENGTH = 24;
/** Largest representable timestamp, 2106-02-07T06:28:15Z. */
export const MAX_TIMESTAMP = 0xffff_ffff;

/** Generates a fresh random 32-byte key. */
export function generateKey(): Uint8Array {
  return randomBytes(KEY_LENGTH);
}

/** @internal */
export function randomBytes(length: number): Uint8Array {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.getRandomValues !== "function") throw new BrancaError("CRYPTO_UNAVAILABLE");
  return webCrypto.getRandomValues(new Uint8Array(length));
}

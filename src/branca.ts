import { BrancaError, type BrancaErrorCode, isKnownCode } from "./errors.ts";
import { raw } from "./wasm.ts";

/** The version byte every Branca token starts with. */
export const TOKEN_VERSION = 0xba;
/** Key length in bytes (XChaCha20-Poly1305). */
export const KEY_LENGTH = 32;
/** Nonce length in bytes (XChaCha20). */
export const NONCE_LENGTH = 24;
/** Largest representable timestamp, 2106-02-07T06:28:15Z. */
export const MAX_TIMESTAMP = 0xffff_ffff;

/** 32 bytes, or a string whose UTF-8 encoding is exactly 32 bytes. */
export type BrancaKey = Uint8Array | string;
/** Arbitrary bytes, or a string that is encoded as UTF-8. */
export type BrancaPayload = Uint8Array | string;

export interface EncodeOptions {
  /** Token timestamp in seconds since the Unix epoch. Defaults to the current time. */
  timestamp?: number;
  /**
   * Explicit 24-byte nonce. Only use this to reproduce known test vectors: reusing a nonce with
   * the same key breaks XChaCha20-Poly1305. When omitted, a random nonce is drawn from
   * `crypto.getRandomValues`.
   */
  nonce?: Uint8Array;
}

export interface DecodeOptions {
  /**
   * Time to live in seconds. When set to a positive value, tokens with `timestamp + ttl < now`
   * are rejected with `TOKEN_EXPIRED`. `0` or `undefined` disables the check.
   */
  ttl?: number;
  /** Current time in seconds since the Unix epoch. Defaults to `Date.now()`; override in tests. */
  now?: number;
}

export interface DecodedToken {
  /** The decrypted and authenticated payload. */
  payload: Uint8Array;
  /** The authenticated token timestamp, in seconds since the Unix epoch. */
  timestamp: number;
}

const textEncoder = new TextEncoder();

/**
 * Encrypts `payload` into a Branca token string.
 *
 * ```ts
 * const token = encode(key, JSON.stringify({ sub: "42" }));
 * ```
 */
export function encode(key: BrancaKey, payload: BrancaPayload, options: EncodeOptions = {}): string {
  const wasm = raw();
  const keyBytes = toKey(key);
  const payloadBytes = toBytes(payload, "INVALID_PAYLOAD");
  const timestamp = options.timestamp ?? nowSeconds();
  assertUint32(timestamp, "INVALID_TIMESTAMP");
  const nonce = options.nonce ?? randomBytes(NONCE_LENGTH);
  if (!(nonce instanceof Uint8Array) || nonce.length !== NONCE_LENGTH) {
    throw new BrancaError("INVALID_NONCE");
  }
  try {
    return wasm.encode(keyBytes, nonce, timestamp, payloadBytes);
  } catch (error) {
    throw translate(error);
  }
}

/**
 * Verifies and decrypts `token`, returning the payload together with its authenticated timestamp.
 *
 * ```ts
 * const { payload, timestamp } = decode(key, token, { ttl: 3600 });
 * const claims = JSON.parse(new TextDecoder().decode(payload));
 * ```
 */
export function decode(key: BrancaKey, token: string, options: DecodeOptions = {}): DecodedToken {
  const wasm = raw();
  const keyBytes = toKey(key);
  if (typeof token !== "string") throw new BrancaError("INVALID_TOKEN", "Token must be a string.");
  const ttl = options.ttl ?? 0;
  assertUint32(ttl, "INVALID_TTL");
  const now = options.now ?? nowSeconds();
  assertUint32(now, "INVALID_TIMESTAMP");

  let out: Uint8Array;
  try {
    out = wasm.decode(keyBytes, token, ttl, now);
  } catch (error) {
    throw translate(error);
  }
  // The core returns `timestamp (4 bytes, big-endian) || payload`.
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  return { timestamp: view.getUint32(0), payload: out.subarray(4) };
}

/** Generates a fresh random 32-byte key. */
export function generateKey(): Uint8Array {
  return randomBytes(KEY_LENGTH);
}

/** Binds a key once so you can encode and decode without passing it around. */
export class Branca {
  readonly #key: Uint8Array;

  constructor(key: BrancaKey) {
    this.#key = toKey(key).slice();
  }

  encode(payload: BrancaPayload, options?: EncodeOptions): string {
    return encode(this.#key, payload, options);
  }

  decode(token: string, options?: DecodeOptions): DecodedToken {
    return decode(this.#key, token, options);
  }
}

function toBytes(input: BrancaPayload, code: BrancaErrorCode): Uint8Array {
  if (typeof input === "string") return textEncoder.encode(input);
  if (input instanceof Uint8Array) return input;
  throw new BrancaError(code);
}

function toKey(key: BrancaKey): Uint8Array {
  const bytes = toBytes(key, "INVALID_KEY");
  if (bytes.length !== KEY_LENGTH) {
    throw new BrancaError("INVALID_KEY", `Key must be exactly ${KEY_LENGTH} bytes, got ${bytes.length}.`);
  }
  return bytes;
}

function assertUint32(value: unknown, code: BrancaErrorCode): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_TIMESTAMP) {
    throw new BrancaError(code);
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function randomBytes(length: number): Uint8Array {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.getRandomValues !== "function") throw new BrancaError("CRYPTO_UNAVAILABLE");
  return webCrypto.getRandomValues(new Uint8Array(length));
}

/** Maps the code-only errors thrown by the WebAssembly core to `BrancaError`s. */
function translate(error: unknown): unknown {
  if (error instanceof Error && isKnownCode(error.message)) return new BrancaError(error.message);
  return error;
}

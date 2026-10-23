/** Stable, machine-readable reasons a Branca operation can fail. */
export type BrancaErrorCode =
  | "NOT_INITIALIZED"
  | "CRYPTO_UNAVAILABLE"
  | "INVALID_KEY"
  | "INVALID_NONCE"
  | "INVALID_TIMESTAMP"
  | "INVALID_TTL"
  | "INVALID_PAYLOAD"
  | "INVALID_TOKEN"
  | "INVALID_BASE62"
  | "INVALID_VERSION"
  | "ENCRYPTION_FAILED"
  | "DECRYPTION_FAILED"
  | "TTL_OVERFLOW"
  | "TOKEN_EXPIRED";

const MESSAGES: Record<BrancaErrorCode, string> = {
  NOT_INITIALIZED:
    'Branca is not initialized. Import from "branca-rs" (which initializes on import) or await init() from "branca-rs/init" first.',
  CRYPTO_UNAVAILABLE: "globalThis.crypto.getRandomValues is not available in this runtime.",
  INVALID_KEY: "Key must be exactly 32 bytes.",
  INVALID_NONCE: "Nonce must be exactly 24 bytes.",
  INVALID_TIMESTAMP: "Timestamp must be an integer between 0 and 4294967295 (seconds since the Unix epoch).",
  INVALID_TTL: "TTL must be an integer between 0 and 4294967295 (seconds).",
  INVALID_PAYLOAD: "Payload must be a Uint8Array or a string.",
  INVALID_TOKEN: "Token is too short to be a Branca token.",
  INVALID_BASE62: "Token contains characters outside the base62 alphabet.",
  INVALID_VERSION: "Unsupported token version (expected 0xBA).",
  ENCRYPTION_FAILED: "Encryption failed.",
  DECRYPTION_FAILED: "Token authentication failed: wrong key or tampered token.",
  TTL_OVERFLOW: "timestamp + ttl overflows a 32-bit unsigned integer.",
  TOKEN_EXPIRED: "Token has expired.",
};

/** Thrown for every failure; inspect `code` instead of parsing `message`. */
export class BrancaError extends Error {
  override readonly name = "BrancaError" as const;
  readonly code: BrancaErrorCode;

  constructor(code: BrancaErrorCode, message: string = MESSAGES[code]) {
    super(message);
    this.code = code;
  }
}

/** @internal Whether `value` is one of the codes the WebAssembly core can throw. */
export function isKnownCode(value: unknown): value is BrancaErrorCode {
  return typeof value === "string" && Object.hasOwn(MESSAGES, value);
}

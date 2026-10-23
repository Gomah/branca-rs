import { describe, expect, test } from "bun:test";
import {
  Branca,
  BrancaError,
  KEY_LENGTH,
  MAX_TIMESTAMP,
  NONCE_LENGTH,
  TOKEN_VERSION,
  decode,
  encode,
  generateKey,
  isInitialized,
} from "../src/index.ts";
import { KEY, expectBrancaError, utf8 } from "./helpers.ts";

const now = (): number => Math.floor(Date.now() / 1000);

describe("constants", () => {
  test("match the specification", () => {
    expect(TOKEN_VERSION).toBe(0xba);
    expect(KEY_LENGTH).toBe(32);
    expect(NONCE_LENGTH).toBe(24);
    expect(MAX_TIMESTAMP).toBe(4294967295);
  });

  test("the main entry point initializes on import", () => {
    expect(isInitialized()).toBe(true);
  });
});

describe("encode / decode", () => {
  test("round-trips a string payload with the current timestamp", () => {
    const before = now();
    const token = encode(KEY, "Hello world!");
    const decoded = decode(KEY, token);
    expect(utf8.decode(decoded.payload)).toBe("Hello world!");
    expect(decoded.timestamp).toBeGreaterThanOrEqual(before);
    expect(decoded.timestamp).toBeLessThanOrEqual(now());
  });

  test("round-trips non-ASCII text as UTF-8", () => {
    const text = "héllo wörld 🌍 — ünïcödé";
    expect(utf8.decode(decode(KEY, encode(KEY, text)).payload)).toBe(text);
  });

  test("round-trips arbitrary bytes, including an empty payload", () => {
    for (const length of [0, 1, 15, 16, 17, 255, 256, 1000, 16 * 1024]) {
      const payload = new Uint8Array(length).map((_, i) => (i * 7 + 3) & 0xff);
      const decoded = decode(KEY, encode(KEY, payload));
      expect(decoded.payload).toEqual(payload);
    }
  });

  test("honours an explicit timestamp", () => {
    for (const timestamp of [0, 1, 123206400, MAX_TIMESTAMP]) {
      expect(decode(KEY, encode(KEY, "x", { timestamp })).timestamp).toBe(timestamp);
    }
  });

  test("uses a fresh random nonce for every token", () => {
    const a = encode(KEY, "same", { timestamp: 1 });
    const b = encode(KEY, "same", { timestamp: 1 });
    expect(a).not.toBe(b);
    expect(utf8.decode(decode(KEY, a).payload)).toBe("same");
    expect(utf8.decode(decode(KEY, b).payload)).toBe("same");
  });

  test("accepts Uint8Array, Buffer and 32-byte string keys interchangeably", () => {
    const bytes = utf8.encode(KEY);
    const buffer = Buffer.from(KEY);
    const token = encode(bytes, "key types");
    expect(utf8.decode(decode(KEY, token).payload)).toBe("key types");
    expect(utf8.decode(decode(buffer, token).payload)).toBe("key types");
    expect(utf8.decode(decode(bytes.subarray(0), token).payload)).toBe("key types");
  });

  test("works with a key that is a view into a larger buffer", () => {
    const backing = new Uint8Array(100);
    backing.set(utf8.encode(KEY), 50);
    const view = backing.subarray(50, 82);
    expect(utf8.decode(decode(view, encode(view, "view")).payload)).toBe("view");
  });

  test("returned payloads are independent copies", () => {
    const token = encode(KEY, "copy");
    const first = decode(KEY, token).payload;
    first.fill(0);
    expect(utf8.decode(decode(KEY, token).payload)).toBe("copy");
  });

  test("tokens only contain base62 characters", () => {
    expect(encode(KEY, "charset".repeat(20))).toMatch(/^[0-9A-Za-z]+$/);
  });
});

describe("ttl", () => {
  const token = encode(KEY, "ttl", { timestamp: 1000 });

  test("accepts tokens that expire exactly now", () => {
    expect(decode(KEY, token, { ttl: 60, now: 1060 }).timestamp).toBe(1000);
  });

  test("rejects tokens past timestamp + ttl", () => {
    expectBrancaError(() => decode(KEY, token, { ttl: 60, now: 1061 }), "TOKEN_EXPIRED");
  });

  test("a ttl of 0 or undefined disables the check", () => {
    expect(decode(KEY, token, { ttl: 0, now: MAX_TIMESTAMP }).timestamp).toBe(1000);
    expect(decode(KEY, token, { now: MAX_TIMESTAMP }).timestamp).toBe(1000);
  });

  test("defaults `now` to the current time", () => {
    const fresh = encode(KEY, "fresh");
    expect(decode(KEY, fresh, { ttl: 5 }).timestamp).toBeGreaterThan(0);
    expectBrancaError(() => decode(KEY, token, { ttl: 5 }), "TOKEN_EXPIRED");
  });

  test("reports timestamp + ttl overflow instead of never expiring", () => {
    expectBrancaError(() => decode(KEY, token, { ttl: MAX_TIMESTAMP, now: 1000 }), "TTL_OVERFLOW");
    const late = encode(KEY, "late", { timestamp: MAX_TIMESTAMP });
    expectBrancaError(() => decode(KEY, late, { ttl: 1, now: 1000 }), "TTL_OVERFLOW");
  });

  test("authenticates before checking expiry", () => {
    expectBrancaError(() => decode(generateKey(), token, { ttl: 60, now: 1061 }), "DECRYPTION_FAILED");
  });
});

describe("validation", () => {
  const token = encode(KEY, "validation");

  test("rejects keys that are not exactly 32 bytes", () => {
    expectBrancaError(() => encode("short", "x"), "INVALID_KEY");
    expectBrancaError(() => encode(new Uint8Array(31), "x"), "INVALID_KEY");
    expectBrancaError(() => encode(new Uint8Array(33), "x"), "INVALID_KEY");
    expectBrancaError(() => encode("ünïcödé-is-longer-than-it-looks!", "x"), "INVALID_KEY");
    expectBrancaError(() => decode(new Uint8Array(0), token), "INVALID_KEY");
    expectBrancaError(() => encode(42 as unknown as string, "x"), "INVALID_KEY");
    expectBrancaError(() => new Branca(new Uint8Array(16)), "INVALID_KEY");
  });

  test("rejects invalid payloads", () => {
    expectBrancaError(() => encode(KEY, { toString: () => "x" } as unknown as string), "INVALID_PAYLOAD");
  });

  test("rejects invalid timestamps", () => {
    for (const timestamp of [
      -1,
      1.5,
      MAX_TIMESTAMP + 1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      "1" as unknown as number,
    ]) {
      expectBrancaError(() => encode(KEY, "x", { timestamp }), "INVALID_TIMESTAMP");
      expectBrancaError(() => decode(KEY, token, { now: timestamp }), "INVALID_TIMESTAMP");
    }
  });

  test("rejects invalid nonces", () => {
    expectBrancaError(() => encode(KEY, "x", { nonce: new Uint8Array(23) }), "INVALID_NONCE");
    expectBrancaError(() => encode(KEY, "x", { nonce: "beef" as unknown as Uint8Array }), "INVALID_NONCE");
  });

  test("rejects invalid ttls", () => {
    for (const ttl of [-1, 0.5, MAX_TIMESTAMP + 1, "60" as unknown as number]) {
      expectBrancaError(() => decode(KEY, token, { ttl }), "INVALID_TTL");
    }
  });

  test("rejects malformed tokens", () => {
    expectBrancaError(() => decode(KEY, 42 as unknown as string), "INVALID_TOKEN");
    expectBrancaError(() => decode(KEY, ""), "INVALID_TOKEN");
    expectBrancaError(() => decode(KEY, "870S4BYxgHw0KnP3W9fg"), "INVALID_TOKEN");
    expectBrancaError(() => decode(KEY, `${token.slice(0, -1)}!`), "INVALID_BASE62");
    expectBrancaError(() => decode(KEY, `${token} `), "INVALID_BASE62");
  });

  test("detects the wrong key and tampering", () => {
    expectBrancaError(() => decode(generateKey(), token), "DECRYPTION_FAILED");
    const last = token.at(-1);
    const flipped = `${token.slice(0, -1)}${last === "A" ? "B" : "A"}`;
    expectBrancaError(() => decode(KEY, flipped), "DECRYPTION_FAILED");
  });
});

describe("generateKey", () => {
  test("returns 32 random bytes", () => {
    const a = generateKey();
    const b = generateKey();
    expect(a).toBeInstanceOf(Uint8Array);
    expect(a.length).toBe(KEY_LENGTH);
    expect(a).not.toEqual(b);
    expect(utf8.decode(decode(a, encode(a, "generated")).payload)).toBe("generated");
  });
});

describe("Branca class", () => {
  test("binds a key", () => {
    const branca = new Branca(KEY);
    const token = branca.encode("class", { timestamp: 7 });
    expect(branca.decode(token)).toEqual({ payload: utf8.encode("class"), timestamp: 7 });
    expect(utf8.decode(decode(KEY, token).payload)).toBe("class");
  });

  test("copies the key so later mutation of the input has no effect", () => {
    const key = generateKey();
    const branca = new Branca(key);
    const token = branca.encode("copied");
    key.fill(0);
    expect(utf8.decode(branca.decode(token).payload)).toBe("copied");
    expectBrancaError(() => decode(key, token), "DECRYPTION_FAILED");
  });
});

describe("BrancaError", () => {
  test("is an Error with a stable code and a default message", () => {
    const error = new BrancaError("TOKEN_EXPIRED");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("BrancaError");
    expect(error.code).toBe("TOKEN_EXPIRED");
    expect(error.message).toBe("Token has expired.");
    expect(new BrancaError("TOKEN_EXPIRED", "custom").message).toBe("custom");
  });
});

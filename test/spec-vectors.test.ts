import { describe, expect, test } from "bun:test";
import type { BrancaErrorCode } from "../src/errors.ts";
import { decode, encode } from "../src/index.ts";
import { bytesToHex, expectBrancaError, hexToBytes } from "./helpers.ts";
import vectors from "./vectors/branca-spec.json";

interface Vector {
  id: number;
  comment: string;
  key: string;
  nonce: string;
  timestamp: number;
  token: string;
  msg: string;
  isValid: boolean;
}

const groups = vectors.testGroups as Array<{ testType: string; tests: Vector[] }>;
const encoding = groups.find((g) => g.testType === "encoding")?.tests ?? [];
const decoding = groups.find((g) => g.testType === "decoding")?.tests ?? [];

/** The failure the spec describes in the vector's comment, in our error vocabulary. */
function expectedCode(comment: string): BrancaErrorCode {
  const c = comment.toLowerCase();
  if (c.includes("base62")) return "INVALID_BASE62";
  if (c.includes("version")) return "INVALID_VERSION";
  if (c.includes("invalid key")) return "INVALID_KEY";
  return "DECRYPTION_FAILED";
}

describe(`branca-spec test vectors v${vectors.version}`, () => {
  test("covers every vector in the file", () => {
    expect(encoding.length + decoding.length).toBe(vectors.numberOfTests);
    expect(encoding.length).toBe(8);
    expect(decoding.length).toBe(17);
  });

  describe("encoding", () => {
    for (const v of encoding) {
      test(`#${v.id} ${v.comment}`, () => {
        const token = encode(hexToBytes(v.key), hexToBytes(v.msg), {
          nonce: hexToBytes(v.nonce),
          timestamp: v.timestamp,
        });
        expect(token).toBe(v.token);
      });
    }
  });

  describe("decoding", () => {
    for (const v of decoding) {
      test(`#${v.id} ${v.comment}`, () => {
        const key = hexToBytes(v.key);
        if (v.isValid) {
          const decoded = decode(key, v.token);
          expect(bytesToHex(decoded.payload)).toBe(v.msg);
          expect(decoded.timestamp).toBe(v.timestamp);
        } else {
          expectBrancaError(() => decode(key, v.token), expectedCode(v.comment));
        }
      });
    }
  });
});

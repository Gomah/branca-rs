// Interoperability with the original JavaScript implementation (tuupola/branca-js, libsodium based).
import { describe, expect, test } from "bun:test";
import createLegacy from "branca";
import { ready } from "libsodium-wrappers";
import { Branca } from "../src/index.ts";
import { KEY_HEX, hexToBytes, utf8 } from "./helpers.ts";

await ready;

const ours = new Branca(hexToBytes(KEY_HEX));
const legacy = createLegacy(KEY_HEX);
const binary = new Uint8Array(256).map((_, i) => i);

describe("interoperability with branca-js", () => {
  test("branca-js decodes tokens produced by branca-rs", () => {
    const token = ours.encode("Hello world!", { timestamp: 123206400 });
    expect(legacy.decode(token).toString("utf8")).toBe("Hello world!");
    expect(legacy.timestamp(token)).toBe(123206400);

    const binaryToken = ours.encode(binary);
    expect(new Uint8Array(legacy.decode(binaryToken))).toEqual(binary);
  });

  test("branca-rs decodes tokens produced by branca-js", () => {
    const token = legacy.encode("Hello world!", 123206400);
    const decoded = ours.decode(token);
    expect(utf8.decode(decoded.payload)).toBe("Hello world!");
    expect(decoded.timestamp).toBe(123206400);

    const binaryToken = legacy.encode(binary, 123206400);
    expect(ours.decode(binaryToken).payload).toEqual(binary);
  });

  test("both implementations agree on expiry", () => {
    const token = legacy.encode("ttl", 123206400);
    expect(() => legacy.decode(token, 60)).toThrow();
    expect(() => ours.decode(token, { ttl: 60 })).toThrow();
    expect(() => legacy.decode(token)).not.toThrow();
    expect(() => ours.decode(token)).not.toThrow();
  });
});

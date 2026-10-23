import { expect } from "bun:test";
import { BrancaError, type BrancaErrorCode } from "../src/errors.ts";

export const KEY = "supersecretkeyyoushouldnotcommit";
export const KEY_HEX = "73757065727365637265746b6579796f7573686f756c646e6f74636f6d6d6974";

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const utf8 = {
  encode: (text: string): Uint8Array => new TextEncoder().encode(text),
  decode: (bytes: Uint8Array): string => new TextDecoder().decode(bytes),
};

/** Asserts that `fn` throws a `BrancaError` carrying `code`. */
export function expectBrancaError(fn: () => unknown, code: BrancaErrorCode): BrancaError {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(BrancaError);
  const error = caught as BrancaError;
  expect(error.code).toBe(code);
  expect(error.name).toBe("BrancaError");
  expect(error.message.length).toBeGreaterThan(0);
  return error;
}

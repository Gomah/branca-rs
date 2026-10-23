/**
 * branca-rs: Branca tokens for JavaScript and TypeScript, powered by a Rust core compiled to
 * WebAssembly.
 *
 * Importing this module instantiates the embedded WebAssembly core synchronously, so there is no
 * top-level await and `require("branca-rs")` works on Node.js 22.12+. Runtimes that
 * forbid compiling WebAssembly from bytes (Cloudflare Workers, Vercel Edge) should import
 * "branca-rs/init" instead and pass their imported module to `init()`.
 *
 * `BrancaError` lives in "branca-rs/errors", `generateKey` and the constants in "branca-rs/utils".
 */
import { initSync } from "./internal/wasm.ts";

initSync();

export {
  Branca,
  decode,
  encode,
  type BrancaKey,
  type BrancaPayload,
  type DecodeOptions,
  type DecodedToken,
  type EncodeOptions,
} from "./internal/branca.ts";

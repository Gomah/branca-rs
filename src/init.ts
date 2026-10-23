/**
 * Explicit-initialization entry point: the same API as "branca-rs", but nothing runs on import.
 * Call `initSync()` (Node.js, Bun) or `await init()` before using it. Pass your own
 * `WebAssembly.Module` to `init` on runtimes that forbid compiling WebAssembly from bytes, such as
 * Cloudflare Workers and Vercel Edge.
 */
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
export { init, initSync, isInitialized, type InitInput } from "./internal/wasm.ts";

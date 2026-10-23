/**
 * Explicit-initialization entry point. Nothing runs on import: call `initSync()` (Node.js, Bun) or `await init()` before using the API. Pass your own `WebAssembly.Module` to `init` on
 * runtimes that forbid compiling WebAssembly from bytes, such as Cloudflare Workers and Vercel Edge.
 */
export * from "./branca.ts";
export { BrancaError, type BrancaErrorCode } from "./errors.ts";
export { init, initSync, isInitialized, type InitInput } from "./wasm.ts";

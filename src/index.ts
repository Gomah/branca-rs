/**
 * branca-rs: Branca tokens for JavaScript and TypeScript, powered by a Rust core compiled to
 * WebAssembly.
 *
 * Importing this module instantiates the embedded WebAssembly core synchronously, so there is no
 * top-level await and `require("branca-rs")` works on Node.js 22.12+. Runtimes that
 * forbid compiling WebAssembly from bytes (Cloudflare Workers, Vercel Edge) should import
 * "branca-rs/init" instead and pass their imported module to `init()`.
 */
import { initSync } from "./wasm.ts";

initSync();

export * from "./branca.ts";
export { BrancaError, type BrancaErrorCode } from "./errors.ts";
export { isInitialized } from "./wasm.ts";

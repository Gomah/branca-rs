/**
 * `BrancaError`, thrown for every failure, and its stable codes. Never loads the WebAssembly core, so
 * it works with either "branca-rs" or "branca-rs/init".
 */
export { BrancaError, type BrancaErrorCode } from "./internal/errors.ts";

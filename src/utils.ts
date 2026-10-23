/**
 * `generateKey` and the token format constants. Never loads the WebAssembly core, so it works with
 * either "branca-rs" or "branca-rs/init", before or after initialization.
 */
export { KEY_LENGTH, MAX_TIMESTAMP, NONCE_LENGTH, TOKEN_VERSION, generateKey } from "./internal/utils.ts";

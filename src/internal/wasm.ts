import { BrancaError } from "./errors.ts";
import __wbg_init, {
  decode as wasmDecode,
  encode as wasmEncode,
  initSync as __wbg_initSync,
} from "../generated/branca.js";
import { wasmBase64 } from "../generated/wasm-bytes.ts";

/** A compiled `WebAssembly.Module`, or the raw bytes of `branca.wasm`. */
export type InitInput = WebAssembly.Module | ArrayBufferView | ArrayBuffer;

/** @internal The functions exported by the Rust core. */
export interface RawBindings {
  encode: (key: Uint8Array, nonce: Uint8Array, timestamp: number, payload: Uint8Array) => string;
  decode: (key: Uint8Array, token: string, ttl: number, now: number) => Uint8Array;
}

let initialized = false;
let pending: Promise<void> | undefined;

/**
 * Compiles and instantiates the WebAssembly core. Safe to call more than once; the first call
 * wins and later calls resolve immediately.
 *
 * Without arguments the module embedded in this package is used. Pass your own
 * `WebAssembly.Module` or bytes for runtimes that forbid compiling WebAssembly from bytes at
 * runtime, such as Cloudflare Workers and Vercel Edge:
 *
 * ```ts
 * import wasm from "branca-rs/branca.wasm";
 * import { init } from "branca-rs/init";
 * await init(wasm);
 * ```
 */
export async function init(input?: InitInput | Promise<InitInput>): Promise<void> {
  if (initialized) return;
  pending ??= (async () => {
    try {
      const module_or_path = input === undefined ? embeddedWasm() : await input;
      await __wbg_init({ module_or_path });
      initialized = true;
    } finally {
      pending = undefined;
    }
  })();
  return pending;
}

/**
 * Synchronous variant of {@link init}; this is what the main "branca-rs" entry point calls on
 * import. Works on Node.js, Bun and in workers. Browsers refuse to compile modules larger
 * than 4 KiB synchronously on the main thread, so use {@link init} there.
 */
export function initSync(input?: InitInput): void {
  if (initialized) return;
  __wbg_initSync({ module: input ?? embeddedWasm() });
  initialized = true;
}

/** Whether the WebAssembly core is ready to use. */
export function isInitialized(): boolean {
  return initialized;
}

const bindings: RawBindings = { encode: wasmEncode, decode: wasmDecode };

/** @internal */
export function raw(): RawBindings {
  if (!initialized) throw new BrancaError("NOT_INITIALIZED");
  return bindings;
}

function embeddedWasm(): Uint8Array {
  const binary = atob(wasmBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

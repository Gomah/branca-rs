// Runs in a fresh process (see test/init.test.ts) so every scenario starts uninitialized.
import { resolve } from "node:path";
import { Branca, BrancaError, init, initSync, isInitialized } from "../../src/init.ts";

const mode = process.argv[2];
const key = "supersecretkeyyoushouldnotcommit";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[${mode}] ${message}`);
}

assert(!isInitialized(), "must start uninitialized");
try {
  new Branca(key).encode("too early");
  assert(false, "encode must throw before init");
} catch (error) {
  assert(
    error instanceof BrancaError && error.code === "NOT_INITIALIZED",
    `unexpected error ${String(error)}`,
  );
}

const wasmPath = resolve(import.meta.dir, "../../src/generated/branca_bg.wasm");
switch (mode) {
  case "sync":
    initSync();
    break;
  case "async":
    await init();
    break;
  case "concurrent": {
    const results = await Promise.all([init(), init(), init()]);
    assert(results.length === 3, "all concurrent init calls must resolve");
    break;
  }
  case "bytes":
    await init(await Bun.file(wasmPath).bytes());
    break;
  case "module":
    await init(await WebAssembly.compile(await Bun.file(wasmPath).bytes()));
    break;
  case "promise":
    await init(Bun.file(wasmPath).bytes());
    break;
  case "sync-module":
    initSync(new WebAssembly.Module(await Bun.file(wasmPath).bytes()));
    break;
  default:
    assert(false, `unknown mode ${mode}`);
}

assert(isInitialized(), "must be initialized afterwards");
await init(); // idempotent
initSync(); // idempotent
const branca = new Branca(key);
const payload = new TextDecoder().decode(branca.decode(branca.encode("hello")).payload);
assert(payload === "hello", `round trip failed: ${payload}`);
console.log(`ok ${mode}`);

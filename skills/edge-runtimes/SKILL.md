---
name: edge-runtimes
description: >-
  Use when running branca-rs on Cloudflare Workers, Vercel Edge or another
  runtime that forbids compiling WebAssembly from bytes, when a deployed worker
  that imports branca-rs fails to start, or when a call throws NOT_INITIALIZED.
  Covers the branca-rs/init entry point, init and initSync, and the raw module
  at branca-rs/branca.wasm. For encoding, decoding and error handling, also load
  branca-rs#tokens.
metadata:
  purpose: Initialize the branca-rs WebAssembly core explicitly on runtimes that
    cannot compile it from bytes.
  type: core
  library: branca-rs
  library_version: "0.2.0"
sources:
  - Gomah/branca-rs:README.md
  - Gomah/branca-rs:src/index.ts
  - Gomah/branca-rs:src/init.ts
  - Gomah/branca-rs:src/internal/wasm.ts
---

# Run branca-rs on edge runtimes

Importing `branca-rs` compiles the WebAssembly module embedded in the package, from bytes, as soon as the
import runs. Cloudflare Workers and Vercel Edge forbid that. On those runtimes import `branca-rs/init`
instead: it has the same `Branca`, `encode` and `decode`, runs nothing on import, and waits for a module
that the runtime's bundler compiled.

## Setup

| Import from             | Use                                                                       |
| ----------------------- | ------------------------------------------------------------------------- |
| `branca-rs/init`        | `Branca`, `encode`, `decode`, plus `init`, `initSync` and `isInitialized` |
| `branca-rs/branca.wasm` | The raw module. Wrangler turns this import into a `WebAssembly.Module`    |
| `branca-rs/errors`      | `BrancaError`. Never loads WebAssembly, so it is safe anywhere            |
| `branca-rs/utils`       | `generateKey` and the constants. Never loads WebAssembly either           |

`init(input)` accepts a `WebAssembly.Module`, the module's bytes, or a promise of either. It is idempotent:
the first call wins, concurrent calls share one initialization, and later calls return at once.

## Core patterns

### Cloudflare Workers

```ts no-check
import wasm from "branca-rs/branca.wasm";
import { Branca, init } from "branca-rs/init";
import { generateKey } from "branca-rs/utils";

let branca: Branca | undefined;

export default {
  async fetch(): Promise<Response> {
    await init(wasm); // instantiates once per isolate; later calls return immediately
    // Production: build it from a secret binding instead, with env.BRANCA_KEY decoded to 32 bytes.
    branca ??= new Branca(generateKey());
    const token = branca.encode("hello from the edge");
    const { payload } = branca.decode(token, { ttl: 60 });
    return new Response(new TextDecoder().decode(payload));
  },
};
```

With TypeScript, run `wrangler types`: the generated `worker-configuration.d.ts` declares `*.wasm` imports
as `WebAssembly.Module`.

Call `generateKey` and `encode` inside a handler, never at module scope. Workers refuse to generate random
values at global scope ("Disallowed operation called within global scope"), and both draw random bytes.

### Vercel Edge and other runtimes

Get a `WebAssembly.Module` for `branca-rs/branca.wasm` the way the runtime documents for precompiled
WebAssembly (for Vercel, see [its WebAssembly guide](https://vercel.com/docs/functions/runtimes/wasm)), then
`await init(module)` before the first `encode` or `decode`.

### Initialize explicitly on Node.js or Bun

The main entry already initializes on these runtimes. Use `branca-rs/init` there only when startup code or
tests must control when the module is compiled:

```ts
import { Branca, initSync, isInitialized } from "branca-rs/init";
import { generateKey } from "branca-rs/utils";

console.log(isInitialized()); // false until something initializes the core
initSync(); // compiles the embedded module synchronously
const branca = new Branca(generateKey());
console.log(new TextDecoder().decode(branca.decode(branca.encode("ok"), { ttl: 60 }).payload)); // "ok"
```

## Common mistakes

### CRITICAL: Importing `branca-rs` in edge code

The main entry compiles WebAssembly from bytes when it is imported, so a deployed worker fails to start
with an error such as "Wasm code generation disallowed by embedder". Every module in the edge bundle,
shared helpers included, must import from `branca-rs/init`, `branca-rs/errors` and `branca-rs/utils` only.
`wrangler dev` may not enforce the restriction, so a local run that works does not prove the deployment
will.

### HIGH: Calling `init()` without a module on the edge

Without an argument, `init()` falls back to the embedded bytes, which those runtimes refuse to compile.
Always pass the imported module there.

### HIGH: Using the API before `init` resolves

`encode` and `decode` from `branca-rs/init` throw `NOT_INITIALIZED` until `init` or `initSync` has
completed:

```ts
import { BrancaError } from "branca-rs/errors";
import { Branca } from "branca-rs/init";
import { generateKey } from "branca-rs/utils";

try {
  new Branca(generateKey()).encode("too early");
} catch (error) {
  console.log(error instanceof BrancaError && error.code); // "NOT_INITIALIZED"
}
```

Await `init(wasm)` at the start of every handler, or in one helper they all call. After the first call it
returns immediately.

### MEDIUM: `initSync` on a browser's main thread

Browsers refuse to compile modules larger than 4 KiB synchronously on the main thread, so use
`await init()` there. Branca needs the secret key, though, so browsers are not a target.

## Completion check

- No module in the edge bundle imports the main entry: `grep -rnE "from ['\"]branca-rs['\"]" src` prints
  nothing.
- Every handler awaits `init(wasm)` before it uses `Branca`, `encode` or `decode`.
- `wrangler dev` serves a request that encodes and decodes a token. Then check a deployed preview, because
  local runs may not enforce the WebAssembly restriction.

## References

[Initialization](../../README.md#initialization) and [Runtime support](../../README.md#runtime-support) in
the package README.

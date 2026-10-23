# branca-rs

[![npm version](https://img.shields.io/npm/v/branca-rs.svg)](https://www.npmjs.com/package/branca-rs)
[![Node.js 22.12+](https://img.shields.io/badge/node-%3E%3D22.12-brightgreen.svg)](#runtime-support)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

[Branca](https://github.com/tuupola/branca-spec) tokens for JavaScript and TypeScript, powered by a Rust core
compiled to WebAssembly.

A Branca token is a payload encrypted and authenticated with IETF XChaCha20-Poly1305, stamped with a
timestamp, and base62 encoded. There is one version and one algorithm, so there is no `alg` header to
negotiate, no `none` algorithm, and no key confusion. The payload is opaque bytes: JSON, MessagePack,
protobuf, a session id, anything. Branca uses a shared secret key, which makes it a fit for server-side
sessions and service-to-service tokens rather than anything a browser verifies. If you know PASETO, Branca
is close to its `local` tokens.

- **Rust core, JavaScript surface.** Base62, the token format and the AEAD (via
  [RustCrypto](https://github.com/RustCrypto/AEADs)) are Rust, compiled to a 35 KB WebAssembly module that
  is embedded in the package. A thin TypeScript layer provides the API, draws nonces from
  `crypto.getRandomValues`, and maps errors.
- **Made for servers and serverless.** Node.js 22.12+, Bun, AWS Lambda, Cloudflare Workers and Vercel
  Edge. No native binaries, no postinstall step, no network access, and no top-level `await`, so both
  `import` and `require()` work.
- **Spec compliant and interoperable.** Passes all 25 official test vectors and round-trips tokens with
  the reference Rust crate and with the original branca-js package in CI.
- **Fast.** 5 to 95 times faster than branca-js depending on payload size and runtime
  (see [Performance](#performance)).
- **Rust-powered toolchain.** Built with [tsdown](https://tsdown.dev) on Rolldown, linted with
  [oxlint](https://oxc.rs), formatted with oxfmt, tested with `bun test` and `cargo test`.

## Installation

```sh
bun add branca-rs
# or
npm install branca-rs
```

The package is ESM only and ships its own TypeScript declarations.

## Quick start

```ts
import { Branca } from "branca-rs";

// The key is 32 secret bytes. Generate one with generateKey() from "branca-rs/utils", store it as
// hex in your secret manager, and load it at startup.
const key = Buffer.from(process.env.BRANCA_KEY ?? "", "hex");
const branca = new Branca(key); // throws INVALID_KEY unless the key is exactly 32 bytes

// Issue a token.
const token = branca.encode(JSON.stringify({ sub: "user_123", role: "admin" }));
// => a base62 string such as "875GH23U0Dr6nHFA63DhOyd9LkYud…", different on every call (random nonce)

// Verify it later, rejecting tokens older than one hour.
const { payload, timestamp } = branca.decode(token, { ttl: 3600 });
const claims = JSON.parse(new TextDecoder().decode(payload));
```

Every failure is a `BrancaError` with a stable `code`:

```ts
import { BrancaError } from "branca-rs/errors";

try {
  branca.decode(token, { ttl: 3600 });
} catch (error) {
  if (error instanceof BrancaError) {
    switch (error.code) {
      case "TOKEN_EXPIRED":
        // ask the client to sign in again
        break;
      case "DECRYPTION_FAILED":
        // wrong key or tampered token: treat as unauthenticated
        break;
      default:
      // malformed input, see the table below
    }
  }
  throw error;
}
```

Payloads can be bytes as well as strings, which is the natural fit for binary encodings:

```ts
import { decode, encode } from "branca-rs";

const token = encode(key, msgpack.encode({ sub: "user_123" }));
const { payload } = decode(key, token);
const claims = msgpack.decode(payload);
```

## Runtime support

| Runtime                                    | Status                         | Notes                                                                                          |
| ------------------------------------------ | ------------------------------ | ---------------------------------------------------------------------------------------------- |
| Node.js 22.12+                             | Supported, in CI (22/24/26)    | `import` and `require()` both work.                                                            |
| Bun                                        | Supported, in CI               | Tested with Bun 1.3.                                                                           |
| AWS Lambda, Google Cloud Functions, Vercel | Supported                      | The module is embedded as base64, so bundlers produce a single self-contained file.            |
| Cloudflare Workers, Vercel Edge            | Supported via `branca-rs/init` | These runtimes forbid compiling WebAssembly from bytes; see [Initialization](#initialization). |
| Browsers                                   | Not a target                   | Branca needs the secret key. If you must, `await init()` from `branca-rs/init` works.          |

## API

The core API comes from `branca-rs`. Errors and helpers have their own entry points:

| Import from             | Exports                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| `branca-rs`             | `encode`, `decode`, `Branca` and their types. Initializes the WebAssembly core on import.          |
| `branca-rs/errors`      | `BrancaError` and the `BrancaErrorCode` type.                                                      |
| `branca-rs/utils`       | `generateKey` and the constants.                                                                   |
| `branca-rs/init`        | The `branca-rs` API without initialization on import, plus `init`, `initSync` and `isInitialized`. |
| `branca-rs/branca.wasm` | The raw WebAssembly module, for runtimes that import `.wasm` files.                                |

### `encode(key, payload, options?) → string`

| Parameter           | Type                   | Notes                                                                   |
| ------------------- | ---------------------- | ----------------------------------------------------------------------- |
| `key`               | `Uint8Array \| string` | 32 bytes. A string is UTF-8 encoded and must also be exactly 32 bytes.  |
| `payload`           | `Uint8Array \| string` | Strings are UTF-8 encoded. Bytes are used as is.                        |
| `options.timestamp` | `number`               | Seconds since the Unix epoch, 0 to 2³²−1. Defaults to the current time. |
| `options.nonce`     | `Uint8Array`           | 24 bytes. Only for reproducing test vectors. Never reuse a nonce.       |

### `decode(key, token, options?) → { payload: Uint8Array, timestamp: number }`

| Parameter     | Type     | Notes                                                                                            |
| ------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `options.ttl` | `number` | Seconds. When positive, tokens with `timestamp + ttl < now` throw `TOKEN_EXPIRED`. `0` disables. |
| `options.now` | `number` | Seconds since the Unix epoch. Defaults to `Date.now()`; override it in tests.                    |

The returned `timestamp` comes from the authenticated header, so it can be trusted. The TTL check runs only
after the token has been verified, as the specification requires. `payload` is a fresh copy; the token's
bytes never alias WebAssembly memory.

### `class Branca`

`new Branca(key)` validates and copies the key once. `.encode(payload, options?)` and
`.decode(token, options?)` mirror the functions above.

### `BrancaError`

From `branca-rs/errors`. Extends `Error` with a `code` property. Match on `code`, never on `message`.

| Code                 | Meaning                                                                     |
| -------------------- | --------------------------------------------------------------------------- |
| `DECRYPTION_FAILED`  | Authentication failed: wrong key, or the token was tampered with.           |
| `TOKEN_EXPIRED`      | `timestamp + ttl` is in the past.                                           |
| `INVALID_TOKEN`      | Token is not a string or is too short to be a Branca token.                 |
| `INVALID_BASE62`     | Token contains characters outside `0-9A-Za-z`.                              |
| `INVALID_VERSION`    | Token does not start with the `0xBA` version byte.                          |
| `INVALID_KEY`        | Key is not exactly 32 bytes.                                                |
| `INVALID_PAYLOAD`    | Payload is neither a `Uint8Array` nor a string.                             |
| `INVALID_TIMESTAMP`  | Timestamp or `now` is not an integer between 0 and 2³²−1.                   |
| `INVALID_TTL`        | TTL is not an integer between 0 and 2³²−1.                                  |
| `INVALID_NONCE`      | Nonce is not exactly 24 bytes.                                              |
| `TTL_OVERFLOW`       | `timestamp + ttl` does not fit in 32 bits, which the specification forbids. |
| `NOT_INITIALIZED`    | `branca-rs/init` was imported but `init()` or `initSync()` was not called.  |
| `CRYPTO_UNAVAILABLE` | `globalThis.crypto.getRandomValues` is missing.                             |

### `generateKey() → Uint8Array`

From `branca-rs/utils`. 32 cryptographically random bytes from `crypto.getRandomValues`.

### Constants

From `branca-rs/utils`: `TOKEN_VERSION` (`0xBA`), `KEY_LENGTH` (32), `NONCE_LENGTH` (24) and
`MAX_TIMESTAMP` (2³²−1, which is 2106-02-07T06:28:15Z).

## Initialization

Importing `branca-rs` instantiates the embedded WebAssembly module synchronously. On Node.js and Bun
that is all you need; it takes about a millisecond once per process.

Some runtimes forbid compiling WebAssembly from bytes and want the module imported as a file instead.
For those, use the `branca-rs/init` entry point, which does nothing on import, and hand it the module:

```ts
// Cloudflare Workers (wrangler) and Vercel Edge resolve .wasm imports to a WebAssembly.Module.
import wasm from "branca-rs/branca.wasm";
import { Branca, init } from "branca-rs/init";

await init(wasm);
```

`init(input?)` accepts a `WebAssembly.Module`, raw bytes, or a promise of either, and falls back to the
embedded module when called without arguments. `initSync(input?)` is the synchronous equivalent for
Node.js, Bun and workers. Both are idempotent: the first call wins and later calls return at once.

`branca-rs/errors` and `branca-rs/utils` never touch the WebAssembly module, so import them next to
`branca-rs/init` as usual. They work before `init()` too.

From CommonJS, `require("branca-rs")` works on every supported Node.js version (22.12+).

## Security guidance

- **Keys.** Use 32 random bytes from `generateKey()` or your secret manager. The string form exists for
  convenience and test vectors; never derive a key from a password without a proper KDF.
- **Rotation.** Branca tokens carry no key id. Keep the previous key around and try keys newest first:

  ```ts
  import { decode } from "branca-rs";
  import { BrancaError } from "branca-rs/errors";

  function decodeWithRotation(token: string, keys: Uint8Array[]) {
    for (const key of keys) {
      try {
        return decode(key, token, { ttl: 3600 });
      } catch (error) {
        if (error instanceof BrancaError && error.code === "DECRYPTION_FAILED") continue;
        throw error;
      }
    }
    throw new BrancaError("DECRYPTION_FAILED");
  }
  ```

- **Expiry.** Always pass a `ttl` when verifying. Branca has no revocation; short TTLs limit the blast
  radius of a leaked token.
- **What is visible.** The payload is encrypted. The version byte, timestamp and nonce are authenticated
  but readable by anyone holding the token, so the timestamp alone leaks when a token was issued.
- **Symmetric.** Anyone who can verify a token can mint one. Do not hand the key to clients, and prefer
  one key per service boundary.
- **Nonces** are random per token. Never pass `options.nonce` in production code.
- **Pure core.** The WebAssembly module has no access to the clock or to randomness; both come from the
  JavaScript side, which keeps the Rust code deterministic and easy to audit.

## Migrating from branca-js

Tokens are interchangeable, so you can migrate one service at a time.

| branca-js                                     | branca-rs                                                        |
| --------------------------------------------- | ---------------------------------------------------------------- |
| `const branca = require("branca")(hexKey)`    | `const branca = new Branca(Buffer.from(hexKey, "hex"))`          |
| `branca.encode(message, timestamp?)`          | `branca.encode(payload, { timestamp })`                          |
| `branca.decode(token, ttl?)` returns `Buffer` | `branca.decode(token, { ttl })` returns `{ payload, timestamp }` |
| `branca.timestamp(token)` (unauthenticated)   | `branca.decode(token).timestamp` (authenticated)                 |
| `throw new Error("Token is expired.")`        | `BrancaError` with `code === "TOKEN_EXPIRED"`                    |

Two differences to watch: branca-js treats string keys as hex, branca-rs treats them as UTF-8, so pass
bytes; and `payload` is a `Uint8Array`, so wrap it with `Buffer.from(payload)` if you need a `Buffer`.

## Agent skills

The package ships [Agent Skills](https://agentskills.io) in `skills/` that teach coding agents to use it
correctly. They are versioned with the code, so the skills in `node_modules` describe the version you have
installed.

| Skill                              | Covers                                                                        |
| ---------------------------------- | ----------------------------------------------------------------------------- |
| `branca-rs#tokens`                 | Issuing and verifying tokens: keys, payloads, TTLs, error codes, key rotation |
| `branca-rs#edge-runtimes`          | Cloudflare Workers, Vercel Edge and `branca-rs/init`                          |
| `branca-rs#migrate-from-branca-js` | Porting code from branca-js                                                   |

Load them with [TanStack Intent](https://tanstack.com/intent). Install it as a dev dependency, so the CLI
that runs is the one your lockfile pins, and list the packages your agent may take instructions from in
`package.json`:

```sh
npm install --save-dev @tanstack/intent
```

```json
{
  "intent": {
    "skills": ["branca-rs"],
    "exclude": ["branca-rs#migrate-from-branca-js"]
  }
}
```

```sh
npx --no intent list                   # the skills your allowlist permits, with their descriptions
npx --no intent load branca-rs#tokens  # print one skill
npx --no intent install                # tell your agent, in AGENTS.md, how to find and load skills
```

`--no` stops npx from downloading a package when Intent is not installed; an unrelated package named
`intent` exists on npm. With Bun, run `bun run intent list` and so on.

- **Nothing runs.** Intent finds skills by reading `package.json` and `SKILL.md` files in `node_modules`. It
  never imports or executes the packages it scans.
- **You choose the sources.** Only packages listed in `intent.skills` reach your agent. Other dependencies
  that ship skills, transitive ones included, stay hidden until you list them. `intent.exclude` drops skills
  you don't need, such as the migration guide once you have migrated.
- **One skill per task.** The instructions `intent install` writes tell the agent to list the skills, load
  the one that matches the task, and load more only when the task spans several concerns.
- **Hooks are a convenience.** `npx --no intent hooks install` adds Claude Code and Codex hooks that show the
  skill catalog when a session starts and block the agent's file-edit tools until it has run `intent list`
  or `intent load`. They don't check that a skill was loaded, fits the task or was followed, and shell
  commands can still change files. Your allowlist and exclusions, and reading skill changes when you update
  dependencies, decide which instructions your agent gets.

## Why WebAssembly and not native bindings

Branca is server-side by nature, so it is fair to ask why this package ships WebAssembly instead of native
bindings (the napi-rs approach used by rolldown and oxc). The choice is deliberate:

- **One artifact for every platform.** No prebuilt binary per OS, architecture and libc, no cross-compilation
  matrix in CI, and no failed installs on Alpine or ARM.
- **Serverless and edge are servers too.** Cloudflare Workers and Vercel Edge cannot load
  native addons. WebAssembly runs on all of them.
- **Supply-chain hygiene.** Nothing is downloaded at install time, there is no postinstall script, and the
  code runs inside the WebAssembly sandbox.
- **It is already fast enough.** A typical 128-byte token encodes in about 4 µs and decodes in under 3 µs,
  which is hundreds of thousands of tokens per second per core. Token handling will not be your bottleneck.

If profiling ever says otherwise, native bindings can be added as an optional dependency that falls back
to WebAssembly, the same layering rolldown and oxc-parser use, without changing the public API.

## Performance

Compared with [branca-js](https://github.com/tuupola/branca-js), the original implementation published on npm
as `branca` (libsodium.js for the AEAD, base-x for base62). Payloads are printable ASCII of the given size;
each cell is the mean time per operation measured with [mitata](https://github.com/evanwashere/mitata), and
"Speedup" is branca-js ÷ branca-rs.

<!-- bench:start -->

**Bun 1.3.10 (Apple M4 Pro, arm64-darwin)**

| Operation    | branca-rs | branca-js | Speedup |
| ------------ | --------: | --------: | ------: |
| encode 16 B  |   1.58 µs |  11.24 µs |    7.1× |
| decode 16 B  |   1.47 µs |   9.04 µs |    6.2× |
| encode 128 B |   3.78 µs |  57.27 µs |   15.2× |
| decode 128 B |   2.64 µs |  59.24 µs |   22.4× |
| encode 1 KiB |  88.94 µs |   1.97 ms |   22.2× |
| decode 1 KiB |  26.71 µs |   2.04 ms |   76.3× |
| encode 4 KiB |   1.37 ms |  28.52 ms |   20.8× |
| decode 4 KiB | 312.19 µs |  31.18 ms |   99.9× |

**Node.js 24.22.0 (Apple M4 Pro, arm64-darwin)**

| Operation    | branca-rs | branca-js | Speedup |
| ------------ | --------: | --------: | ------: |
| encode 16 B  |   2.21 µs |  29.09 µs |   13.2× |
| decode 16 B  |   1.55 µs |   8.50 µs |    5.5× |
| encode 128 B |   3.77 µs |  68.85 µs |   18.3× |
| decode 128 B |   2.72 µs |  37.18 µs |   13.7× |
| encode 1 KiB |  61.51 µs |   1.66 ms |   26.9× |
| decode 1 KiB |  27.60 µs |   1.12 ms |   40.4× |
| encode 4 KiB | 874.50 µs |  24.09 ms |   27.5× |
| decode 4 KiB | 320.50 µs |  16.20 ms |   50.5× |

<!-- bench:end -->

Both libraries do the same cryptographic work, and libsodium.js is WebAssembly too. The gap comes mostly
from base62, which is quadratic in the token length and runs in Rust here instead of JavaScript, and from the
copying branca-js does through libsodium's Emscripten heap. Cost grows faster than payload size, so keep
payloads small: Branca is meant for claims, not documents.

### Running the benchmarks

```sh
bun run build:wasm     # build the WebAssembly core once
bun run bench          # Bun: prints mitata's full report with distributions
bun run bench:node     # Node.js
bun run bench:report   # both runtimes; rewrites bench/RESULTS.md and the tables above
```

The benchmark refuses to measure anything until both libraries have decoded each other's tokens. Results
depend on the machine; the tables above come from an Apple M4 Pro, and [bench/RESULTS.md](bench/RESULTS.md)
records the runtime versions. Bun and Node.js differ because their JavaScript and WebAssembly engines differ.

## Compatibility and testing

- `cargo test` runs the Rust unit tests, the 25 official
  [specification vectors](https://github.com/tuupola/branca-spec/blob/master/test_vectors.json), and
  round trips with the reference [`branca`](https://crates.io/crates/branca) crate.
- `bun test` runs the same 25 vectors through the WebAssembly build, the API, TTL and validation tests, a
  check of what each entry point exports, seven initialization scenarios in fresh processes, and round trips
  with branca-js.
- CI runs rustfmt, clippy (native and `wasm32-unknown-unknown`), both test suites, smoke tests of the built
  package under Node.js 22, 24 and 26 (ESM and CommonJS) and Bun, `publint` and "Are the types wrong?",
  plus the agent skills check described under [Development](#development).

## How it is built

```
crates/branca-core/     Rust: base62 codec, token format, XChaCha20-Poly1305 (RustCrypto)
        │  cargo build --target wasm32-unknown-unknown
        ▼
src/generated/          wasm-bindgen glue + branca_bg.wasm (wasm-opt -Oz) + base64 module   [git-ignored]
        │
src/                    TypeScript API: validation, nonce/timestamp generation, BrancaError, init
        │  tsdown (Rolldown)
        ▼
dist/                   index.js (initializes on import), errors.js, utils.js, init.js (explicit init),
                        shared chunks, .d.ts, branca_bg.wasm
```

The Rust crate is intentionally pure: `encode(key, nonce, timestamp, payload)` and
`decode(key, token, ttl, now)` take everything they need as arguments, which makes the core deterministic,
easy to test against the official vectors, and free of platform dependencies.

```
crates/branca-core/   Rust core and its tests
src/                  TypeScript entry points: index.ts, errors.ts, utils.ts, init.ts
src/internal/         TypeScript implementation and WebAssembly loader
skills/               Agent Skills shipped in the package, one SKILL.md per task
scripts/              build-wasm.ts, skills.ts and the smoke tests
test/                 bun tests, fixtures and test/vectors/branca-spec.json
bench/                benchmarks and RESULTS.md
```

## Development

Prerequisites: [Bun](https://bun.sh), a Rust toolchain from [rustup](https://rustup.rs), the `wasm32`
target, and the wasm-bindgen CLI at the version pinned in `Cargo.lock`:

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --locked --version "$(grep -A1 '^name = "wasm-bindgen"$' Cargo.lock | grep version | cut -d'"' -f2)"
bun install
bun run build
```

| Command                 | What it does                                                             |
| ----------------------- | ------------------------------------------------------------------------ |
| `bun run build`         | Build the Rust core to WebAssembly, then bundle the package with tsdown. |
| `bun run build:wasm`    | Only the first half: cargo, wasm-bindgen, wasm-opt, base64 module.       |
| `bun test`              | TypeScript tests against the sources.                                    |
| `bun run test:rust`     | Rust tests.                                                              |
| `bun run lint`          | oxlint. `bun run lint:rust` runs clippy.                                 |
| `bun run fmt`           | oxfmt and rustfmt. `bun run fmt:check` verifies without writing.         |
| `bun run typecheck`     | `tsc --noEmit` with isolated declarations.                               |
| `bun run smoke`         | Runs the built package under Node.js and Bun, as ESM and CommonJS.       |
| `bun run check:package` | publint and "Are the types wrong?" against a packed tarball.             |
| `bun run skills:check`  | Validate the agent skills and fail if a file they cite has changed.      |
| `bun run skills:stamp`  | Record the files the skills cite as reviewed.                            |
| `bun run bench`         | Benchmark against branca-js under Bun; `bench:node` for Node.js.         |
| `bun run bench:report`  | Both runtimes; rewrites `bench/RESULTS.md` and the README tables.        |

`src/generated/` and `dist/` are build output and git-ignored. Rebuild with `bun run build:wasm` after
touching the Rust code; the TypeScript tests import the sources, so no tsdown build is needed for them.

Each skill in `skills/` lists the files it was written from, mostly this README and `src/`, in its
`sources` frontmatter. `skills:check` runs `intent validate`, which typechecks the skills' code examples
against `src/`. It also fails when any of those files has changed since the skills were last reviewed. Read
the affected skills against the change, update them if they no longer match, then run
`bun run skills:stamp`, which records the files' git blob SHAs in `skills/sync-state.json`. The release
workflow sets each skill's `library_version` to the version being released.

## Releasing

1. Add the changes to `CHANGELOG.md` and bump `version` in `package.json` following semantic versioning.
2. Make sure CI is green on the commit you are releasing.
3. Run `npm publish`. The `prepublishOnly` hook rebuilds the package and re-runs `publint` and
   "Are the types wrong?" before anything is uploaded.
4. Tag the commit (`git tag v0.1.0`) and push the tag.

## License

[MIT](./LICENSE)

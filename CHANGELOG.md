# Changelog

All notable changes to this project are documented in this file. The project adheres to
[Semantic Versioning](https://semver.org/).

## 0.3.3

### Patch Changes

- 4751b93: Rebuilt the WebAssembly module with updated Rust dependencies: `wasm-bindgen` 0.2.130 and `ctutils` 0.4.7. The token format and the JavaScript API are unchanged.

## 0.3.2

### Patch Changes

- d3a972c: Rebuilt the WebAssembly module with updated Rust dependencies. The only crate that changed in the shipped module is `ctutils`, now 0.4.5, the constant-time helpers `chacha20poly1305` uses to compare authentication tags. The 0.4.4 and 0.4.5 releases fixed the constant-time code generation of `Choice` masks and of comparisons on 32-bit targets such as `wasm32`. The token format and the JavaScript API are unchanged.

## 0.3.1

### Patch Changes

- 03d90d8: The package now ships Agent Skills for coding agents in `skills/`: issuing and verifying tokens, running on edge runtimes, and migrating from branca-js. They are versioned with the package. Load them with TanStack Intent; see "Agent skills" in the README.
- f26d826: Node.js 26, the LTS line from 2026-10-28, is now a supported runtime: CI tests the package on it alongside Node.js 22 and 24. The minimum stays Node.js 22.12.

## 0.3.0

### Minor Changes

- a7becb0: Breaking: split the API across entry points. `branca-rs` now exports only `encode`, `decode`, `Branca` and their types, and `branca-rs/init` exports the same plus `init`, `initSync` and `isInitialized`. Import the rest from the new entry points:

  - `BrancaError` and `BrancaErrorCode` from `branca-rs/errors`.
  - `generateKey`, `TOKEN_VERSION`, `KEY_LENGTH`, `NONCE_LENGTH` and `MAX_TIMESTAMP` from `branca-rs/utils`.

  `isInitialized` is no longer exported from `branca-rs`, where it always returned `true`; import it from `branca-rs/init`.

## 0.2.0

### Minor Changes

- e8883e7: Drop Node.js 20 support. It reached end of life on 2026-04-30 and the build toolchain no longer runs on it. The minimum is now Node.js 22.12, the first 22.x release where `require()` of ES modules works without a flag.

## 0.1.0

### Minor Changes

- Initial release: `encode`, `decode`, `generateKey`, the `Branca` class and `BrancaError` with stable
  error codes.
- Rust core (RustCrypto XChaCha20-Poly1305 and base62) compiled to WebAssembly and embedded in the
  package, instantiated synchronously on import.
- `branca-rs/init` entry point with `init()` and `initSync()` for runtimes that must supply the module
  themselves, plus the raw module at `branca-rs/branca.wasm`.
- The official specification test vectors, and interoperability tests against the `branca` Rust crate
  and the original branca-js package.
- Benchmarks against branca-js under Bun and Node.js (`bun run bench:report`).

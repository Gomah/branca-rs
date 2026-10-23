# Changelog

All notable changes to this project are documented in this file. The project adheres to
[Semantic Versioning](https://semver.org/).

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

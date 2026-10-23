# Changelog

All notable changes to this project are documented in this file. The project adheres to
[Semantic Versioning](https://semver.org/).

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

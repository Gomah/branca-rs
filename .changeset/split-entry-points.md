---
"branca-rs": minor
---

Breaking: split the API across entry points. `branca-rs` now exports only `encode`, `decode`, `Branca` and their types, and `branca-rs/init` exports the same plus `init`, `initSync` and `isInitialized`. Import the rest from the new entry points:

- `BrancaError` and `BrancaErrorCode` from `branca-rs/errors`.
- `generateKey`, `TOKEN_VERSION`, `KEY_LENGTH`, `NONCE_LENGTH` and `MAX_TIMESTAMP` from `branca-rs/utils`.

`isInitialized` is no longer exported from `branca-rs`, where it always returned `true`; import it from `branca-rs/init`.

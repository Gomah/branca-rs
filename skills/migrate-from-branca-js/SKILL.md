---
name: migrate-from-branca-js
description: >-
  Use when replacing the branca npm package (branca-js, require("branca")(key))
  with branca-rs, or when branca-rs must read tokens that branca-js issued.
  Covers key formats, the encode and decode signatures, TTL semantics,
  timestamps and error handling. For code with no branca-js history, load
  branca-rs#tokens instead.
metadata:
  purpose: Port code from branca-js to branca-rs without breaking existing tokens
    or weakening expiry checks.
  type: lifecycle
  library: branca-rs
  library_version: "0.3.2"
sources:
  - Gomah/branca-rs:README.md
  - Gomah/branca-rs:src/internal/branca.ts
  - Gomah/branca-rs:src/internal/errors.ts
---

# Migrate from branca-js

branca-rs implements the same specification as branca-js, the `branca` package on npm. With the same key
bytes, each library decodes the other's tokens, so services can move one at a time.

## Setup

| branca-js                                     | branca-rs                                                        |
| --------------------------------------------- | ---------------------------------------------------------------- |
| `const branca = require("branca")(hexKey)`    | `const branca = new Branca(Buffer.from(hexKey, "hex"))`          |
| `branca.encode(message, timestamp?)`          | `branca.encode(payload, { timestamp })`                          |
| `branca.decode(token, ttl?)` returns `Buffer` | `branca.decode(token, { ttl })` returns `{ payload, timestamp }` |
| `branca.timestamp(token)` (unauthenticated)   | `branca.decode(token).timestamp` (authenticated)                 |
| `throw new Error("Token is expired.")`        | `BrancaError` with `code === "TOKEN_EXPIRED"`                    |

`Branca` comes from `branca-rs` and `BrancaError` from `branca-rs/errors`. There is no libsodium and nothing
to await: importing `branca-rs` initializes it synchronously.

## Core patterns

### Port the setup and the calls

```ts
import { Branca } from "branca-rs";
import { generateKey } from "branca-rs/utils";

// Stands in for the 64-character hex key you passed to require("branca"); load yours from your secret store.
const hexKey = Buffer.from(generateKey()).toString("hex");
const branca = new Branca(Buffer.from(hexKey, "hex")); // string keys are UTF-8 in branca-rs, so decode the hex

const token = branca.encode("user_123"); // was branca.encode("user_123")
const { payload, timestamp } = branca.decode(token, { ttl: 3600 }); // was branca.decode(token, 3600)
console.log(Buffer.from(payload).toString(), timestamp); // payload is a Uint8Array, not a Buffer
```

### Port error handling

branca-js threw plain `Error`s ("Token is expired.", "Invalid token version.", or libsodium's decryption
error). Replace checks on `message` with checks on `code`:

```ts
import { Branca } from "branca-rs";
import { BrancaError } from "branca-rs/errors";
import { generateKey } from "branca-rs/utils";

const branca = new Branca(generateKey());
const twoHoursAgo = Math.floor(Date.now() / 1000) - 7200;
const oldToken = branca.encode("user_123", { timestamp: twoHoursAgo });

try {
  branca.decode(oldToken, { ttl: 3600 });
} catch (error) {
  // was: if (error.message === "Token is expired.")
  if (error instanceof BrancaError && error.code === "TOKEN_EXPIRED") console.log("expired");
  else throw error;
}
```

### Read the issue time

branca-js's `branca.timestamp(token)` read the header without verifying the token. branca-rs returns the
timestamp only from `decode`, after authentication, so reading it needs the key.

## Common mistakes

### CRITICAL: Passing the TTL or timestamp positionally

From JavaScript, `branca.decode(token, 3600)` still runs, but branca-rs reads options from an object: the
number is ignored and the token never expires. Likewise `branca.encode(payload, timestamp)` silently uses
the current time. TypeScript rejects both:

```ts expect-error=TS2559
import { Branca } from "branca-rs";
import { generateKey } from "branca-rs/utils";

const branca = new Branca(generateKey());
branca.decode(branca.encode("user_123"), 3600);
```

Search the code for `.encode(` and `.decode(` calls whose second argument is not an object.

### CRITICAL: Relying on `ttl` 0

branca-js checked expiry whenever a TTL was passed, so `decode(token, 0)` rejected every token issued before
the current second. In branca-rs, `{ ttl: 0 }` turns the check off. If a configured TTL can be 0, decide
what it should mean and handle it explicitly.

### HIGH: Passing the hex key string unchanged

branca-js decoded string keys as hex; branca-rs encodes string keys as UTF-8. The 64-character hex string
is 64 bytes, so `new Branca(hexKey)` throws `INVALID_KEY`. Convert it with `Buffer.from(hexKey, "hex")`.

### HIGH: Expecting a Buffer from `decode`

`decode` returns `{ payload, timestamp }`, and `payload` is a `Uint8Array`. Code that did
`branca.decode(token).toString()` now gets `"[object Object]"` without any error. TypeScript does catch
other uses:

```ts expect-error=TS2345
import { Branca } from "branca-rs";
import { generateKey } from "branca-rs/utils";

const branca = new Branca(generateKey());
const claims = JSON.parse(branca.decode(branca.encode("{}")));
```

Read `.payload` and decode it with `new TextDecoder().decode(payload)` or `Buffer.from(payload).toString()`.

### HIGH: Leaving `timestamp(token)` calls

There is no unauthenticated timestamp accessor:

```ts expect-error=TS2339
import { Branca } from "branca-rs";
import { generateKey } from "branca-rs/utils";

const branca = new Branca(generateKey());
const issuedAt = branca.timestamp(branca.encode("user_123"));
```

Use `branca.decode(token, { ttl }).timestamp`.

### MEDIUM: Old Node.js versions

branca-rs is an ES module and needs Node.js 22.12 or newer, where `require("branca-rs")` also works.

## Completion check

- Tokens issued by services still on branca-js decode with branca-rs using the same key bytes, and the
  reverse.
- No `require("branca")` remains, and every `decode` passes `{ ttl }` as an object.
- The `branca` dependency is removed from `package.json`.

## References

[Migrating from branca-js](../../README.md#migrating-from-branca-js) in the package README.

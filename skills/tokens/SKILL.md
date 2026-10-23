---
name: tokens
description: >-
  Use when issuing or verifying Branca tokens with branca-rs: loading the
  32-byte key, encoding JSON or binary payloads, decoding with a TTL, handling
  BrancaError codes, or rotating keys. On Cloudflare Workers, Vercel Edge or
  other runtimes that cannot compile WebAssembly from bytes, also load
  branca-rs#edge-runtimes. To port code from the branca package (branca-js),
  load branca-rs#migrate-from-branca-js instead.
metadata:
  purpose: Issue and verify Branca tokens with branca-rs, with correct keys,
    expiry and error handling.
  type: core
  library: branca-rs
  library_version: "0.3.1"
sources:
  - Gomah/branca-rs:README.md
  - Gomah/branca-rs:src/index.ts
  - Gomah/branca-rs:src/errors.ts
  - Gomah/branca-rs:src/utils.ts
  - Gomah/branca-rs:src/internal/branca.ts
  - Gomah/branca-rs:src/internal/errors.ts
  - Gomah/branca-rs:src/internal/utils.ts
---

# Issue and verify Branca tokens

A Branca token is a payload encrypted and authenticated with XChaCha20-Poly1305 under a 32-byte shared
secret key, stamped with the time it was issued. There is no algorithm header and no public-key mode:
anyone who can verify a token can also mint one, so verification belongs on the server.

## Setup

| Import from        | Exports                                                                       |
| ------------------ | ----------------------------------------------------------------------------- |
| `branca-rs`        | `Branca`, `encode`, `decode` and their types                                  |
| `branca-rs/errors` | `BrancaError` and the `BrancaErrorCode` type                                  |
| `branca-rs/utils`  | `generateKey`, `KEY_LENGTH`, `NONCE_LENGTH`, `TOKEN_VERSION`, `MAX_TIMESTAMP` |

Importing `branca-rs` initializes its WebAssembly core synchronously. On Node.js 22.12+ and Bun there is
nothing else to set up, and `require("branca-rs")` works too.

```ts
import { Branca } from "branca-rs";
import { generateKey } from "branca-rs/utils";

// Production: load 32 random bytes from your secret manager, stored as hex, for example
// const key = Buffer.from(process.env.BRANCA_KEY ?? "", "hex");
const key = generateKey();
const branca = new Branca(key); // throws INVALID_KEY unless the key is exactly 32 bytes
console.log(branca.encode("ready"));
```

## Core patterns

### Issue a token

```ts
import { Branca } from "branca-rs";
import { generateKey } from "branca-rs/utils";

const branca = new Branca(generateKey());
const token = branca.encode(JSON.stringify({ sub: "user_123", role: "admin" }));
console.log(token); // base62, different on every call because the nonce is random
```

The token records when it was issued. Whoever verifies it decides how long it stays valid, through `ttl`,
so the payload needs no `iat` or `exp` claim.

### Verify a token and read its claims

```ts
import { Branca } from "branca-rs";
import { generateKey } from "branca-rs/utils";

const branca = new Branca(generateKey());
const token = branca.encode(JSON.stringify({ sub: "user_123" }));

const { payload, timestamp } = branca.decode(token, { ttl: 3600 }); // reject tokens older than an hour
const claims: { sub: string } = JSON.parse(new TextDecoder().decode(payload));
console.log(claims.sub, new Date(timestamp * 1000).toISOString());
```

`decode` authenticates the token before it checks the TTL. `payload` is a fresh `Uint8Array`, and
`timestamp` (seconds since the Unix epoch) comes from the authenticated header, so both can be trusted.

### Treat bad tokens as unauthenticated

Every failure is a `BrancaError` with a stable `code`. Malformed, forged and expired tokens are client
input; the other codes mean a bug or a misconfiguration and should surface.

```ts
import { Branca } from "branca-rs";
import { BrancaError } from "branca-rs/errors";
import { generateKey } from "branca-rs/utils";

const branca = new Branca(generateKey());

/** Returns the payload, or null when the request must be treated as unauthenticated. */
function verify(token: string): Uint8Array | null {
  try {
    return branca.decode(token, { ttl: 3600 }).payload;
  } catch (error) {
    if (!(error instanceof BrancaError)) throw error;
    switch (error.code) {
      case "TOKEN_EXPIRED": // authentic but too old: ask the client to sign in again
      case "DECRYPTION_FAILED": // wrong key or tampered token
      case "INVALID_TOKEN": // not a string, or too short
      case "INVALID_BASE62":
      case "INVALID_VERSION":
      case "TTL_OVERFLOW": // timestamp + ttl does not fit in 32 bits
        return null;
      default:
        throw error; // INVALID_KEY, INVALID_TTL, ...: fix the code, not the token
    }
  }
}

console.log(verify("not-a-branca-token")); // null
console.log(verify(branca.encode("hi")) !== null); // true
```

### Encode binary payloads

```ts
import { decode, encode } from "branca-rs";
import { generateKey } from "branca-rs/utils";

const key = generateKey();
const sessionId = crypto.getRandomValues(new Uint8Array(16));
const token = encode(key, sessionId); // bytes are used as is; strings are UTF-8 encoded
const { payload } = decode(key, token, { ttl: 900 });
console.log(payload.every((byte, i) => byte === sessionId[i])); // true
```

MessagePack or protobuf work the same way: encode the bytes, and decode `payload` with the same codec.

### Rotate keys

Tokens carry no key id. Keep the previous key for the rotation window and try keys newest first. Only
`DECRYPTION_FAILED` means "try the next key".

```ts
import { decode, encode, type DecodedToken } from "branca-rs";
import { BrancaError } from "branca-rs/errors";
import { generateKey } from "branca-rs/utils";

function decodeWithRotation(token: string, keys: Uint8Array[], ttl: number): DecodedToken {
  for (const key of keys) {
    try {
      return decode(key, token, { ttl });
    } catch (error) {
      if (error instanceof BrancaError && error.code === "DECRYPTION_FAILED") continue;
      throw error; // expired or malformed: another key will not help
    }
  }
  throw new BrancaError("DECRYPTION_FAILED");
}

const previous = generateKey();
const current = generateKey();
const token = encode(previous, "issued before the rotation");
const { payload } = decodeWithRotation(token, [current, previous], 3600);
console.log(new TextDecoder().decode(payload)); // "issued before the rotation"
```

Issue new tokens with the current key only, and drop the previous key once the longest TTL has passed.

## Common mistakes

### CRITICAL: Verifying without a TTL

`branca.decode(token)` and `{ ttl: 0 }` accept a token forever, however old. Pass a positive `ttl` in
seconds on every verification. Branca has no revocation, so a short TTL is what limits a leaked token.

### CRITICAL: Passing a nonce

`options.nonce` exists to reproduce the specification's test vectors. Reusing a nonce with the same key
breaks XChaCha20-Poly1305. Leave it out: every `encode` draws a fresh random nonce.

### CRITICAL: Weak or mis-decoded keys

A string key is UTF-8 encoded and must be exactly 32 bytes; it is not hex. Store keys as hex or base64,
decode them to bytes (`Buffer.from(hex, "hex")`), and create them with `generateKey()` or your secret
manager. Never use a password or passphrase as the key.

### CRITICAL: Giving the key to clients

The key that verifies tokens also mints them. Never ship it to browsers or mobile apps, and prefer one key
per service boundary.

### HIGH: Importing from the wrong entry point

`branca-rs` exports only `Branca`, `encode`, `decode` and their types. Older versions also exported
`BrancaError` and `generateKey`, so this no longer compiles:

```ts expect-error=TS2305
import { BrancaError, generateKey } from "branca-rs";
```

Import `BrancaError` from `branca-rs/errors`, and `generateKey` and the constants from `branca-rs/utils`.

### HIGH: Treating the payload as a string

`payload` is a `Uint8Array`:

```ts expect-error=TS2345
import { Branca } from "branca-rs";
import { generateKey } from "branca-rs/utils";

const branca = new Branca(generateKey());
const claims = JSON.parse(branca.decode(branca.encode("{}")).payload);
```

Decode it first with `new TextDecoder().decode(payload)`, or wrap it with `Buffer.from(payload)` where
other code expects a `Buffer`.

### HIGH: Matching on the error message

Messages are written for people and can change. Check `error instanceof BrancaError`, then branch on
`error.code`.

### MEDIUM: Treating the header as secret

The payload is encrypted, but the version byte, timestamp and nonce are only authenticated: anyone who
holds a token can read when it was issued.

### MEDIUM: Large payloads

Encoding cost grows faster than the payload, because base62 is quadratic in the token length. Put claims
or ids in tokens, not documents.

## Completion check

- Every `decode` passes a positive `ttl` that fits the token's purpose.
- Keys are 32 random bytes from a secret store, and no code outside tests passes `nonce`.
- Error handling branches on `error.code`, and only verification failures become "unauthenticated".
- A round trip works and another key is rejected:

```ts
import { Branca } from "branca-rs";
import { BrancaError } from "branca-rs/errors";
import { generateKey } from "branca-rs/utils";

const branca = new Branca(generateKey());
const token = branca.encode("check");
console.log(new TextDecoder().decode(branca.decode(token, { ttl: 60 }).payload)); // "check"
try {
  new Branca(generateKey()).decode(token, { ttl: 60 });
} catch (error) {
  console.log(error instanceof BrancaError && error.code); // "DECRYPTION_FAILED"
}
```

## References

The package README covers the whole [API](../../README.md#api) and the
[security guidance](../../README.md#security-guidance).

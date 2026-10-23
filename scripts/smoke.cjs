// Exercises the built package from CommonJS. `require()` of the ESM build works on Node.js 20.19+
// and 22.12+ because the package has no top-level await. Also runs under Bun.
const { Branca, BrancaError, decode, encode, generateKey } = require("../dist/index.js");

const key = generateKey();
const token = encode(key, "smoke test");
const { payload } = decode(key, token, { ttl: 60 });
if (new TextDecoder().decode(payload) !== "smoke test") throw new Error("round trip failed");

try {
  new Branca(generateKey()).decode(token);
  throw new Error("decoding with the wrong key succeeded");
} catch (error) {
  if (!(error instanceof BrancaError) || error.code !== "DECRYPTION_FAILED") throw error;
}

const runtime = process.versions.bun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`;
console.log(`ok cjs (${runtime}): ${token.length}-char token`);

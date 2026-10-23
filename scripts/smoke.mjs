// Exercises the built package the way an ESM consumer would. Runs under Node.js and Bun
// (see `bun run smoke`).
import { BrancaError } from "../dist/errors.js";
import { Branca, decode, encode } from "../dist/index.js";
import { isInitialized } from "../dist/init.js";
import { generateKey } from "../dist/utils.js";

const key = generateKey();
const token = encode(key, "smoke test");
const { payload, timestamp } = decode(key, token, { ttl: 60 });
const text = new TextDecoder().decode(payload);
if (text !== "smoke test") throw new Error(`round trip failed: ${text}`);
if (Math.abs(timestamp - Date.now() / 1000) > 5) throw new Error(`unexpected timestamp ${timestamp}`);
if (!isInitialized()) throw new Error("the init entry does not share state with the main entry");

try {
  new Branca(generateKey()).decode(token);
  throw new Error("decoding with the wrong key succeeded");
} catch (error) {
  if (!(error instanceof BrancaError) || error.code !== "DECRYPTION_FAILED") throw error;
}

const runtime =
  globalThis.Bun !== undefined ? `bun ${globalThis.Bun.version}` : `node ${process.versions.node}`;
console.log(`ok esm (${runtime}): ${token.length}-char token`);

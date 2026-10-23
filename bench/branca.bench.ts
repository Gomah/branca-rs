/**
 * Benchmarks branca-rs against branca-js, the original implementation published on npm as `branca`
 * (https://github.com/tuupola/branca-js, built on libsodium.js and base-x).
 *
 *   bun bench/branca.bench.ts          # or: node bench/branca.bench.ts
 *   bun run bench:report               # both runtimes, rewrites bench/RESULTS.md and the README table
 *
 * Pass --json for machine-readable output (used by bench/report.ts). The benchmark imports the
 * TypeScript sources directly (Node strips types natively), so it needs `bun run build:wasm`.
 */
import createBrancaJs from "branca";
import { ready } from "libsodium-wrappers";
import { bench, group, run } from "mitata";
import { Branca } from "../src/index.ts";

await ready;

const KEY_HEX = "73757065727365637265746b6579796f7573686f756c646e6f74636f6d6d6974";
const brancaRs = new Branca(Buffer.from(KEY_HEX, "hex"));
const brancaJs = createBrancaJs(KEY_HEX);

/** Payload sizes in bytes: a session id, typical claims, and two larger documents. */
const SIZES = [16, 128, 1024, 4096];

export interface BenchSummary {
  runtime: string;
  version: string;
  arch: string;
  cpu: string;
  /** One entry per (group, implementation); times are nanoseconds per operation. */
  results: Array<{ group: string; name: string; avgNs: number; p75Ns: number }>;
}

/** The parts of mitata's trial object this file relies on. Groups are reported as numeric ids. */
interface Trial {
  context: { runtime: string; version: string; arch: string; cpu: { name: string } };
  benchmarks: Array<{
    alias: string;
    group: number | null;
    runs: Array<{ stats: { avg: number; p75: number } }>;
  }>;
}

function makePayload(size: number): Uint8Array {
  return Uint8Array.from({ length: size }, (_, i) => 33 + (i % 90)); // printable ASCII
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${bytes / 1024} KiB`;
}

const cases = SIZES.map((size) => {
  const payload = makePayload(size);
  const token = brancaRs.encode(payload);
  // Refuse to measure anything unless both implementations accept each other's tokens.
  if (!sameBytes(new Uint8Array(brancaJs.decode(token)), payload))
    throw new Error("branca-js rejected a branca-rs token");
  if (!sameBytes(brancaRs.decode(brancaJs.encode(payload)).payload, payload))
    throw new Error("branca-rs rejected a branca-js token");
  return { size, payload, token };
});

const groupNames: string[] = [];
function namedGroup(name: string, register: () => void): void {
  groupNames.push(name);
  group(name, register);
}

for (const { size, payload, token } of cases) {
  namedGroup(`encode ${formatSize(size)}`, () => {
    bench("branca-rs", () => brancaRs.encode(payload));
    bench("branca-js", () => brancaJs.encode(payload));
  });
  namedGroup(`decode ${formatSize(size)}`, () => {
    bench("branca-rs", () => brancaRs.decode(token));
    bench("branca-js", () => brancaJs.decode(token));
  });
}

const json = process.argv.includes("--json");
const trial = (await run(json ? { format: "quiet" } : {})) as unknown as Trial;

if (json) {
  // Group ids are assigned in registration order, so zip them with the names registered above.
  const ids = [...new Set(trial.benchmarks.map((b) => b.group))];
  const nameOf = new Map(ids.map((id, i) => [id, groupNames[i] ?? String(id)]));
  const summary: BenchSummary = {
    runtime: trial.context.runtime,
    version: trial.context.version,
    arch: trial.context.arch,
    cpu: trial.context.cpu.name,
    results: trial.benchmarks.map((b) => ({
      group: nameOf.get(b.group) ?? String(b.group),
      name: b.alias,
      avgNs: b.runs[0]?.stats.avg ?? Number.NaN,
      p75Ns: b.runs[0]?.stats.p75 ?? Number.NaN,
    })),
  };
  console.log(JSON.stringify(summary));
}

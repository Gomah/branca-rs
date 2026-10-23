// The "branca-rs/init" entry point has process-wide state, so each scenario runs in its own process.
import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const fixture = resolve(import.meta.dir, "fixtures/init-check.ts");
const modes = ["sync", "async", "concurrent", "bytes", "module", "promise", "sync-module"];

describe("explicit initialization (branca-rs/init)", () => {
  for (const mode of modes) {
    test(mode, () => {
      const result = Bun.spawnSync(["bun", fixture, mode], { stdout: "pipe", stderr: "pipe" });
      expect(result.stderr.toString()).toBe("");
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString().trim()).toBe(`ok ${mode}`);
    });
  }
});

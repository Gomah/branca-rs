import type { UserConfig } from "tsdown";

const config: UserConfig = {
  entry: {
    index: "src/index.ts",
    init: "src/init.ts",
  },
  format: "esm",
  platform: "neutral",
  target: "es2022",
  dts: true,
  clean: true,
  // Also ship the raw module, for runtimes that must import .wasm as a module (Cloudflare Workers).
  // It is exported as "branca-rs/branca.wasm" (see package.json).
  copy: [{ from: "src/generated/branca_bg.wasm", to: "dist" }],
};

export default config;

// Minimal typings for the untyped legacy packages used by the interoperability tests.
declare module "branca" {
  interface LegacyBranca {
    encode(message: string | Uint8Array, timestamp?: number): string;
    decode(token: string, ttl?: number): Buffer;
    timestamp(token: string): number;
  }
  function createBranca(key: string | Uint8Array): LegacyBranca;
  export = createBranca;
}

declare module "libsodium-wrappers" {
  export const ready: Promise<void>;
}

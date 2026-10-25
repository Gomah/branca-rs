---
"branca-rs": patch
---

Rebuilt the WebAssembly module with updated Rust dependencies. The only crate that changed in the shipped module is `ctutils`, now 0.4.5, the constant-time helpers `chacha20poly1305` uses to compare authentication tags. The 0.4.4 and 0.4.5 releases fixed the constant-time code generation of `Choice` masks and of comparisons on 32-bit targets such as `wasm32`. The token format and the JavaScript API are unchanged.

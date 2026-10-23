//! wasm-bindgen surface consumed by `src/wasm.ts`. Errors cross the boundary as JS `Error`s whose
//! message is the stable machine-readable code from [`crate::Error::code`]; the TypeScript wrapper
//! turns them into `BrancaError`s.

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn encode(key: &[u8], nonce: &[u8], timestamp: u32, payload: &[u8]) -> Result<String, JsError> {
    crate::encode(key, nonce, timestamp, payload).map_err(|e| JsError::new(e.code()))
}

/// Returns `timestamp (4 bytes, big-endian) || payload`, so a decode costs a single allocation and
/// no JS object has to be constructed from Rust.
#[wasm_bindgen]
pub fn decode(key: &[u8], token: &str, ttl: u32, now: u32) -> Result<Vec<u8>, JsError> {
    let decoded = crate::decode(key, token, ttl, now).map_err(|e| JsError::new(e.code()))?;
    let mut out = Vec::with_capacity(4 + decoded.payload.len());
    out.extend_from_slice(&decoded.timestamp.to_be_bytes());
    out.extend_from_slice(&decoded.payload);
    Ok(out)
}

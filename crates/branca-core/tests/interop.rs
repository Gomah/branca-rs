//! Cross-checks against the reference Rust implementation (the `branca` crate).

use branca_core::{decode, encode};

const KEY: &[u8; 32] = b"supersecretkeyyoushouldnotcommit";

#[test]
fn the_reference_crate_decodes_our_tokens() {
    let nonce = [0x42u8; 24];
    let token = encode(KEY, &nonce, 123_206_400, b"Hello world!").unwrap();
    assert_eq!(branca::decode(&token, KEY, 0).unwrap(), b"Hello world!");
}

#[test]
fn we_decode_tokens_from_the_reference_crate() {
    let token = branca::encode(b"Hello world!", KEY, 123_206_400).unwrap();
    let decoded = decode(KEY, &token, 0, 0).unwrap();
    assert_eq!(decoded.payload, b"Hello world!");
    assert_eq!(decoded.timestamp, 123_206_400);
}

#[test]
fn both_agree_on_binary_payloads_and_expiry() {
    let payload: Vec<u8> = (0..=255u8).collect();
    let token = branca::encode(&payload, KEY, 123_206_400).unwrap();
    assert_eq!(decode(KEY, &token, 0, 0).unwrap().payload, payload);
    assert!(branca::decode(&token, KEY, 60).is_err());
    assert!(decode(KEY, &token, 60, 123_206_461).is_err());
}

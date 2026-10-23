//! Core implementation of the [Branca token specification](https://github.com/tuupola/branca-spec).
//!
//! A token is `version (1) || timestamp (4, big-endian) || nonce (24) || ciphertext || tag (16)`,
//! encrypted with IETF XChaCha20-Poly1305 using the 29-byte header as additional authenticated
//! data, and encoded as base62.
//!
//! The crate is deliberately pure: callers supply the nonce and the current time. That keeps it
//! deterministic, trivially testable, and free of platform dependencies (no clock, no RNG) when
//! compiled to `wasm32-unknown-unknown`. The TypeScript wrapper draws nonces from
//! `crypto.getRandomValues` and timestamps from `Date.now()`.

#![forbid(unsafe_code)]

pub mod base62;
#[cfg(target_arch = "wasm32")]
mod wasm;

use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};

/// The version byte every Branca token starts with.
pub const TOKEN_VERSION: u8 = 0xBA;
/// Key length in bytes.
pub const KEY_LEN: usize = 32;
/// Nonce length in bytes.
pub const NONCE_LEN: usize = 24;
/// Poly1305 tag length in bytes.
pub const TAG_LEN: usize = 16;
/// Header length in bytes: version, timestamp and nonce.
pub const HEADER_LEN: usize = 1 + 4 + NONCE_LEN;
/// Smallest possible decoded token: a header plus the tag of an empty payload.
pub const MIN_TOKEN_LEN: usize = HEADER_LEN + TAG_LEN;

/// Everything that can go wrong while encoding or decoding a token.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Error {
    /// The key is not exactly [`KEY_LEN`] bytes.
    InvalidKeyLength,
    /// The nonce is not exactly [`NONCE_LEN`] bytes.
    InvalidNonceLength,
    /// The token contains characters outside the base62 alphabet.
    InvalidBase62,
    /// The decoded token is shorter than [`MIN_TOKEN_LEN`].
    InvalidTokenLength,
    /// The first byte is not [`TOKEN_VERSION`].
    InvalidVersion,
    /// The AEAD refused to encrypt (only possible for payloads beyond its 256 GiB limit).
    EncryptionFailed,
    /// Authentication failed: wrong key, or the header/ciphertext/tag were tampered with.
    DecryptionFailed,
    /// `timestamp + ttl` does not fit in 32 bits, which the specification forbids.
    TtlOverflow,
    /// `timestamp + ttl` is in the past.
    Expired,
}

impl Error {
    /// Stable machine-readable code, mirrored by the TypeScript `BrancaErrorCode` union.
    pub const fn code(self) -> &'static str {
        match self {
            Error::InvalidKeyLength => "INVALID_KEY",
            Error::InvalidNonceLength => "INVALID_NONCE",
            Error::InvalidBase62 => "INVALID_BASE62",
            Error::InvalidTokenLength => "INVALID_TOKEN",
            Error::InvalidVersion => "INVALID_VERSION",
            Error::EncryptionFailed => "ENCRYPTION_FAILED",
            Error::DecryptionFailed => "DECRYPTION_FAILED",
            Error::TtlOverflow => "TTL_OVERFLOW",
            Error::Expired => "TOKEN_EXPIRED",
        }
    }
}

impl core::fmt::Display for Error {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(match self {
            Error::InvalidKeyLength => "key must be exactly 32 bytes",
            Error::InvalidNonceLength => "nonce must be exactly 24 bytes",
            Error::InvalidBase62 => "token contains characters outside the base62 alphabet",
            Error::InvalidTokenLength => "token is too short to be a Branca token",
            Error::InvalidVersion => "unsupported token version (expected 0xBA)",
            Error::EncryptionFailed => "encryption failed",
            Error::DecryptionFailed => "token authentication failed (wrong key or tampered token)",
            Error::TtlOverflow => "timestamp + ttl overflows a 32-bit unsigned integer",
            Error::Expired => "token has expired",
        })
    }
}

impl std::error::Error for Error {}

/// A successfully decoded token.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Decoded {
    /// The authenticated timestamp from the header, in seconds since the Unix epoch.
    pub timestamp: u32,
    /// The decrypted payload.
    pub payload: Vec<u8>,
}

/// Encrypts `payload` into a Branca token.
///
/// `key` must be 32 bytes and `nonce` 24 *unique* random bytes; `timestamp` is seconds since the
/// Unix epoch and is authenticated but not encrypted.
pub fn encode(key: &[u8], nonce: &[u8], timestamp: u32, payload: &[u8]) -> Result<String, Error> {
    let cipher = XChaCha20Poly1305::new_from_slice(key).map_err(|_| Error::InvalidKeyLength)?;
    let nonce = XNonce::try_from(nonce).map_err(|_| Error::InvalidNonceLength)?;

    let mut header = [0u8; HEADER_LEN];
    header[0] = TOKEN_VERSION;
    header[1..5].copy_from_slice(&timestamp.to_be_bytes());
    header[5..].copy_from_slice(&nonce);

    let ciphertext = cipher
        .encrypt(
            &nonce,
            Payload {
                msg: payload,
                aad: &header,
            },
        )
        .map_err(|_| Error::EncryptionFailed)?;

    let mut raw = Vec::with_capacity(HEADER_LEN + ciphertext.len());
    raw.extend_from_slice(&header);
    raw.extend_from_slice(&ciphertext);
    Ok(base62::encode(&raw))
}

/// Decrypts and verifies `token`.
///
/// When `ttl` is non-zero the token is rejected if `timestamp + ttl < now` (`now` in seconds since
/// the Unix epoch). As the specification requires, that check happens only after the token has
/// been authenticated, and an overflowing sum is an error rather than a token that never expires.
pub fn decode(key: &[u8], token: &str, ttl: u32, now: u32) -> Result<Decoded, Error> {
    let cipher = XChaCha20Poly1305::new_from_slice(key).map_err(|_| Error::InvalidKeyLength)?;
    let raw = base62::decode(token).map_err(|_| Error::InvalidBase62)?;
    if raw.len() < MIN_TOKEN_LEN {
        return Err(Error::InvalidTokenLength);
    }
    if raw[0] != TOKEN_VERSION {
        return Err(Error::InvalidVersion);
    }

    let (header, body) = raw.split_at(HEADER_LEN);
    let timestamp = u32::from_be_bytes([header[1], header[2], header[3], header[4]]);
    let nonce = XNonce::try_from(&header[5..]).map_err(|_| Error::InvalidTokenLength)?;
    let payload = cipher
        .decrypt(
            &nonce,
            Payload {
                msg: body,
                aad: header,
            },
        )
        .map_err(|_| Error::DecryptionFailed)?;

    if ttl != 0 {
        let expires_at = timestamp.checked_add(ttl).ok_or(Error::TtlOverflow)?;
        if expires_at < now {
            return Err(Error::Expired);
        }
    }

    Ok(Decoded { timestamp, payload })
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &[u8; 32] = b"supersecretkeyyoushouldnotcommit";
    const NONCE: &[u8; 24] = &[
        0xBE, 0xEF, 0xBE, 0xEF, 0xBE, 0xEF, 0xBE, 0xEF, 0xBE, 0xEF, 0xBE, 0xEF, 0xBE, 0xEF, 0xBE,
        0xEF, 0xBE, 0xEF, 0xBE, 0xEF, 0xBE, 0xEF, 0xBE, 0xEF,
    ];

    #[test]
    fn round_trip() {
        let token = encode(KEY, NONCE, 123_206_400, b"Hello world!").unwrap();
        let decoded = decode(KEY, &token, 0, 0).unwrap();
        assert_eq!(decoded.timestamp, 123_206_400);
        assert_eq!(decoded.payload, b"Hello world!");
    }

    #[test]
    fn empty_payload_is_the_shortest_token() {
        let token = encode(KEY, NONCE, 0, b"").unwrap();
        assert_eq!(base62::decode(&token).unwrap().len(), MIN_TOKEN_LEN);
        assert_eq!(decode(KEY, &token, 0, 0).unwrap().payload, b"");
    }

    #[test]
    fn validates_lengths() {
        assert_eq!(
            encode(&KEY[..31], NONCE, 0, b"x"),
            Err(Error::InvalidKeyLength)
        );
        assert_eq!(
            encode(KEY, &NONCE[..23], 0, b"x"),
            Err(Error::InvalidNonceLength)
        );
        assert_eq!(
            decode(&KEY[..31], "870S4", 0, 0),
            Err(Error::InvalidKeyLength)
        );
        assert_eq!(decode(KEY, "870S4", 0, 0), Err(Error::InvalidTokenLength));
        assert_eq!(decode(KEY, "870S4!", 0, 0), Err(Error::InvalidBase62));
    }

    #[test]
    fn rejects_wrong_key_and_tampering() {
        let token = encode(KEY, NONCE, 0, b"Hello world!").unwrap();
        let other_key = b"wrongsecretkeyyoushouldnotcommit";
        assert_eq!(
            decode(other_key, &token, 0, 0),
            Err(Error::DecryptionFailed)
        );

        let mut raw = base62::decode(&token).unwrap();
        for index in [1, 5, HEADER_LEN, raw.len() - 1] {
            raw[index] ^= 0x01;
            assert_eq!(
                decode(KEY, &base62::encode(&raw), 0, 0),
                Err(Error::DecryptionFailed),
                "byte {index}"
            );
            raw[index] ^= 0x01;
        }

        raw[0] = 0xBB;
        assert_eq!(
            decode(KEY, &base62::encode(&raw), 0, 0),
            Err(Error::InvalidVersion)
        );
    }

    #[test]
    fn ttl_is_checked_after_authentication() {
        let token = encode(KEY, NONCE, 1_000, b"x").unwrap();
        assert!(
            decode(KEY, &token, 60, 1_060).is_ok(),
            "expiring right now is still valid"
        );
        assert_eq!(decode(KEY, &token, 60, 1_061), Err(Error::Expired));
        assert!(
            decode(KEY, &token, 0, u32::MAX).is_ok(),
            "ttl 0 disables the check"
        );
        assert_eq!(
            decode(KEY, &token, u32::MAX, 1_000),
            Err(Error::TtlOverflow)
        );

        let wrong = b"wrongsecretkeyyoushouldnotcommit";
        assert_eq!(
            decode(wrong, &token, 60, 1_061),
            Err(Error::DecryptionFailed)
        );
    }

    #[test]
    fn error_codes_are_unique() {
        let all = [
            Error::InvalidKeyLength,
            Error::InvalidNonceLength,
            Error::InvalidBase62,
            Error::InvalidTokenLength,
            Error::InvalidVersion,
            Error::EncryptionFailed,
            Error::DecryptionFailed,
            Error::TtlOverflow,
            Error::Expired,
        ];
        let mut codes: Vec<&str> = all.iter().map(|e| e.code()).collect();
        codes.sort_unstable();
        codes.dedup();
        assert_eq!(codes.len(), all.len());
    }
}

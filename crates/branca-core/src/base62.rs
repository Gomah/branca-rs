//! Base62 encoding with the Branca alphabet, compatible with the `base-x` family of encoders:
//! the input is treated as a big-endian number, and each leading zero byte becomes a leading `0`.
//!
//! Instead of one base-62 digit per limb, the conversions work on limbs of `62^5` (encoding) and
//! `2^32` (decoding) and consume the input in chunks of 4 bytes / 5 characters, which cuts the
//! quadratic inner loop by roughly 20x compared to the textbook algorithm.

/// The Branca base62 alphabet.
pub const ALPHABET: &[u8; 62] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/// Radix of one limb while encoding: `62^5`, which fits in 30 bits.
const ENCODE_LIMB: u64 = 62 * 62 * 62 * 62 * 62;

const INVALID: u8 = 0xFF;

const fn build_lookup() -> [u8; 256] {
    let mut table = [INVALID; 256];
    let mut i = 0;
    while i < ALPHABET.len() {
        table[ALPHABET[i] as usize] = i as u8;
        i += 1;
    }
    table
}

static LOOKUP: [u8; 256] = build_lookup();

/// The input contained a character outside of [`ALPHABET`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InvalidCharacter;

/// Encodes `input` as base62.
pub fn encode(input: &[u8]) -> String {
    let zeros = input.iter().take_while(|&&b| b == 0).count();
    let rest = &input[zeros..];

    // Little-endian limbs in base 62^5. Each input byte carries 8 bits, each limb ~29.77 bits.
    let mut limbs: Vec<u32> = Vec::with_capacity(rest.len() * 8 / 29 + 1);
    for chunk in rest.chunks(4) {
        // Multiply the accumulated number by 256^k and add the chunk's big-endian value.
        let mut mul: u64 = 1;
        let mut carry: u64 = 0;
        for &byte in chunk {
            mul <<= 8;
            carry = (carry << 8) | u64::from(byte);
        }
        for limb in limbs.iter_mut() {
            // limb < 2^30 and mul <= 2^32, so the product stays well below 2^63.
            let v = u64::from(*limb) * mul + carry;
            *limb = (v % ENCODE_LIMB) as u32;
            carry = v / ENCODE_LIMB;
        }
        while carry > 0 {
            limbs.push((carry % ENCODE_LIMB) as u32);
            carry /= ENCODE_LIMB;
        }
    }

    let mut out = Vec::with_capacity(zeros + limbs.len() * 5);
    out.resize(zeros, b'0');

    // The most significant limb is never zero (see the tests), so it is emitted without padding;
    // every lower limb is emitted as exactly five digits.
    let mut iter = limbs.iter().rev();
    if let Some(&top) = iter.next() {
        let mut digits = [0u8; 5];
        let mut n = 0;
        let mut v = top;
        while v > 0 {
            digits[n] = ALPHABET[(v % 62) as usize];
            v /= 62;
            n += 1;
        }
        out.extend(digits[..n].iter().rev());
        for &limb in iter {
            let mut v = limb;
            let mut digits = [b'0'; 5];
            for digit in digits.iter_mut().rev() {
                *digit = ALPHABET[(v % 62) as usize];
                v /= 62;
            }
            out.extend_from_slice(&digits);
        }
    }

    String::from_utf8(out).expect("base62 output is ASCII")
}

/// Decodes base62 `input` into bytes, rejecting any character outside of [`ALPHABET`].
pub fn decode(input: &str) -> Result<Vec<u8>, InvalidCharacter> {
    let bytes = input.as_bytes();
    let zeros = bytes.iter().take_while(|&&c| c == b'0').count();
    let rest = &bytes[zeros..];

    // Little-endian limbs in base 2^32. Each character carries ~5.95 bits.
    let mut limbs: Vec<u32> = Vec::with_capacity(rest.len() * 6 / 32 + 1);
    for chunk in rest.chunks(5) {
        // Multiply the accumulated number by 62^k and add the chunk's value.
        let mut mul: u64 = 1;
        let mut carry: u64 = 0;
        for &c in chunk {
            let digit = LOOKUP[c as usize];
            if digit == INVALID {
                return Err(InvalidCharacter);
            }
            mul *= 62;
            carry = carry * 62 + u64::from(digit);
        }
        for limb in limbs.iter_mut() {
            // limb < 2^32 and mul < 2^30, so the product stays below 2^62.
            let v = u64::from(*limb) * mul + carry;
            *limb = v as u32;
            carry = v >> 32;
        }
        while carry > 0 {
            limbs.push(carry as u32);
            carry >>= 32;
        }
    }

    let mut out = vec![0u8; zeros];
    out.reserve(limbs.len() * 4);
    let mut iter = limbs.iter().rev();
    if let Some(&top) = iter.next() {
        let be = top.to_be_bytes();
        let skip = be.iter().take_while(|&&b| b == 0).count();
        out.extend_from_slice(&be[skip..]);
        for &limb in iter {
            out.extend_from_slice(&limb.to_be_bytes());
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn small_values() {
        assert_eq!(encode(&[]), "");
        assert_eq!(encode(&[0]), "0");
        assert_eq!(encode(&[0, 0]), "00");
        assert_eq!(encode(&[1]), "1");
        assert_eq!(encode(&[61]), "z");
        assert_eq!(encode(&[62]), "10");
        assert_eq!(encode(&[255]), "47");
        assert_eq!(encode(&[1, 0]), "48");
        assert_eq!(encode(&[0xBA]), "30");
        assert_eq!(encode(&[0, 0, 62]), "0010");
    }

    #[test]
    fn decode_small_values() {
        assert_eq!(decode("").unwrap(), Vec::<u8>::new());
        assert_eq!(decode("0").unwrap(), vec![0]);
        assert_eq!(decode("00").unwrap(), vec![0, 0]);
        assert_eq!(decode("z").unwrap(), vec![61]);
        assert_eq!(decode("10").unwrap(), vec![62]);
        assert_eq!(decode("47").unwrap(), vec![255]);
        assert_eq!(decode("0010").unwrap(), vec![0, 0, 62]);
    }

    #[test]
    fn rejects_characters_outside_the_alphabet() {
        for bad in [
            "-",
            " ",
            "abc_",
            "é",
            "870S4BYxgHw0KnP3W9fgVUHEhT5g86vJ17etaC5Kh5uIraWHCI1psNQGv298ZmjPwoYbjDQ9chy2z!",
        ] {
            assert_eq!(decode(bad), Err(InvalidCharacter), "{bad:?}");
        }
    }

    #[test]
    fn round_trips_across_chunk_boundaries() {
        // Deterministic pseudo-random bytes (xorshift) so the test needs no extra dependencies.
        let mut state: u64 = 0x9E37_79B9_7F4A_7C15;
        let mut next = || {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            state as u8
        };
        for len in 0..130 {
            for leading_zeros in [0, 1, 3, 4, 5] {
                let mut data: Vec<u8> = (0..len).map(|_| next()).collect();
                if len > 0 {
                    data[0] |= 1; // make sure the first "real" byte is non-zero
                }
                let mut input = vec![0u8; leading_zeros];
                input.extend_from_slice(&data);
                let encoded = encode(&input);
                assert!(encoded.bytes().all(|c| LOOKUP[c as usize] != INVALID));
                assert_eq!(
                    decode(&encoded).unwrap(),
                    input,
                    "len={len} zeros={leading_zeros}"
                );
            }
        }
    }

    #[test]
    fn matches_the_bignum_definition() {
        // 0xBA 0x00 0x00 = 12_189_696 = 51*62^3 + 9*62^2 + 6*62 + 0 -> "p960"
        assert_eq!(encode(&[0xBA, 0x00, 0x00]), "p960");
        assert_eq!(decode("p960").unwrap(), vec![0xBA, 0x00, 0x00]);
    }
}

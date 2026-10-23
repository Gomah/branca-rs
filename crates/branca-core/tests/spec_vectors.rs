//! Runs the official test vectors from https://github.com/tuupola/branca-spec
//! (checked in at test/vectors/branca-spec.json and shared with the TypeScript tests).

use branca_core::{Error, decode, encode};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Vectors {
    version: String,
    number_of_tests: usize,
    test_groups: Vec<Group>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Group {
    test_type: String,
    tests: Vec<Case>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Case {
    id: u32,
    comment: String,
    key: String,
    nonce: Option<String>,
    timestamp: u32,
    token: String,
    msg: Option<String>,
    is_valid: bool,
}

const VECTORS: &str = include_str!("../../../test/vectors/branca-spec.json");

fn load() -> Vectors {
    serde_json::from_str(VECTORS).expect("valid test vector file")
}

fn group<'a>(vectors: &'a Vectors, kind: &str) -> &'a [Case] {
    &vectors
        .test_groups
        .iter()
        .find(|g| g.test_type == kind)
        .expect("group exists")
        .tests
}

/// The failure the spec describes in the vector's comment, in our error vocabulary.
fn expected_error(comment: &str) -> Error {
    let comment = comment.to_ascii_lowercase();
    if comment.contains("base62") {
        Error::InvalidBase62
    } else if comment.contains("version") {
        Error::InvalidVersion
    } else if comment.contains("invalid key") {
        Error::InvalidKeyLength
    } else {
        Error::DecryptionFailed
    }
}

#[test]
fn covers_every_vector() {
    let vectors = load();
    assert_eq!(vectors.version, "0.3.0");
    let total: usize = vectors.test_groups.iter().map(|g| g.tests.len()).sum();
    assert_eq!(total, vectors.number_of_tests);
    assert_eq!(group(&vectors, "encoding").len(), 8);
    assert_eq!(group(&vectors, "decoding").len(), 17);
}

#[test]
fn encoding_vectors() {
    let vectors = load();
    for case in group(&vectors, "encoding") {
        let key = hex::decode(&case.key).unwrap();
        let nonce = hex::decode(
            case.nonce
                .as_deref()
                .expect("encoding vectors carry a nonce"),
        )
        .unwrap();
        let msg = hex::decode(
            case.msg
                .as_deref()
                .expect("encoding vectors carry a message"),
        )
        .unwrap();
        let token = encode(&key, &nonce, case.timestamp, &msg).unwrap();
        assert_eq!(token, case.token, "#{} {}", case.id, case.comment);
    }
}

#[test]
fn decoding_vectors() {
    let vectors = load();
    for case in group(&vectors, "decoding") {
        let key = hex::decode(&case.key).unwrap();
        let result = decode(&key, &case.token, 0, 0);
        if case.is_valid {
            let decoded = result.unwrap_or_else(|e| panic!("#{} {}: {e}", case.id, case.comment));
            assert_eq!(
                Some(hex::encode(&decoded.payload)),
                case.msg,
                "#{} {}",
                case.id,
                case.comment
            );
            assert_eq!(
                decoded.timestamp, case.timestamp,
                "#{} {}",
                case.id, case.comment
            );
        } else {
            assert_eq!(
                result,
                Err(expected_error(&case.comment)),
                "#{} {}",
                case.id,
                case.comment
            );
        }
    }
}

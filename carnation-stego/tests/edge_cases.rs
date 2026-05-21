//! Edge case tests for the steganography engine.
//! Tests empty messages, unicode, binary payloads, and boundary conditions.

use carnation_stego::{encode, decode};
use carnation_stego::framing::{self, Version};

fn make_signal(duration_secs: usize) -> Vec<f64> {
    let n = 44100 * duration_secs;
    (0..n)
        .map(|i| {
            let t = i as f64 / 44100.0;
            (440.0 * 2.0 * std::f64::consts::PI * t).sin() * 16000.0
        })
        .collect()
}

fn roundtrip(message: &[u8], duration_secs: usize) -> Vec<u8> {
    let samples = make_signal(duration_secs);
    let key = b"edge-case-key";
    let encoded = encode(&samples, message, key, Some(Version::PasswordRepetition)).unwrap();
    let decoded = decode(&encoded, key, None).unwrap();
    framing::parse_payload(&decoded).unwrap().data.to_vec()
}

#[test]
fn test_single_byte_message() {
    assert_eq!(roundtrip(b"X", 30), b"X");
}

#[test]
fn test_empty_message() {
    assert_eq!(roundtrip(b"", 30), b"");
}

#[test]
fn test_binary_payload() {
    // All byte values 0x00-0xFF
    let payload: Vec<u8> = (0..=255).collect();
    // Need longer audio for 256 bytes
    assert_eq!(roundtrip(&payload, 180), payload);
}

#[test]
fn test_utf8_unicode() {
    let msg = "Solidarität! \u{2764}\u{fe0f} \u{1f338}".as_bytes();
    assert_eq!(roundtrip(msg, 30), msg);
}

#[test]
fn test_null_bytes() {
    let msg = b"\x00\x00\x00hello\x00world\x00\x00";
    assert_eq!(roundtrip(msg, 30), msg);
}

#[test]
fn test_repeated_encode_decode() {
    // Encode twice with different messages, decode should get the last one
    let samples = make_signal(30);
    let key = b"double-encode";
    let msg1 = b"first message";
    let msg2 = b"second message";

    let encoded1 = encode(&samples, msg1, key, Some(Version::PasswordRepetition)).unwrap();
    // Re-encode over already-encoded samples
    let encoded2 = encode(&encoded1, msg2, key, Some(Version::PasswordRepetition)).unwrap();

    let decoded = decode(&encoded2, key, None).unwrap();
    let parsed = framing::parse_payload(&decoded).unwrap();
    assert_eq!(parsed.data, msg2);
}

#[test]
fn test_minimum_viable_audio_length() {
    // Calculate minimum audio needed for a 1-byte message
    // Frame: 4 (sync) + 4 (length) + 1 (version) + 1 (data) = 10 bytes = 80 bits
    // With 17x rep: 80 * 17 = 1360 slots needed
    // At 6 slots/frame: ceil(1360/6) = 227 frames
    // At 1024 samples/frame: 227 * 1024 = 232448 samples
    // At 44100 Hz: ~5.27 seconds
    let samples = make_signal(6); // 6 seconds — just enough
    let key = b"min-length";
    let msg = b"!";
    let encoded = encode(&samples, msg, key, Some(Version::PasswordRepetition)).unwrap();
    let decoded = decode(&encoded, key, None).unwrap();
    let parsed = framing::parse_payload(&decoded).unwrap();
    assert_eq!(parsed.data, msg);
}

use carnation_stego::{encode, decode};
use carnation_stego::framing::Version;

#[test]
fn test_encode_decode_round_trip() {
    // Generate a test signal (sine wave, 30 seconds at 44100Hz)
    // Need enough frames: 30s * 44100 / 1024 = ~1291 frames * 6 pairs = 7746 slots
    // With 17x repetition: ~455 logical bits = ~56 bytes capacity
    let sample_rate = 44100;
    let duration_secs = 30;
    let n_samples = sample_rate * duration_secs;
    let samples: Vec<f64> = (0..n_samples)
        .map(|i| {
            let t = i as f64 / sample_rate as f64;
            (440.0 * 2.0 * std::f64::consts::PI * t).sin() * 16000.0
        })
        .collect();

    let key = b"test-password-123";
    let message = b"Hello from Carnation Radio!";

    let encoded = encode(&samples, message, key, Some(Version::PasswordRepetition)).unwrap();
    assert_eq!(encoded.len(), samples.len());

    let decoded = decode(&encoded, key, None).unwrap();
    // decoded contains version byte + message
    let parsed = carnation_stego::framing::parse_payload(&decoded).unwrap();
    assert_eq!(parsed.version, Version::PasswordRepetition);
    assert_eq!(parsed.data, message);
}

#[test]
fn test_wrong_key_fails() {
    let samples: Vec<f64> = (0..44100 * 30)
        .map(|i| (i as f64 / 100.0).sin() * 16000.0)
        .collect();

    let encoded = encode(&samples, b"Secret", b"right-key", Some(Version::PasswordRepetition)).unwrap();
    let result = decode(&encoded, b"wrong-key", None);
    assert!(result.is_err());
}

#[test]
fn test_long_message() {
    let samples: Vec<f64> = (0..44100 * 180) // 3 minutes
        .map(|i| {
            let t = i as f64 / 44100.0;
            (440.0 * 2.0 * std::f64::consts::PI * t).sin() * 16000.0
                + (880.0 * 2.0 * std::f64::consts::PI * t).sin() * 8000.0
        })
        .collect();

    let key = b"longer-key-test";
    // ~200 bytes - should fit in 10 seconds of audio
    let message = b"This is a longer test message to verify that the steganography engine can handle messages of moderate length without corruption or data loss during the encode/decode cycle.";

    let encoded = encode(&samples, message, key, Some(Version::PasswordRepetition)).unwrap();
    let decoded = decode(&encoded, key, None).unwrap();
    let parsed = carnation_stego::framing::parse_payload(&decoded).unwrap();
    assert_eq!(parsed.data, message);
}

#[test]
fn test_message_too_long() {
    // Very short audio - 2 seconds
    let samples: Vec<f64> = (0..44100 * 2)
        .map(|i| (i as f64 / 100.0).sin() * 16000.0)
        .collect();

    // Try to embed a very long message
    let message = vec![0x42u8; 500];
    let result = encode(&samples, &message, b"key", Some(Version::PasswordRepetition));
    assert!(result.is_err());
}

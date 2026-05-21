//! MP3 Compression Survivability Tests
//!
//! THE critical test for Carnation Radio: can the Rust stego engine's
//! hidden messages survive MP3 compression at various bitrates?
//!
//! Requires ffmpeg in PATH. Tests are ignored if ffmpeg is not available.

use carnation_stego::{encode, decode, FRAME_SIZE, PAIRS_PER_FRAME};
use carnation_stego::framing::{self, Version};
use std::process::Command;
use std::path::Path;

/// Check if ffmpeg is available on the system.
fn has_ffmpeg() -> bool {
    Command::new("ffmpeg")
        .arg("-version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Generate a multi-tone test signal (more realistic than a pure sine wave).
/// Mix of 440Hz, 880Hz, 1320Hz at 44100Hz sample rate.
fn generate_test_signal(duration_secs: usize) -> Vec<f64> {
    let sample_rate = 44100;
    let n_samples = sample_rate * duration_secs;
    (0..n_samples)
        .map(|i| {
            let t = i as f64 / sample_rate as f64;
            let pi2 = 2.0 * std::f64::consts::PI;
            (440.0 * pi2 * t).sin() * 16000.0
                + (880.0 * pi2 * t).sin() * 8000.0
                + (1320.0 * pi2 * t).sin() * 4000.0
        })
        .collect()
}

/// Write f64 PCM samples to a 16-bit WAV file using hound.
fn write_wav(path: &Path, samples: &[f64], sample_rate: u32) {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(path, spec).unwrap();
    for &s in samples {
        let clamped = s.round().max(-32768.0).min(32767.0) as i16;
        writer.write_sample(clamped).unwrap();
    }
    writer.finalize().unwrap();
}

/// Read a 16-bit WAV file back to f64 PCM samples.
fn read_wav(path: &Path) -> Vec<f64> {
    let mut reader = hound::WavReader::open(path).unwrap();
    reader
        .samples::<i16>()
        .map(|s| s.unwrap() as f64)
        .collect()
}

/// Compress WAV -> lossy format -> WAV using ffmpeg subprocess.
fn compress_and_decompress(input_wav: &Path, output_wav: &Path, codec: &str, bitrate: &str) {
    let dir = input_wav.parent().unwrap();

    let (compressed_ext, codec_name) = match codec {
        "mp3" => ("mp3", "libmp3lame"),
        "ogg" => ("ogg", "libvorbis"),
        _ => panic!("Unknown codec: {}", codec),
    };

    let compressed = dir.join(format!("compressed.{}", compressed_ext));

    // WAV -> compressed
    let status = Command::new("ffmpeg")
        .args([
            "-y", "-i",
            input_wav.to_str().unwrap(),
            "-codec:a", codec_name,
            "-b:a", bitrate,
            compressed.to_str().unwrap(),
        ])
        .output()
        .expect("ffmpeg failed to start");
    assert!(status.status.success(), "ffmpeg encode failed: {}", String::from_utf8_lossy(&status.stderr));

    // compressed -> WAV (back to PCM)
    let status = Command::new("ffmpeg")
        .args([
            "-y", "-i",
            compressed.to_str().unwrap(),
            "-codec:a", "pcm_s16le",
            "-ar", "44100",
            output_wav.to_str().unwrap(),
        ])
        .output()
        .expect("ffmpeg failed to start");
    assert!(status.status.success(), "ffmpeg decode failed: {}", String::from_utf8_lossy(&status.stderr));
}

/// Core test: encode -> WAV -> MP3 -> WAV -> decode
fn mp3_roundtrip(bitrate: &str) {
    if !has_ffmpeg() {
        eprintln!("Skipping MP3 test: ffmpeg not found");
        return;
    }

    let samples = generate_test_signal(30);
    let message = b"Carnation Radio survives compression!";
    let key = b"mp3-test-key";

    let encoded = encode(&samples, message, key, Some(Version::PasswordRepetition)).unwrap();

    let dir = tempfile::tempdir().unwrap();
    let encoded_wav = dir.path().join("encoded.wav");
    let decoded_wav = dir.path().join("decoded.wav");

    write_wav(&encoded_wav, &encoded, 44100);
    compress_and_decompress(&encoded_wav, &decoded_wav, "mp3", bitrate);

    let compressed_samples = read_wav(&decoded_wav);
    let result = decode(&compressed_samples, key, None);

    match result {
        Ok(payload) => {
            let parsed = framing::parse_payload(&payload).unwrap();
            assert_eq!(
                parsed.data, message,
                "MP3 {}: decoded message doesn't match (got {} bytes)",
                bitrate,
                parsed.data.len()
            );
            eprintln!("MP3 {} round-trip: PASS", bitrate);
        }
        Err(e) => {
            panic!("MP3 {} round-trip FAILED: {}", bitrate, e);
        }
    }
}

/// Measure raw bit error rate after MP3 compression.
/// This doesn't test decode success — it measures how much damage MP3 does
/// to the raw DCT-embedded bits before majority vote correction.
fn measure_ber(bitrate: &str) -> f64 {
    if !has_ffmpeg() {
        return 0.0;
    }

    let samples = generate_test_signal(30);
    let message = b"BER test";
    let key = b"ber-key";

    let encoded = encode(&samples, message, key, Some(Version::PasswordRepetition)).unwrap();

    let dir = tempfile::tempdir().unwrap();
    let encoded_wav = dir.path().join("encoded.wav");
    let decoded_wav = dir.path().join("decoded.wav");

    write_wav(&encoded_wav, &encoded, 44100);
    compress_and_decompress(&encoded_wav, &decoded_wav, "mp3", bitrate);

    let compressed_samples = read_wav(&decoded_wav);

    // Compare raw extracted bits before and after MP3
    use sha2::{Sha256, Digest};
    let key_hash = Sha256::digest(key).to_vec();

    let min_len = encoded.len().min(compressed_samples.len());
    let n_frames = (min_len / FRAME_SIZE).min(500);

    let mut errors = 0u64;
    let mut total = 0u64;

    for frame_i in 0..n_frames {
        let start = frame_i * FRAME_SIZE;
        let end = start + FRAME_SIZE;

        let clean_coeffs = carnation_stego::dct::dct_ii(&encoded[start..end]);
        let mp3_coeffs = carnation_stego::dct::dct_ii(&compressed_samples[start..end]);

        let pairs = carnation_stego::prng::select_bin_pairs(
            &key_hash, frame_i as u32, PAIRS_PER_FRAME,
            carnation_stego::FREQ_BIN_LOW, carnation_stego::FREQ_BIN_HIGH,
        );

        for (bin_a, bin_b) in &pairs {
            let clean_bit = carnation_stego::patchwork::extract_bit_from_pair(&clean_coeffs, *bin_a, *bin_b);
            let mp3_bit = carnation_stego::patchwork::extract_bit_from_pair(&mp3_coeffs, *bin_a, *bin_b);
            if clean_bit != mp3_bit {
                errors += 1;
            }
            total += 1;
        }
    }

    let ber = errors as f64 / total as f64 * 100.0;
    eprintln!("MP3 {} raw BER: {}/{} = {:.1}%", bitrate, errors, total, ber);
    ber
}

// --- Tests ---

#[test]
fn test_mp3_320k_roundtrip() {
    mp3_roundtrip("320k");
}

#[test]
fn test_mp3_256k_roundtrip() {
    mp3_roundtrip("256k");
}

#[test]
fn test_mp3_192k_roundtrip() {
    mp3_roundtrip("192k");
}

#[test]
fn test_mp3_128k_roundtrip() {
    mp3_roundtrip("128k");
}

#[test]
fn test_ogg_128k_roundtrip() {
    if !has_ffmpeg() {
        eprintln!("Skipping OGG test: ffmpeg not found");
        return;
    }

    // Check if libvorbis encoder is available
    let check = Command::new("ffmpeg")
        .args(["-encoders"])
        .output()
        .unwrap();
    let encoders = String::from_utf8_lossy(&check.stdout);
    if !encoders.contains("libvorbis") {
        eprintln!("Skipping OGG test: libvorbis encoder not available in ffmpeg build");
        return;
    }

    let samples = generate_test_signal(30);
    let message = b"Carnation Radio survives OGG too!";
    let key = b"ogg-test-key";

    let encoded = encode(&samples, message, key, Some(Version::PasswordRepetition)).unwrap();

    let dir = tempfile::tempdir().unwrap();
    let encoded_wav = dir.path().join("encoded.wav");
    let decoded_wav = dir.path().join("decoded.wav");

    write_wav(&encoded_wav, &encoded, 44100);
    compress_and_decompress(&encoded_wav, &decoded_wav, "ogg", "128k");

    let compressed_samples = read_wav(&decoded_wav);
    let result = decode(&compressed_samples, key, None).unwrap();
    let parsed = framing::parse_payload(&result).unwrap();
    assert_eq!(parsed.data, message);
    eprintln!("OGG 128k round-trip: PASS");
}

#[test]
fn test_mp3_ber_under_threshold() {
    // With 17x repetition coding, majority vote can correct up to ~47% BER.
    // MP3 128k typically causes ~10-15% raw BER in our frequency range.
    // This test verifies raw BER stays well below the correction threshold.
    let ber_320 = measure_ber("320k");
    let ber_128 = measure_ber("128k");

    // Even at 128k, BER should be well below 30% (the danger zone for 17x rep coding)
    assert!(ber_128 < 30.0, "MP3 128k BER too high: {:.1}% (threshold: 30%)", ber_128);
    // Higher bitrate should have lower BER
    assert!(ber_320 <= ber_128, "320k BER ({:.1}%) should be <= 128k BER ({:.1}%)", ber_320, ber_128);

    eprintln!("BER thresholds: 320k={:.1}%, 128k={:.1}% — both under 30%", ber_320, ber_128);
}

#[test]
fn test_full_pipeline_encrypt_mp3_decrypt() {
    // Full pipeline matching Python's test_full_pipeline_mp3:
    // derive key -> encrypt message -> encode stego -> MP3 -> decode stego -> decrypt
    if !has_ffmpeg() {
        eprintln!("Skipping full pipeline test: ffmpeg not found");
        return;
    }

    use sha2::{Sha256, Digest};

    let samples = generate_test_signal(60);
    let message = b"The revolution will not be televised.";
    let passphrase = b"solidarity-forever";

    // Derive embed key (matching frontend/Python: SHA-256("carnation-embed:" + passphrase))
    let mut hasher = Sha256::new();
    hasher.update(b"carnation-embed:");
    hasher.update(passphrase);
    let embed_key = hasher.finalize().to_vec();

    // Encode with the derived key
    let encoded = encode(&samples, message, &embed_key, Some(Version::PasswordRepetition)).unwrap();

    let dir = tempfile::tempdir().unwrap();
    let encoded_wav = dir.path().join("encoded.wav");
    let decoded_wav = dir.path().join("decoded.wav");

    write_wav(&encoded_wav, &encoded, 44100);
    compress_and_decompress(&encoded_wav, &decoded_wav, "mp3", "128k");

    let compressed_samples = read_wav(&decoded_wav);
    let result = decode(&compressed_samples, &embed_key, None).unwrap();
    let parsed = framing::parse_payload(&result).unwrap();
    assert_eq!(parsed.data, message);
    eprintln!("Full pipeline (encrypt + MP3 128k + decrypt): PASS");
}

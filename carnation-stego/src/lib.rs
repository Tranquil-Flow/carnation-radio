pub mod dct;
pub mod patchwork;
pub mod coding;
pub mod framing;
pub mod prng;

#[cfg(feature = "wasm")]
pub mod wasm;

use sha2::{Sha256, Digest};

// Constants matching Python prototype (patchwork.py)
pub const FRAME_SIZE: usize = 1024;
pub const PAIRS_PER_FRAME: usize = 6;
pub const FREQ_BIN_LOW: usize = 40;
pub const FREQ_BIN_HIGH: usize = 350;
pub const DELTA_STRENGTH: f64 = 200.0;
pub const REPETITION: usize = 17;

/// Encode a message into PCM audio samples.
///
/// `key` is the embed_key (SHA-256("carnation-embed:" + passphrase)).
/// This function hashes it again internally to match the Python prototype's double-hash.
/// `version` controls the wire format version byte. None = legacy (no version byte).
pub fn encode(
    samples: &[f64],
    message: &[u8],
    key: &[u8],
    version: Option<framing::Version>,
) -> Result<Vec<f64>, String> {
    // Double-hash: embed_key -> key_hash (matches patchwork.py line 245)
    let key_hash = Sha256::digest(key).to_vec();

    // Build payload with version byte
    let version = version.unwrap_or(framing::Version::PasswordRepetition);
    let versioned_payload = framing::build_payload(message, version);

    // Build frame: sync + length + payload
    let frame_data = framing::build_frame(&versioned_payload);

    // Convert to bits
    let logical_bits = coding::bytes_to_bits(&frame_data);

    let n_frames = samples.len() / FRAME_SIZE;
    let total_slots = n_frames * PAIRS_PER_FRAME;
    let needed_slots = logical_bits.len() * REPETITION;

    if needed_slots > total_slots {
        let logical_capacity = total_slots / REPETITION;
        let max_msg = if logical_capacity > 64 { (logical_capacity - 64) / 8 } else { 0 };
        return Err(format!(
            "Message too long: need {} bit slots but only {} available ({} frames x {} pairs). Max message: ~{} bytes",
            needed_slots, total_slots, n_frames, PAIRS_PER_FRAME, max_msg
        ));
    }

    // Interleave bits across all available slots
    let slot_bits = coding::interleave_bits(&logical_bits, REPETITION, total_slots);

    let mut output = samples.to_vec();
    let mut bit_idx = 0;

    for frame_i in 0..n_frames {
        let start = frame_i * FRAME_SIZE;
        let end = start + FRAME_SIZE;
        let frame = &output[start..end];

        let mut coeffs = dct::dct_ii(frame);

        let pairs = prng::select_bin_pairs(
            &key_hash, frame_i as u32, PAIRS_PER_FRAME,
            FREQ_BIN_LOW, FREQ_BIN_HIGH,
        );

        for (bin_a, bin_b) in &pairs {
            if bit_idx < slot_bits.len() {
                patchwork::embed_bit_in_pair(&mut coeffs, *bin_a, *bin_b, slot_bits[bit_idx], DELTA_STRENGTH);
                bit_idx += 1;
            }
        }

        let modified = dct::idct_ii(&coeffs);
        output[start..end].copy_from_slice(&modified);
    }

    Ok(output)
}

/// Decode a message from PCM audio samples.
///
/// `key` is the embed_key (SHA-256("carnation-embed:" + passphrase)).
/// Returns the raw payload (after sync pattern extraction, before decryption).
pub fn decode(
    samples: &[f64],
    key: &[u8],
    _version: Option<framing::Version>,
) -> Result<Vec<u8>, String> {
    // Double-hash: embed_key -> key_hash
    let key_hash = Sha256::digest(key).to_vec();

    let n_frames = samples.len() / FRAME_SIZE;

    // Extract all raw bits
    let mut all_raw_bits = Vec::with_capacity(n_frames * PAIRS_PER_FRAME);

    for frame_i in 0..n_frames {
        let start = frame_i * FRAME_SIZE;
        let end = start + FRAME_SIZE;
        let frame = &samples[start..end];

        let coeffs = dct::dct_ii(frame);
        let pairs = prng::select_bin_pairs(
            &key_hash, frame_i as u32, PAIRS_PER_FRAME,
            FREQ_BIN_LOW, FREQ_BIN_HIGH,
        );

        for (bin_a, bin_b) in &pairs {
            let bit = patchwork::extract_bit_from_pair(&coeffs, *bin_a, *bin_b);
            all_raw_bits.push(bit);
        }
    }

    // Deinterleave and majority vote
    let decoded_bits = coding::deinterleave_vote(&all_raw_bits, REPETITION);

    // Convert to bytes
    let decoded_bytes = coding::bits_to_bytes(&decoded_bits);

    // Find sync pattern and extract payload
    framing::find_sync_and_extract(&decoded_bytes)
        .ok_or_else(|| "Sync pattern not found - wrong key or corrupted audio".to_string())
}

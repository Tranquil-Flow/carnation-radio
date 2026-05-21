use wasm_bindgen::prelude::*;
use sha2::{Sha256, Digest};

#[wasm_bindgen]
pub fn wasm_encode(samples: &[f64], message: &[u8], key: &[u8]) -> Result<Vec<f64>, JsValue> {
    crate::encode(samples, message, key, None)
        .map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub fn wasm_decode(samples: &[f64], key: &[u8]) -> Result<Vec<u8>, JsValue> {
    crate::decode(samples, key, None)
        .map_err(|e| JsValue::from_str(&e))
}

#[wasm_bindgen]
pub struct FrameDecoder {
    key_hash: Vec<u8>,
    total_frames: u32,
    current_frame: u32,
    raw_bits: Vec<u8>,
    pairs_per_frame: usize,
    repetition: usize,
    result: Option<Vec<u8>>,
}

#[wasm_bindgen]
impl FrameDecoder {
    /// key = embed_key (SHA-256("carnation-embed:" + passphrase)).
    /// Constructor hashes it again to get key_hash, matching Python's double-hash chain.
    #[wasm_bindgen(constructor)]
    pub fn new(key: &[u8], total_frames: u32) -> FrameDecoder {
        let key_hash = Sha256::digest(key).to_vec();
        let pairs_per_frame = crate::PAIRS_PER_FRAME;
        FrameDecoder {
            key_hash,
            total_frames,
            current_frame: 0,
            raw_bits: Vec::with_capacity((total_frames as usize) * pairs_per_frame),
            pairs_per_frame,
            repetition: crate::REPETITION,
            result: None,
        }
    }

    /// Feed one frame of FRAME_SIZE samples. Returns payload bytes when sync found.
    pub fn feed_frame(&mut self, samples: &[f64]) -> Option<Vec<u8>> {
        if self.result.is_some() || samples.len() < crate::FRAME_SIZE {
            return self.result.clone();
        }

        let coeffs = crate::dct::dct_ii(&samples[..crate::FRAME_SIZE]);
        let pairs = crate::prng::select_bin_pairs(
            &self.key_hash, self.current_frame, self.pairs_per_frame,
            crate::FREQ_BIN_LOW, crate::FREQ_BIN_HIGH,
        );

        for (bin_a, bin_b) in &pairs {
            let bit = crate::patchwork::extract_bit_from_pair(&coeffs, *bin_a, *bin_b);
            self.raw_bits.push(bit);
        }
        self.current_frame += 1;

        // Try to decode periodically or when all frames processed
        if self.current_frame % 500 == 0 || self.current_frame >= self.total_frames {
            let decoded_bits = crate::coding::deinterleave_vote(&self.raw_bits, self.repetition);
            let decoded_bytes = crate::coding::bits_to_bytes(&decoded_bits);
            if let Some(payload) = crate::framing::find_sync_and_extract(&decoded_bytes) {
                self.result = Some(payload);
                return self.result.clone();
            }
        }
        None
    }

    pub fn progress(&self) -> f32 {
        self.current_frame as f32 / self.total_frames as f32
    }
}

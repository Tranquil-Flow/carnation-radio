# Phase 1 MVP Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a zero-trust browser app where users encode secret encrypted messages into audio files and decode them during playback — everything client-side via Rust/WASM + Web Crypto.

**Architecture:** Rust/WASM crate (`carnation-stego`) handles DSP (DCT patchwork encode/decode). Browser-native crypto handles encryption (scrypt + AES-256-GCM for password mode, eciesjs for wallet mode). ffmpeg.wasm handles format transcoding. Next.js static export, no backend. AudioWorklet for real-time decode during playback.

**Tech Stack:** Rust (wasm-pack, rustfft, rand_mt), TypeScript/Next.js 14, Web Crypto API, @noble/hashes, eciesjs, viem, ffmpeg.wasm, RainbowKit, Tailwind/DaisyUI

**Spec:** `docs/superpowers/specs/2026-03-13-phase1-mvp-design.md`

**Python prototype (read-only reference):** `steganography_cli/engine/` — `patchwork.py`, `crypto.py`, `carnation.py`

**Critical constraint:** Clean-room implementation from academic papers only. NEVER reference audiowmark source code.

**Key derivation chain (CRITICAL — memorize this):**
All public Rust APIs (`encode`, `decode`, `FrameDecoder::new`) expect `embed_key` as input, NOT raw passphrase. The full chain:
```
passphrase → embed_key = SHA-256("carnation-embed:" + passphrase_utf8)  [caller does this]
           → key_hash  = SHA-256(embed_key)                              [Rust does this internally]
           → per-frame seed = SHA-256(key_hash + frame_idx_u32_be)       [Rust does this internally]
           → seed_u64 from first 8 bytes → truncated to seed % 2^31     [PRNG module]
           → MT19937(truncated_seed) → Fisher-Yates shuffle              [PRNG module]
```
The double SHA-256 (embed_key → key_hash) is critical for Python cross-compatibility.

**Sample format convention:** All PCM data throughout the pipeline uses raw 16-bit integer scale (values like -32768 to 32767), NOT Web Audio normalized [-1, 1]. AudioWorklet must scale `f32 * 32768` before feeding to WASM decoder.

**BCH error correction:** Deferred to post-MVP. Only 17x repetition coding is implemented.

---

## File Structure

### New: Rust crate (`carnation-stego/`)

```
carnation-stego/
├── Cargo.toml                    # Workspace, features: "wasm", "cli"
├── src/
│   ├── lib.rs                    # Public API: encode(), decode()
│   ├── dct.rs                    # DCT-II / IDCT-II via rustfft
│   ├── patchwork.rs              # Bin pair selection, bit embed/extract, adaptive delta
│   ├── coding.rs                 # 17x interleaved repetition coding + majority vote (+ BCH opt-in)
│   ├── framing.rs                # Wire format: 0xCAFEBABE sync, length header, version byte
│   ├── prng.rs                   # MT19937 matching numpy.random.RandomState exactly
│   └── wasm.rs                   # wasm-bindgen exports, FrameDecoder for AudioWorklet
├── tests/
│   ├── prng_compat.rs            # MT19937 test vectors vs numpy output
│   ├── dct_compat.rs             # DCT output vs scipy.fft.dct output
│   ├── round_trip.rs             # Encode→decode round trip
│   └── cross_compat.rs           # Decode Python-encoded WAV files
└── testdata/                     # Python-generated test fixtures (WAV files, expected outputs)
```

### New: Frontend stego/crypto layer (`frontend/lib/`)

```
frontend/lib/
├── stego.ts                      # Orchestrates WASM stego module (load, encode, decode)
├── crypto.ts                     # AES-256-GCM + scrypt (matching Python crypto.py)
├── ecies.ts                      # ECIES wallet encryption + ENS resolution
├── transcode.ts                  # ffmpeg.wasm wrapper (any format → WAV, WAV → MP3)
├── wire.ts                       # Wire format: version byte routing, legacy detection
└── worklet/
    └── decode-processor.ts       # AudioWorkletProcessor — feeds frames to WASM FrameDecoder
```

### New: Frontend UI (`frontend/app/`)

```
frontend/app/
├── page.tsx                      # Landing page with encode/decode tab navigation
├── globals.css                   # Updated with carnation theme (black/red)
├── encode/
│   └── page.tsx                  # Encode view: upload + message + mode → download
├── decode/
│   └── page.tsx                  # Decode view: upload + play → message reveal
└── components/
    ├── AudioDropzone.tsx          # Drag-and-drop audio file upload
    ├── EncryptionModeToggle.tsx   # Password vs Wallet mode selector
    ├── PasswordInput.tsx          # Passphrase field with strength indicator
    ├── WalletRecipient.tsx        # ENS/address input with avatar resolution
    ├── EncodeProgress.tsx         # Progress bar for encode pipeline
    ├── AudioPlayer.tsx            # Playback with decode integration
    └── MessageReveal.tsx          # Animated message display on decode
```

### Modified: Existing files

```
frontend/package.json             # Add: @ffmpeg/ffmpeg, @noble/hashes, eciesjs, vitest
frontend/next.config.mjs          # Add: WASM loader, static export, headers for SharedArrayBuffer
frontend/tailwind.config.ts       # Add: carnation theme colors
frontend/app/layout.tsx           # Update: dark theme, navigation header
```

---

## Chunk 1: Rust Stego Engine

### Task 1: Scaffold the Rust crate

**Files:**
- Create: `carnation-stego/Cargo.toml`
- Create: `carnation-stego/src/lib.rs`
- Create: `carnation-stego/rust-toolchain.toml`

**Prerequisites:** Rust toolchain installed (`rustup`), `wasm-pack` installed (`cargo install wasm-pack`).

- [ ] **Step 1: Create Cargo.toml**

```toml
[package]
name = "carnation-stego"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "rlib"]

[features]
default = []
wasm = ["wasm-bindgen", "js-sys", "web-sys"]
cli = []

[dependencies]
rustfft = "6"
rand_mt = "4"
sha2 = "0.10"
wasm-bindgen = { version = "0.2", optional = true }
js-sys = { version = "0.3", optional = true }
web-sys = { version = "0.3", optional = true }

[dev-dependencies]
approx = "0.5"

[profile.release]
opt-level = "s"
lto = true
```

- [ ] **Step 2: Create stub lib.rs**

```rust
pub mod dct;
pub mod patchwork;
pub mod coding;
pub mod framing;
pub mod prng;

#[cfg(feature = "wasm")]
pub mod wasm;
```

Create empty module files: `dct.rs`, `patchwork.rs`, `coding.rs`, `framing.rs`, `prng.rs`, `wasm.rs` (each with just `// TODO`).

- [ ] **Step 3: Create rust-toolchain.toml**

```toml
[toolchain]
channel = "stable"
targets = ["wasm32-unknown-unknown"]
```

- [ ] **Step 4: Verify it compiles**

Run: `cd carnation-stego && cargo check`
Expected: Compiles with no errors.

- [ ] **Step 5: Commit**

```bash
git add carnation-stego/
git commit -m "feat: scaffold carnation-stego Rust crate"
```

---

### Task 2: MT19937 PRNG (numpy-compatible)

This is the most critical cross-compatibility piece. The Rust MT19937 must produce identical output to `numpy.random.RandomState` for the same seed.

**Files:**
- Create: `carnation-stego/src/prng.rs`
- Create: `carnation-stego/tests/prng_compat.rs`
- Reference: `steganography_cli/engine/patchwork.py` lines 42-58

**How it works in Python:**
```python
seed = int.from_bytes(SHA256(key + struct.pack(">I", frame_idx))[:8], "big")
rng = np.random.RandomState(seed % (2**31))
available = list(range(bin_low, bin_high))
rng.shuffle(available)  # Fisher-Yates shuffle using MT19937
```

- [ ] **Step 1: Generate Python test vectors**

Create a script `carnation-stego/testdata/generate_vectors.py`:

```python
"""Generate PRNG test vectors for Rust cross-compat testing."""
import hashlib
import struct
import json
import numpy as np

def derive_seed(key: bytes, frame_idx: int) -> int:
    h = hashlib.sha256(key + struct.pack(">I", frame_idx))
    return int.from_bytes(h.digest()[:8], "big")

vectors = []
test_key = hashlib.sha256(b"test-key").digest()

for frame_idx in [0, 1, 42, 100, 9999]:
    seed = derive_seed(test_key, frame_idx)
    rng = np.random.RandomState(seed % (2**31))
    available = list(range(40, 350))
    rng.shuffle(available)
    # Record first 20 values after shuffle and the first 6 pairs
    pairs = [(available[i], available[i+1]) for i in range(0, 12, 2)]
    vectors.append({
        "frame_idx": frame_idx,
        "raw_seed": seed,
        "truncated_seed": seed % (2**31),
        "shuffled_first_20": available[:20],
        "pairs": pairs,
    })

with open("carnation-stego/testdata/prng_vectors.json", "w") as f:
    json.dump({"key_hash_hex": test_key.hex(), "vectors": vectors}, f, indent=2)

print(f"Generated {len(vectors)} test vectors")
```

Run: `cd /Users/evinova/Projects/carnation-radio && .venv/bin/python carnation-stego/testdata/generate_vectors.py`
Expected: Creates `carnation-stego/testdata/prng_vectors.json` with 5 test vectors.

- [ ] **Step 2: Write the failing test**

```rust
// tests/prng_compat.rs
use carnation_stego::prng::select_bin_pairs;
use std::fs;

#[derive(serde::Deserialize)]
struct TestVectors {
    key_hash_hex: String,
    vectors: Vec<Vector>,
}

#[derive(serde::Deserialize)]
struct Vector {
    frame_idx: u32,
    raw_seed: u64,
    truncated_seed: u32,
    shuffled_first_20: Vec<usize>,
    pairs: Vec<(usize, usize)>,
}

#[test]
fn test_prng_matches_numpy() {
    let data = fs::read_to_string("testdata/prng_vectors.json").unwrap();
    let tv: TestVectors = serde_json::from_str(&data).unwrap();
    let key = hex::decode(&tv.key_hash_hex).unwrap();

    for v in &tv.vectors {
        let pairs = select_bin_pairs(&key, v.frame_idx, 6, 40, 350);
        assert_eq!(
            pairs, v.pairs,
            "Bin pairs mismatch for frame_idx={}",
            v.frame_idx
        );
    }
}
```

Add `serde`, `serde_json`, and `hex` to `[dev-dependencies]` in Cargo.toml:
```toml
[dev-dependencies]
approx = "0.5"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
hex = "0.4"
```

Run: `cargo test --test prng_compat`
Expected: FAIL — `select_bin_pairs` doesn't exist yet.

- [ ] **Step 3: Implement prng.rs**

```rust
use rand_mt::Mt19937GenRand32;
use sha2::{Sha256, Digest};

/// Derive a deterministic PRNG seed from key + frame index.
/// Matches Python: SHA256(key + big_endian_u32(frame_idx)), take first 8 bytes as u64.
pub fn derive_prng_seed(key: &[u8], frame_idx: u32) -> u64 {
    let mut hasher = Sha256::new();
    hasher.update(key);
    hasher.update(frame_idx.to_be_bytes());
    let hash = hasher.finalize();
    u64::from_be_bytes(hash[..8].try_into().unwrap())
}

/// Select n_pairs of distinct frequency bin pairs using key-seeded MT19937.
/// Matches Python's numpy.random.RandomState shuffle exactly.
pub fn select_bin_pairs(
    key: &[u8],
    frame_idx: u32,
    n_pairs: usize,
    bin_low: usize,
    bin_high: usize,
) -> Vec<(usize, usize)> {
    let raw_seed = derive_prng_seed(key, frame_idx);
    let truncated = (raw_seed % (1u64 << 31)) as u32;
    let mut rng = Mt19937GenRand32::new(truncated);

    let mut available: Vec<usize> = (bin_low..bin_high).collect();

    // Fisher-Yates shuffle matching numpy's RandomState.shuffle()
    // numpy uses: for i in range(len(arr)-1, 0, -1): j = randint(i+1); swap(i,j)
    // where randint(n) = next_u32() % n (for n < 2^32)
    let n = available.len();
    for i in (1..n).rev() {
        let j = (rng.next_u32() as usize) % (i + 1);
        available.swap(i, j);
    }

    let mut pairs = Vec::with_capacity(n_pairs);
    for i in (0..n_pairs * 2).step_by(2) {
        if i + 1 < available.len() {
            pairs.push((available[i], available[i + 1]));
        }
    }
    pairs
}
```

**IMPORTANT**: The `rng.next_u32()` call must match numpy's internal MT19937 output sequence. The `rand_mt` crate's `Mt19937GenRand32` implements the standard MT19937 algorithm. However, numpy's `RandomState` may use a slightly different seeding or generation method. If the test vectors don't match, investigate numpy's exact seeding (it uses `init_genrand` with 32-bit seed when given an integer). The `rand_mt` crate's `new(seed)` should match this — verify with test vectors.

**If numpy uses a different shuffle algorithm**: numpy's `RandomState.shuffle` internally calls `randint(low=0, high=i+1)` for the Fisher-Yates. numpy's `randint` for small ranges uses `rng.random_sample()` (a float) multiplied by the range, NOT `next_u32() % range`. This is a critical detail. If test vectors fail, the implementation must use:

```rust
// numpy's randint(0, n) for shuffle:
// raw = next_u32() >> 5  (27 bits)
// float = raw / 2^27     (uniform [0,1))
// result = floor(float * n)
```

Check the test vectors to determine which method numpy uses. The test vectors are the source of truth.

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test --test prng_compat`
Expected: PASS. If FAIL, adjust the shuffle implementation to match numpy's exact RNG-to-index mapping (see note above).

- [ ] **Step 5: Commit**

```bash
git add carnation-stego/src/prng.rs carnation-stego/tests/prng_compat.rs carnation-stego/testdata/
git commit -m "feat: MT19937 PRNG matching numpy RandomState"
```

---

### Task 3: DCT-II / IDCT-II

**Files:**
- Create: `carnation-stego/src/dct.rs`
- Create: `carnation-stego/tests/dct_compat.rs`
- Reference: `steganography_cli/engine/patchwork.py` lines 255-256 (`dct(frame, type=2, norm="ortho")`)

The Python prototype uses `scipy.fft.dct(x, type=2, norm="ortho")`. We implement the same using `rustfft` (real-valued FFT to DCT-II conversion).

- [ ] **Step 1: Generate DCT test vectors**

Add to `generate_vectors.py`:

```python
from scipy.fft import dct, idct
import numpy as np

# Generate DCT test vectors
dct_vectors = []
rng = np.random.RandomState(12345)
for i in range(5):
    frame = rng.randn(1024).astype(np.float64) * 10000  # Simulate audio amplitudes
    coeffs = dct(frame, type=2, norm="ortho")
    reconstructed = idct(coeffs, type=2, norm="ortho")
    dct_vectors.append({
        "input_first_10": frame[:10].tolist(),
        "input_last_10": frame[-10:].tolist(),
        "output_first_10": coeffs[:10].tolist(),
        "output_last_10": coeffs[-10:].tolist(),
        "round_trip_max_error": float(np.max(np.abs(frame - reconstructed))),
    })

with open("carnation-stego/testdata/dct_vectors.json", "w") as f:
    json.dump(dct_vectors, f, indent=2)
```

Run the script to generate `dct_vectors.json`.

- [ ] **Step 2: Write the failing test**

```rust
// tests/dct_compat.rs
use carnation_stego::dct::{dct_ii, idct_ii};
use approx::assert_relative_eq;

#[test]
fn test_dct_round_trip() {
    let input: Vec<f64> = (0..1024).map(|i| (i as f64).sin() * 10000.0).collect();
    let coeffs = dct_ii(&input);
    let output = idct_ii(&coeffs);
    for (a, b) in input.iter().zip(output.iter()) {
        assert_relative_eq!(a, b, epsilon = 1e-10);
    }
}

#[test]
fn test_dct_matches_scipy() {
    let data = std::fs::read_to_string("testdata/dct_vectors.json").unwrap();
    let vectors: Vec<serde_json::Value> = serde_json::from_str(&data).unwrap();
    // Compare first 10 coefficients against scipy output
    // (load full frame from test fixture for exact comparison)
}
```

- [ ] **Step 3: Implement dct.rs**

Start with a naive O(N^2) implementation for correctness:

```rust
use std::f64::consts::PI;

/// DCT-II with orthonormal normalization (matches scipy.fft.dct(type=2, norm="ortho"))
pub fn dct_ii(input: &[f64]) -> Vec<f64> {
    let n = input.len();
    let mut result = vec![0.0f64; n];

    for k in 0..n {
        let mut sum = 0.0;
        for i in 0..n {
            sum += input[i] * (PI * (2 * i + 1) as f64 * k as f64 / (2.0 * n as f64)).cos();
        }
        // Ortho normalization
        result[k] = sum * if k == 0 {
            (1.0 / n as f64).sqrt()
        } else {
            (2.0 / n as f64).sqrt()
        };
    }
    result
}

/// IDCT-II (inverse) with orthonormal normalization
pub fn idct_ii(coeffs: &[f64]) -> Vec<f64> {
    let n = coeffs.len();
    let mut result = vec![0.0f64; n];

    for i in 0..n {
        let mut sum = coeffs[0] * (1.0 / n as f64).sqrt();
        for k in 1..n {
            sum += coeffs[k] * (2.0 / n as f64).sqrt()
                * (PI * (2 * i + 1) as f64 * k as f64 / (2.0 * n as f64)).cos();
        }
        result[i] = sum;
    }
    result
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `cargo test --test dct_compat`
Expected: PASS (round-trip error < 1e-10, matches scipy values).

- [ ] **Step 5: Optimize with FFT-based DCT**

Replace the O(N^2) loops with the standard DCT-II via 2N-point real FFT using `rustfft`. This is a performance optimization — the API and test expectations stay the same. Target: <1ms per DCT on a 1024-sample frame.

- [ ] **Step 6: Re-run tests, verify still passing**

Run: `cargo test --test dct_compat`
Expected: PASS with identical output.

- [ ] **Step 7: Commit**

```bash
git add carnation-stego/src/dct.rs carnation-stego/tests/dct_compat.rs carnation-stego/testdata/dct_vectors.json
git commit -m "feat: DCT-II/IDCT-II matching scipy ortho normalization"
```

---

### Task 4: Patchwork bit embedding and extraction

**Files:**
- Create: `carnation-stego/src/patchwork.rs`
- Reference: `steganography_cli/engine/patchwork.py` lines 61-86

- [ ] **Step 1: Write failing tests**

```rust
// In patchwork.rs or a test file
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_embed_extract_bit_1() {
        let mut coeffs = vec![0.0f64; 512];
        coeffs[100] = 500.0;
        coeffs[200] = 500.0;
        embed_bit_in_pair(&mut coeffs, 100, 200, 1, 200.0);
        assert!(coeffs[100].abs() > coeffs[200].abs(), "bit 1: bin_a should be larger");
        let extracted = extract_bit_from_pair(&coeffs, 100, 200);
        assert_eq!(extracted, 1);
    }

    #[test]
    fn test_embed_extract_bit_0() {
        let mut coeffs = vec![0.0f64; 512];
        coeffs[100] = 500.0;
        coeffs[200] = 500.0;
        embed_bit_in_pair(&mut coeffs, 100, 200, 0, 200.0);
        assert!(coeffs[200].abs() > coeffs[100].abs(), "bit 0: bin_b should be larger");
        let extracted = extract_bit_from_pair(&coeffs, 100, 200);
        assert_eq!(extracted, 0);
    }

    #[test]
    fn test_embed_preserves_sign() {
        let mut coeffs = vec![0.0f64; 512];
        coeffs[100] = -300.0;
        coeffs[200] = 400.0;
        embed_bit_in_pair(&mut coeffs, 100, 200, 1, 200.0);
        assert!(coeffs[100] < 0.0, "sign of bin_a should be preserved");
        assert!(coeffs[200] > 0.0, "sign of bin_b should be preserved");
    }
}
```

- [ ] **Step 2: Implement patchwork.rs**

```rust
/// Embed a single bit by adjusting relative magnitude of two DCT bins.
/// Matches Python patchwork.py lines 61-81.
pub fn embed_bit_in_pair(coeffs: &mut [f64], bin_a: usize, bin_b: usize, bit: u8, delta: f64) {
    let a_val = coeffs[bin_a];
    let b_val = coeffs[bin_b];
    let avg = (a_val.abs() + b_val.abs()) / 2.0;

    // Adaptive delta: proportional to signal energy, with minimum floor
    let adaptive_delta = delta.max(delta * avg / 500.0);

    let sign_a = if a_val != 0.0 { a_val.signum() } else { 1.0 };
    let sign_b = if b_val != 0.0 { b_val.signum() } else { 1.0 };
    let mid = (a_val.abs() + b_val.abs()) / 2.0;

    if bit == 1 {
        coeffs[bin_a] = sign_a * (mid + adaptive_delta / 2.0);
        coeffs[bin_b] = sign_b * (mid - adaptive_delta / 2.0).max(1.0);
    } else {
        coeffs[bin_a] = sign_a * (mid - adaptive_delta / 2.0).max(1.0);
        coeffs[bin_b] = sign_b * (mid + adaptive_delta / 2.0);
    }
}

/// Extract a single bit by checking relative magnitude of two DCT bins.
/// Matches Python patchwork.py lines 84-86.
pub fn extract_bit_from_pair(coeffs: &[f64], bin_a: usize, bin_b: usize) -> u8 {
    if coeffs[bin_a].abs() >= coeffs[bin_b].abs() { 1 } else { 0 }
}
```

- [ ] **Step 3: Run tests**

Run: `cargo test patchwork`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add carnation-stego/src/patchwork.rs
git commit -m "feat: patchwork bit embedding and extraction"
```

---

### Task 5: Interleaved repetition coding

**Files:**
- Create: `carnation-stego/src/coding.rs`
- Reference: `steganography_cli/engine/patchwork.py` lines 109-153

- [ ] **Step 1: Write failing tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_interleave_deinterleave_round_trip() {
        let bits = vec![1, 0, 1, 1, 0, 0, 1, 0]; // 0xB2
        let total_slots = 200;
        let repetition = 17;
        let interleaved = interleave_bits(&bits, repetition, total_slots);
        assert_eq!(interleaved.len(), total_slots);
        let recovered = deinterleave_vote(&interleaved, repetition);
        assert_eq!(&recovered[..bits.len()], &bits[..]);
    }

    #[test]
    fn test_survives_10_percent_errors() {
        let bits = vec![1, 0, 1, 1, 0, 0, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1];
        let total_slots = 500;
        let repetition = 17;
        let mut interleaved = interleave_bits(&bits, repetition, total_slots);
        // Flip 10% of bits
        for i in (0..interleaved.len()).step_by(10) {
            interleaved[i] = 1 - interleaved[i];
        }
        let recovered = deinterleave_vote(&interleaved, repetition);
        assert_eq!(&recovered[..bits.len()], &bits[..]);
    }

    #[test]
    fn test_bytes_bits_round_trip() {
        let data = vec![0xCA, 0xFE, 0xBA, 0xBE];
        let bits = bytes_to_bits(&data);
        assert_eq!(bits.len(), 32);
        let recovered = bits_to_bytes(&bits);
        assert_eq!(recovered, data);
    }
}
```

- [ ] **Step 2: Implement coding.rs**

```rust
/// Interleave repeated bits across the full slot space.
/// Matches Python patchwork.py lines 109-129.
pub fn interleave_bits(bits: &[u8], repetition: usize, total_slots: usize) -> Vec<u8> {
    let stride = total_slots / repetition;
    let mut slots = vec![0u8; total_slots];

    for rep_i in 0..repetition {
        let offset = rep_i * stride;
        for (bit_i, &bit) in bits.iter().enumerate() {
            let slot_idx = offset + bit_i;
            if slot_idx < total_slots {
                slots[slot_idx] = bit;
            }
        }
    }
    slots
}

/// Deinterleave and majority vote to recover logical bits.
/// Matches Python patchwork.py lines 132-153.
pub fn deinterleave_vote(raw_bits: &[u8], repetition: usize) -> Vec<u8> {
    let total = raw_bits.len();
    let stride = total / repetition;
    let mut votes: Vec<Vec<u8>> = vec![Vec::new(); stride];

    for rep_i in 0..repetition {
        let offset = rep_i * stride;
        for bit_i in 0..stride {
            let slot_idx = offset + bit_i;
            if slot_idx < total {
                votes[bit_i].push(raw_bits[slot_idx]);
            }
        }
    }

    votes.iter().map(|v| {
        if v.is_empty() {
            0
        } else {
            let ones: usize = v.iter().map(|&b| b as usize).sum();
            if ones > v.len() / 2 { 1 } else { 0 }
        }
    }).collect()
}

/// Convert bytes to bits (MSB first). Matches Python _bytes_to_bits.
pub fn bytes_to_bits(data: &[u8]) -> Vec<u8> {
    let mut bits = Vec::with_capacity(data.len() * 8);
    for &byte in data {
        for i in (0..8).rev() {
            bits.push((byte >> i) & 1);
        }
    }
    bits
}

/// Convert bits to bytes (MSB first). Matches Python _bits_to_bytes.
pub fn bits_to_bytes(bits: &[u8]) -> Vec<u8> {
    bits.chunks(8)
        .filter(|chunk| chunk.len() == 8)
        .map(|chunk| {
            chunk.iter().fold(0u8, |acc, &bit| (acc << 1) | bit)
        })
        .collect()
}
```

- [ ] **Step 3: Run tests**

Run: `cargo test coding`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add carnation-stego/src/coding.rs
git commit -m "feat: interleaved repetition coding with majority vote"
```

---

### Task 6: Wire format (framing)

**Files:**
- Create: `carnation-stego/src/framing.rs`
- Reference: spec wire format section

- [ ] **Step 1: Write failing tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_and_parse_payload_v1() {
        let message = b"Hello, world!";
        let payload = build_payload(message, Version::PasswordRepetition);
        let parsed = parse_payload(&payload).unwrap();
        assert_eq!(parsed.version, Version::PasswordRepetition);
        assert_eq!(parsed.data, message);
    }

    #[test]
    fn test_parse_legacy_python_format() {
        // Python format: no version byte, payload starts with salt (random bytes)
        let fake_python_payload = vec![0x42; 100]; // first byte != 0x01/0x02/0x11/0x12
        let parsed = parse_payload(&fake_python_payload).unwrap();
        assert_eq!(parsed.version, Version::Legacy);
        assert_eq!(parsed.data, &fake_python_payload[..]);
    }

    #[test]
    fn test_sync_pattern_search() {
        let mut data = vec![0u8; 50];
        data[10..14].copy_from_slice(&SYNC_PATTERN);
        data[14..18].copy_from_slice(&5u32.to_be_bytes());
        data[18..23].copy_from_slice(b"Hello");
        let result = find_sync_and_extract(&data).unwrap();
        assert_eq!(result, b"Hello");
    }
}
```

- [ ] **Step 2: Implement framing.rs**

```rust
pub const SYNC_PATTERN: [u8; 4] = [0xCA, 0xFE, 0xBA, 0xBE];

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Version {
    Legacy,
    PasswordRepetition,  // 0x01
    WalletRepetition,    // 0x02
    PasswordBch,         // 0x11
    WalletBch,           // 0x12
}

impl Version {
    pub fn to_byte(&self) -> Option<u8> {
        match self {
            Version::Legacy => None,
            Version::PasswordRepetition => Some(0x01),
            Version::WalletRepetition => Some(0x02),
            Version::PasswordBch => Some(0x11),
            Version::WalletBch => Some(0x12),
        }
    }

    pub fn from_byte(b: u8) -> Version {
        match b {
            0x01 => Version::PasswordRepetition,
            0x02 => Version::WalletRepetition,
            0x11 => Version::PasswordBch,
            0x12 => Version::WalletBch,
            _ => Version::Legacy,
        }
    }
}

pub struct ParsedPayload<'a> {
    pub version: Version,
    pub data: &'a [u8],
}

pub fn build_payload(data: &[u8], version: Version) -> Vec<u8> {
    match version.to_byte() {
        Some(b) => {
            let mut out = Vec::with_capacity(1 + data.len());
            out.push(b);
            out.extend_from_slice(data);
            out
        }
        None => data.to_vec(),
    }
}

pub fn parse_payload(payload: &[u8]) -> Option<ParsedPayload<'_>> {
    if payload.is_empty() { return None; }
    let version = Version::from_byte(payload[0]);
    match version {
        Version::Legacy => Some(ParsedPayload { version, data: payload }),
        _ => Some(ParsedPayload { version, data: &payload[1..] }),
    }
}

pub fn build_frame(payload: &[u8]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(8 + payload.len());
    frame.extend_from_slice(&SYNC_PATTERN);
    frame.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    frame.extend_from_slice(payload);
    frame
}

pub fn find_sync_and_extract(decoded_bytes: &[u8]) -> Option<Vec<u8>> {
    let sync_idx = decoded_bytes.windows(4).position(|w| w == SYNC_PATTERN)?;
    let len_start = sync_idx + 4;
    if len_start + 4 > decoded_bytes.len() { return None; }
    let msg_len = u32::from_be_bytes(decoded_bytes[len_start..len_start + 4].try_into().ok()?) as usize;
    let msg_start = len_start + 4;
    if msg_start + msg_len > decoded_bytes.len() { return None; }
    Some(decoded_bytes[msg_start..msg_start + msg_len].to_vec())
}
```

- [ ] **Step 3: Run tests**

Run: `cargo test framing`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add carnation-stego/src/framing.rs
git commit -m "feat: wire format with version byte and legacy compat"
```

---

### Task 7: Full encode/decode integration

**Files:**
- Modify: `carnation-stego/src/lib.rs`
- Create: `carnation-stego/tests/round_trip.rs`
- Reference: `steganography_cli/engine/patchwork.py` lines 200-353

This task wires together all modules (DCT, PRNG, patchwork, coding, framing) into the top-level `encode()` and `decode()` functions.

- [ ] **Step 1: Write failing integration test**

```rust
// tests/round_trip.rs
use carnation_stego::{encode, decode};

#[test]
fn test_encode_decode_round_trip() {
    // Generate a simple test signal (sine wave, 5 seconds at 44100Hz)
    let sample_rate = 44100;
    let duration_secs = 5;
    let n_samples = sample_rate * duration_secs;
    let samples: Vec<f64> = (0..n_samples)
        .map(|i| {
            let t = i as f64 / sample_rate as f64;
            (440.0 * 2.0 * std::f64::consts::PI * t).sin() * 16000.0
        })
        .collect();

    let key = b"test-password-123";
    let message = b"Hello from Carnation Radio!";

    let encoded = encode(&samples, message, key, None).unwrap();
    assert_eq!(encoded.len(), samples.len());

    let decoded = decode(&encoded, key, None).unwrap();
    assert_eq!(decoded, message);
}

#[test]
fn test_wrong_key_fails() {
    let samples: Vec<f64> = (0..44100 * 5)
        .map(|i| ((i as f64 / 100.0).sin() * 16000.0))
        .collect();

    let encoded = encode(&samples, b"Secret", b"right-key", None).unwrap();
    let result = decode(&encoded, b"wrong-key", None);
    assert!(result.is_err());
}
```

- [ ] **Step 2: Implement lib.rs encode() and decode()**

Full implementation wiring DCT, PRNG, patchwork, coding, and framing modules.

**CRITICAL**: The `key` parameter is the `embed_key` (already `SHA-256("carnation-embed:" + passphrase)`). The first step hashes it again internally to match the Python prototype's double-hash:

```
embed_key (input) → key_hash = SHA-256(embed_key)  [patchwork.py line 245]
                   → per-frame seed = SHA-256(key_hash + frame_idx)  [patchwork.py line 44]
```

The `encode()` function:
1. Hash the key again: `key_hash = SHA-256(embed_key)` — this is the double-hash
2. Build payload via `framing::build_payload()` + `framing::build_frame()`
3. Convert to bits via `coding::bytes_to_bits()`
4. Interleave via `coding::interleave_bits()`
5. For each frame: DCT → select bin pairs → embed bits → IDCT
6. Return modified samples

The `decode()` function:
1. Hash the key: `key_hash = SHA-256(key)`
2. For each frame: DCT → select bin pairs → extract bits
3. Deinterleave + majority vote via `coding::deinterleave_vote()`
4. Convert to bytes via `coding::bits_to_bytes()`
5. Find sync pattern via `framing::find_sync_and_extract()`
6. Return payload

Constants: `FRAME_SIZE=1024`, `PAIRS_PER_FRAME=6`, `FREQ_BIN_LOW=40`, `FREQ_BIN_HIGH=350`, `DELTA_STRENGTH=200.0`, `REPETITION=17`.

- [ ] **Step 3: Run tests**

Run: `cargo test --test round_trip`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add carnation-stego/src/lib.rs carnation-stego/tests/round_trip.rs
git commit -m "feat: full encode/decode pipeline with round-trip tests"
```

---

### Task 8: Cross-compatibility with Python prototype

**Files:**
- Create: `carnation-stego/tests/cross_compat.rs`
- Create: `carnation-stego/testdata/generate_cross_compat.py`
- Reference: `steganography_cli/engine/patchwork.py`, `crypto.py`, `carnation.py`

- [ ] **Step 1: Generate test fixtures from Python**

Create `carnation-stego/testdata/generate_cross_compat.py`:

```python
"""Generate cross-compat test fixtures: encode with Python, verify Rust can decode."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../steganography_cli/engine"))

import numpy as np
import hashlib
import json
from patchwork import encode, decode, write_wav, read_wav

# Generate a test WAV file (5 seconds, 44100Hz, mono, 16-bit)
sr = 44100
duration = 5
t = np.arange(sr * duration) / sr
audio = (np.sin(2 * np.pi * 440 * t) * 8000 +
         np.sin(2 * np.pi * 880 * t) * 4000 +
         np.sin(2 * np.pi * 220 * t) * 6000).astype(np.float64)

write_wav("testdata/test_input.wav", audio, sr, 1, 2)

# Encode with known key and message (using carnation.py's key derivation)
passphrase = "test-password-123"
embed_key = hashlib.sha256(b"carnation-embed:" + passphrase.encode()).digest()
message = b"Cross-compat test message!"

stats = encode("testdata/test_input.wav", "testdata/test_encoded.wav",
               message, embed_key)
print(f"Encoded: {stats}")

# Verify Python can decode
decoded = decode("testdata/test_encoded.wav", embed_key)
assert decoded == message, f"Python self-check failed"
print("Python self-check passed")

# Save raw f64 samples for Rust
samples, _, _, _ = read_wav("testdata/test_encoded.wav")
if len(samples.shape) > 1:
    samples = samples[:, 0]
samples.astype(np.float64).tofile("testdata/test_encoded_raw.f64")

meta = {
    "embed_key_hex": embed_key.hex(),
    "message": message.decode(),
    "sample_rate": sr,
    "n_samples": len(samples),
}
with open("testdata/cross_compat_meta.json", "w") as f:
    json.dump(meta, f, indent=2)
```

Run: `cd carnation-stego && ../.venv/bin/python testdata/generate_cross_compat.py`

- [ ] **Step 2: Write the cross-compat test**

```rust
// tests/cross_compat.rs
use carnation_stego::decode;

#[test]
fn test_decode_python_encoded_audio() {
    let meta: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string("testdata/cross_compat_meta.json").unwrap()).unwrap();

    let key = hex::decode(meta["embed_key_hex"].as_str().unwrap()).unwrap();
    let expected_message = meta["message"].as_str().unwrap();
    let n_samples = meta["n_samples"].as_u64().unwrap() as usize;

    let raw_bytes = std::fs::read("testdata/test_encoded_raw.f64").unwrap();
    let samples: Vec<f64> = raw_bytes
        .chunks_exact(8)
        .map(|chunk| f64::from_le_bytes(chunk.try_into().unwrap()))
        .collect();
    assert_eq!(samples.len(), n_samples);

    let decoded = decode(&samples, &key, None).unwrap();
    assert_eq!(String::from_utf8(decoded).unwrap(), expected_message);
}
```

- [ ] **Step 3: Run test**

Run: `cargo test --test cross_compat`
Expected: PASS — Rust successfully decodes what Python encoded.

- [ ] **Step 4: Commit**

```bash
git add carnation-stego/tests/cross_compat.rs carnation-stego/testdata/
git commit -m "feat: cross-compatibility tests — Rust decodes Python-encoded audio"
```

---

### Task 9: WASM exports and FrameDecoder

**Files:**
- Create: `carnation-stego/src/wasm.rs`

- [ ] **Step 1: Implement wasm.rs**

```rust
#[cfg(feature = "wasm")]
use wasm_bindgen::prelude::*;

#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub fn wasm_encode(samples: &[f64], message: &[u8], key: &[u8]) -> Result<Vec<f64>, JsValue> {
    crate::encode(samples, message, key, None)
        .map_err(|e| JsValue::from_str(&e))
}

#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub fn wasm_decode(samples: &[f64], key: &[u8]) -> Result<Vec<u8>, JsValue> {
    crate::decode(samples, key, None)
        .map_err(|e| JsValue::from_str(&e))
}

#[cfg(feature = "wasm")]
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

#[cfg(feature = "wasm")]
#[wasm_bindgen]
impl FrameDecoder {
    /// key = embed_key (SHA-256("carnation-embed:" + passphrase)).
    /// Constructor hashes it again to get key_hash, matching Python's double-hash chain.
    #[wasm_bindgen(constructor)]
    pub fn new(key: &[u8], total_frames: u32) -> FrameDecoder {
        use sha2::{Sha256, Digest};
        // Double-hash: embed_key -> key_hash (matches patchwork.py line 245)
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

    /// Feed one frame of FRAME_SIZE samples. Returns message bytes if sync found.
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

        // Try to decode periodically (every 500 frames or when all frames processed)
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
```

- [ ] **Step 2: Build WASM**

Run: `cd carnation-stego && wasm-pack build --target web --features wasm`
Expected: Builds successfully, output in `carnation-stego/pkg/`.

- [ ] **Step 3: Commit**

```bash
git add carnation-stego/src/wasm.rs
git commit -m "feat: WASM exports with FrameDecoder for AudioWorklet"
```

---

## Chunk 2: Frontend Crypto and Stego Integration

### Task 10: Install frontend dependencies

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Install new dependencies**

Run:
```bash
cd /Users/evinova/Projects/carnation-radio/frontend
npm install @ffmpeg/ffmpeg @ffmpeg/util @noble/hashes eciesjs
npm install -D vitest @vitest/ui happy-dom
```

- [ ] **Step 2: Add vitest config**

Create `frontend/vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'happy-dom',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
```

- [ ] **Step 3: Add test script to package.json**

Add to `scripts`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vitest.config.ts
git commit -m "chore: add ffmpeg.wasm, noble/hashes, eciesjs, vitest"
```

---

### Task 11: Crypto module (AES-256-GCM + scrypt)

**Files:**
- Create: `frontend/lib/crypto.ts`
- Create: `frontend/lib/__tests__/crypto.test.ts`
- Reference: `steganography_cli/engine/crypto.py` — must produce identical ciphertext format

**Key compatibility detail:** Python uses 16-byte nonce (non-standard). Web Crypto supports arbitrary IV lengths for AES-GCM, so this works. Python uses scrypt (N=2^14, r=8, p=1). Use `@noble/hashes/scrypt` which matches Python's scrypt output exactly.

**Wire format:** `[salt:16][nonce:16][tag:16][ciphertext:N]`

Web Crypto AES-GCM appends the tag to the ciphertext in its output. The implementation must rearrange bytes to match the Python format (tag before ciphertext).

- [ ] **Step 1: Write failing test**

```typescript
// frontend/lib/__tests__/crypto.test.ts
import { describe, it, expect } from 'vitest'
import { encryptMessage, decryptMessage } from '../crypto'

describe('crypto', () => {
  it('round-trips encrypt and decrypt', async () => {
    const message = new TextEncoder().encode('Hello, Carnation!')
    const passphrase = 'test-password-123'
    const encrypted = await encryptMessage(message, passphrase)
    const decrypted = await decryptMessage(encrypted, passphrase)
    expect(new TextDecoder().decode(decrypted)).toBe('Hello, Carnation!')
  })

  it('wrong passphrase fails', async () => {
    const message = new TextEncoder().encode('Secret')
    const encrypted = await encryptMessage(message, 'right-key')
    await expect(decryptMessage(encrypted, 'wrong-key')).rejects.toThrow()
  })

  it('produces correct wire format length', async () => {
    const message = new TextEncoder().encode('test')
    const encrypted = await encryptMessage(message, 'password')
    // salt(16) + nonce(16) + tag(16) + ciphertext(4) = 52
    expect(encrypted.byteLength).toBe(52)
  })
})
```

- [ ] **Step 2: Implement crypto.ts**

```typescript
import { scrypt } from '@noble/hashes/scrypt'

const SALT_SIZE = 16
const NONCE_SIZE = 16
const TAG_SIZE = 16
const SCRYPT_N = 2 ** 14
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_SIZE = 32

export function deriveKey(passphrase: string, salt: Uint8Array): Uint8Array {
  return scrypt(new TextEncoder().encode(passphrase), salt, {
    N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, dkLen: KEY_SIZE,
  })
}

export async function encryptMessage(plaintext: Uint8Array, passphrase: string): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_SIZE))
  const keyBytes = deriveKey(passphrase, salt)
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_SIZE))

  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt'])
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: 128 },
    key, plaintext,
  )
  const encArr = new Uint8Array(encrypted)

  // Web Crypto appends tag. Rearrange to: salt + nonce + tag + ciphertext
  const ciphertext = encArr.slice(0, encArr.length - TAG_SIZE)
  const tag = encArr.slice(encArr.length - TAG_SIZE)

  const result = new Uint8Array(SALT_SIZE + NONCE_SIZE + TAG_SIZE + ciphertext.length)
  result.set(salt, 0)
  result.set(nonce, SALT_SIZE)
  result.set(tag, SALT_SIZE + NONCE_SIZE)
  result.set(ciphertext, SALT_SIZE + NONCE_SIZE + TAG_SIZE)
  return result
}

export async function decryptMessage(payload: Uint8Array, passphrase: string): Promise<Uint8Array> {
  if (payload.length < SALT_SIZE + NONCE_SIZE + TAG_SIZE)
    throw new Error('Payload too short')

  const salt = payload.slice(0, SALT_SIZE)
  const nonce = payload.slice(SALT_SIZE, SALT_SIZE + NONCE_SIZE)
  const tag = payload.slice(SALT_SIZE + NONCE_SIZE, SALT_SIZE + NONCE_SIZE + TAG_SIZE)
  const ciphertext = payload.slice(SALT_SIZE + NONCE_SIZE + TAG_SIZE)

  const keyBytes = deriveKey(passphrase, salt)
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt'])

  // Web Crypto expects tag appended to ciphertext
  const combined = new Uint8Array(ciphertext.length + TAG_SIZE)
  combined.set(ciphertext)
  combined.set(tag, ciphertext.length)

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: 128 },
    key, combined,
  )
  return new Uint8Array(decrypted)
}
```

- [ ] **Step 3: Run tests**

Run: `cd frontend && npx vitest run lib/__tests__/crypto.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/crypto.ts frontend/lib/__tests__/crypto.test.ts
git commit -m "feat: AES-256-GCM + scrypt crypto matching Python prototype"
```

---

### Task 12: Wire format module

**Files:**
- Create: `frontend/lib/wire.ts`
- Create: `frontend/lib/__tests__/wire.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { detectVersion, VERSION } from '../wire'

describe('wire', () => {
  it('detects password repetition mode', () => {
    const payload = new Uint8Array([0x01, ...new Array(50).fill(0)])
    const result = detectVersion(payload)
    expect(result.version).toBe(VERSION.PASSWORD_REPETITION)
    expect(result.data.length).toBe(50)
  })

  it('detects legacy format', () => {
    const payload = new Uint8Array([0x42, ...new Array(50).fill(0)])
    const result = detectVersion(payload)
    expect(result.version).toBe(VERSION.LEGACY)
    expect(result.data.length).toBe(51)
  })
})
```

- [ ] **Step 2: Implement wire.ts**

```typescript
export const VERSION = {
  LEGACY: 'legacy',
  PASSWORD_REPETITION: 'password_repetition',
  WALLET_REPETITION: 'wallet_repetition',
  PASSWORD_BCH: 'password_bch',
  WALLET_BCH: 'wallet_bch',
} as const

export type VersionType = typeof VERSION[keyof typeof VERSION]

const VERSION_MAP: Record<number, VersionType> = {
  0x01: VERSION.PASSWORD_REPETITION,
  0x02: VERSION.WALLET_REPETITION,
  0x11: VERSION.PASSWORD_BCH,
  0x12: VERSION.WALLET_BCH,
}

export function detectVersion(payload: Uint8Array): { version: VersionType; data: Uint8Array } {
  if (payload.length === 0) throw new Error('Empty payload')
  const version = VERSION_MAP[payload[0]]
  if (version) return { version, data: payload.slice(1) }
  return { version: VERSION.LEGACY, data: payload }
}

export function isPasswordMode(version: VersionType): boolean {
  return version === VERSION.LEGACY ||
         version === VERSION.PASSWORD_REPETITION ||
         version === VERSION.PASSWORD_BCH
}
```

- [ ] **Step 3: Run tests, commit**

Run: `cd frontend && npx vitest run lib/__tests__/wire.test.ts`

```bash
git add frontend/lib/wire.ts frontend/lib/__tests__/wire.test.ts
git commit -m "feat: wire format version detection with legacy compat"
```

---

### Task 13: ECIES + ENS module

**Files:**
- Create: `frontend/lib/ecies.ts`
- Create: `frontend/lib/__tests__/ecies.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { encryptToPublicKey, decryptWithPrivateKey } from '../ecies'

describe('ecies', () => {
  it('round-trips encrypt/decrypt with keypair', async () => {
    const { PrivateKey } = await import('eciesjs')
    const sk = new PrivateKey()
    const pk = sk.publicKey.toHex()

    const message = new TextEncoder().encode('Secret for wallet')
    const encrypted = await encryptToPublicKey(pk, message)
    const decrypted = await decryptWithPrivateKey(sk.toHex(), encrypted)
    expect(new TextDecoder().decode(decrypted)).toBe('Secret for wallet')
  })
})
```

- [ ] **Step 2: Implement ecies.ts**

```typescript
import { encrypt, decrypt } from 'eciesjs'
import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'
import { normalize } from 'viem/ens'

const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(),
})

export async function encryptToPublicKey(publicKeyHex: string, plaintext: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(encrypt(publicKeyHex, Buffer.from(plaintext)))
}

export async function decryptWithPrivateKey(privateKeyHex: string, ciphertext: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(decrypt(privateKeyHex, Buffer.from(ciphertext)))
}

export async function resolveENS(nameOrAddress: string): Promise<{
  address: string; name: string | null; avatar: string | null
}> {
  if (nameOrAddress.endsWith('.eth')) {
    const address = await publicClient.getEnsAddress({ name: normalize(nameOrAddress) })
    if (!address) throw new Error(`ENS name not found: ${nameOrAddress}`)
    const avatar = await publicClient.getEnsAvatar({ name: normalize(nameOrAddress) }).catch(() => null)
    return { address, name: nameOrAddress, avatar }
  }
  const name = await publicClient.getEnsName({ address: nameOrAddress as `0x${string}` }).catch(() => null)
  const avatar = name ? await publicClient.getEnsAvatar({ name: normalize(name) }).catch(() => null) : null
  return { address: nameOrAddress, name, avatar }
}
```

- [ ] **Step 3: Run tests, commit**

Run: `cd frontend && npx vitest run lib/__tests__/ecies.test.ts`

```bash
git add frontend/lib/ecies.ts frontend/lib/__tests__/ecies.test.ts
git commit -m "feat: ECIES wallet encryption with ENS resolution"
```

---

### Task 14: WASM loader + Next.js config

**Files:**
- Create: `frontend/lib/stego.ts`
- Modify: `frontend/next.config.mjs`

- [ ] **Step 1: Update next.config.mjs**

Add WASM support, static export, and COOP/COEP headers (needed for SharedArrayBuffer in AudioWorklet):

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'export',
  webpack: (config) => {
    config.resolve.fallback = { fs: false, net: false, tls: false };
    config.experiments = { ...config.experiments, asyncWebAssembly: true };
    return config;
  },
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
      ],
    }];
  },
};

export default nextConfig;
```

**Note:** `headers()` works during `next dev` but is ignored in static export. For production hosting (Vercel, Netlify, etc.), configure COOP/COEP headers in the hosting platform's config.

- [ ] **Step 2: Implement stego.ts**

```typescript
let wasmModule: any = null

async function loadWasm() {
  if (wasmModule) return wasmModule
  const mod = await import('../../carnation-stego/pkg/carnation_stego')
  await mod.default()
  wasmModule = mod
  return mod
}

export async function stegoEncode(
  samples: Float64Array, message: Uint8Array, key: Uint8Array,
): Promise<Float64Array> {
  const wasm = await loadWasm()
  return wasm.wasm_encode(samples, message, key)
}

export async function stegoDecode(
  samples: Float64Array, key: Uint8Array,
): Promise<Uint8Array> {
  const wasm = await loadWasm()
  return wasm.wasm_decode(samples, key)
}

export async function createFrameDecoder(key: Uint8Array, totalFrames: number) {
  const wasm = await loadWasm()
  return new wasm.FrameDecoder(key, totalFrames)
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/stego.ts frontend/next.config.mjs
git commit -m "feat: WASM stego loader with Next.js static export config"
```

---

### Task 15: ffmpeg.wasm transcoding wrapper

**Files:**
- Create: `frontend/lib/transcode.ts`

- [ ] **Step 1: Implement transcode.ts**

```typescript
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

let ffmpeg: FFmpeg | null = null

async function loadFFmpeg(): Promise<FFmpeg> {
  if (ffmpeg?.loaded) return ffmpeg
  ffmpeg = new FFmpeg()
  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm'
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  })
  return ffmpeg
}

/** Convert any audio file to 44.1kHz 16-bit mono raw PCM as Float64Array */
export async function toWav(file: File): Promise<Float64Array> {
  const ff = await loadFFmpeg()
  await ff.writeFile('input', await fetchFile(file))
  await ff.exec(['-i', 'input', '-ar', '44100', '-ac', '1', '-f', 's16le', '-acodec', 'pcm_s16le', 'output.raw'])
  const data = await ff.readFile('output.raw')
  const int16 = new Int16Array((data as Uint8Array).buffer)
  const float64 = new Float64Array(int16.length)
  for (let i = 0; i < int16.length; i++) float64[i] = int16[i]
  return float64
}

/** Convert raw PCM Float64Array to MP3 Blob */
export async function toMp3(samples: Float64Array, sampleRate = 44100): Promise<Blob> {
  const ff = await loadFFmpeg()
  const int16 = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++)
    int16[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i])))
  await ff.writeFile('input.raw', new Uint8Array(int16.buffer))
  await ff.exec(['-f', 's16le', '-ar', String(sampleRate), '-ac', '1', '-i', 'input.raw', '-b:a', '192k', '-y', 'output.mp3'])
  const data = await ff.readFile('output.mp3')
  return new Blob([data], { type: 'audio/mpeg' })
}

/** Convert raw PCM to WAV Blob (for playback) */
export async function toWavBlob(samples: Float64Array, sampleRate = 44100): Promise<Blob> {
  const ff = await loadFFmpeg()
  const int16 = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++)
    int16[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i])))
  await ff.writeFile('input.raw', new Uint8Array(int16.buffer))
  await ff.exec(['-f', 's16le', '-ar', String(sampleRate), '-ac', '1', '-i', 'input.raw', '-y', 'output.wav'])
  const data = await ff.readFile('output.wav')
  return new Blob([data], { type: 'audio/wav' })
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/lib/transcode.ts
git commit -m "feat: ffmpeg.wasm transcoding wrapper"
```

---

### Task 16: AudioWorklet decode processor

**Files:**
- Create: `frontend/public/worklet/decode-processor.js`

This runs in a separate thread. It loads WASM and feeds frames to `FrameDecoder`. Must be plain JS (AudioWorklet cannot use module imports in most browsers).

- [ ] **Step 1: Create decode-processor.js**

```javascript
// frontend/public/worklet/decode-processor.js
const FRAME_SIZE = 1024;

class DecodeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.decoder = null;
    this.buffer = new Float64Array(FRAME_SIZE);
    this.bufferOffset = 0;
    this.done = false;

    this.port.onmessage = async (event) => {
      if (event.data.type === 'init') {
        const { key, totalFrames, wasmUrl } = event.data;
        // Dynamic import of WASM in worklet
        const wasm = await import(wasmUrl);
        await wasm.default();
        this.decoder = new wasm.FrameDecoder(new Uint8Array(key), totalFrames);
        this.port.postMessage({ type: 'ready' });
      }
    };
  }

  process(inputs) {
    if (this.done || !this.decoder || !inputs[0]?.[0]) return true;

    const input = inputs[0][0]; // Float32Array, values in [-1, 1]
    for (let i = 0; i < input.length; i++) {
      // CRITICAL: Scale from Web Audio [-1,1] to PCM [-32768,32767] to match stego engine
      this.buffer[this.bufferOffset++] = input[i] * 32768.0;
      if (this.bufferOffset >= FRAME_SIZE) {
        const result = this.decoder.feed_frame(this.buffer);
        if (result) {
          this.port.postMessage({ type: 'decoded', payload: Array.from(result) });
          this.done = true;
          return true;
        }
        this.port.postMessage({ type: 'progress', value: this.decoder.progress() });
        this.bufferOffset = 0;
      }
    }
    return true;
  }
}

registerProcessor('decode-processor', DecodeProcessor);
```

- [ ] **Step 2: Commit**

```bash
git add frontend/public/worklet/decode-processor.js
git commit -m "feat: AudioWorklet decode processor for real-time playback"
```

---

## Chunk 3: Frontend UI

### Task 17: Theme and layout

**Files:**
- Modify: `frontend/tailwind.config.ts`
- Modify: `frontend/app/globals.css`
- Modify: `frontend/app/layout.tsx`
- Modify: `frontend/app/page.tsx`

- [ ] **Step 1: Update tailwind.config.ts with carnation theme**

Add carnation color palette and DaisyUI theme. Colors: carnation red (#DC143C), dark red (#8B0000), light red (#FF6B6B). Backgrounds: primary (#0A0A0A), secondary (#141414), card (#1A1A1A).

- [ ] **Step 2: Update globals.css**

Set dark body background and white text defaults.

- [ ] **Step 3: Update layout.tsx**

Add `data-theme="carnation"` to html tag. Dark background on body.

- [ ] **Step 4: Update page.tsx with tab navigation**

Two tabs: Encode and Decode. Header with "Carnation Radio" in red + ConnectButton. Placeholder content for each tab.

- [ ] **Step 5: Verify it renders**

Run: `cd frontend && npm run dev`
Expected: Dark theme with red accents, tab navigation works.

- [ ] **Step 6: Commit**

```bash
git add frontend/tailwind.config.ts frontend/app/globals.css frontend/app/layout.tsx frontend/app/page.tsx
git commit -m "feat: carnation dark theme with encode/decode tabs"
```

---

### Task 18: UI components

**Files:**
- Create: `frontend/app/components/AudioDropzone.tsx` — drag-and-drop audio upload
- Create: `frontend/app/components/EncryptionModeToggle.tsx` — password/wallet toggle
- Create: `frontend/app/components/PasswordInput.tsx` — passphrase with strength indicator
- Create: `frontend/app/components/WalletRecipient.tsx` — ENS/address input with avatar
- Create: `frontend/app/components/EncodeProgress.tsx` — step progress for encode pipeline
- Create: `frontend/app/components/MessageReveal.tsx` — animated message display
- Create: `frontend/app/components/AudioPlayer.tsx` — playback with WorkletNode decode

Each component is small and focused. Build them all, then wire into the encode/decode views.

- [ ] **Step 1: Build all components**

See the spec's Frontend & UX section for the design of each component. Key behaviors:

- `AudioDropzone`: Drag-and-drop with border highlight. Accepts `audio/*`.
- `EncryptionModeToggle`: Two buttons, one active (red).
- `PasswordInput`: `type="password"`, strength calculated by length.
- `WalletRecipient`: Debounced ENS resolution, shows avatar + name on success.
- `EncodeProgress`: Step list (transcoding → encrypting → embedding → compressing). Steps light up.
- `MessageReveal`: Three states: idle (hidden), listening (loading dots), revealed (fade-in card).
- `AudioPlayer`: Creates AudioContext, MediaElementSource, AudioWorkletNode, connects to destination. Posts init message to worklet. Listens for decoded message.

- [ ] **Step 2: Commit**

```bash
git add frontend/app/components/
git commit -m "feat: UI components — dropzone, mode toggle, progress, reveal, player"
```

---

### Task 19: Encode view

**Files:**
- Modify: `frontend/app/page.tsx`

- [ ] **Step 1: Wire encode flow**

Replace encode placeholder with full flow:
1. `AudioDropzone` → stores file in state
2. Textarea for message
3. `EncryptionModeToggle` → switches between `PasswordInput` and `WalletRecipient`
4. "Encode" button:
   - Sets stage to `transcoding` → calls `toWav(file)`
   - Sets stage to `encrypting` → calls `encryptMessage()` or `encryptToPublicKey()`
   - Derives embedding key: `SHA-256("carnation-embed:" + passphrase)`
   - Prepends version byte (`0x01` or `0x02`)
   - Sets stage to `embedding` → calls `stegoEncode(samples, payload, embedKey)`
   - Sets stage to `compressing` → calls `toMp3(encodedSamples)`
   - Sets stage to `done` → creates download URL
5. Download button appears

- [ ] **Step 2: Test manually**

Run dev server, upload a WAV, type a message, encode, verify download works.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "feat: encode view — full pipeline"
```

---

### Task 20: Decode view

**Files:**
- Modify: `frontend/app/page.tsx`

- [ ] **Step 1: Wire decode flow**

Two paths:

**File decode (instant):**
1. `AudioDropzone` → file
2. Prompt for passphrase (or wallet connect)
3. Derive embed key: `embed_key = SHA-256("carnation-embed:" + passphrase)` — SAME derivation as encode
4. `toWav(file)` → `stegoDecode(samples, embedKey)` → `detectVersion()` → decrypt with passphrase → show message via `MessageReveal`

**Playback decode:**
1. `AudioDropzone` → file
2. Prompt for passphrase or wallet
3. Derive embed key: `embed_key = SHA-256("carnation-embed:" + passphrase)`
4. `AudioPlayer` with worklet integration (pass embedKey to FrameDecoder)
5. On worklet decoded message → decrypt with passphrase → `MessageReveal`

Default to file decode. "Play & Decode" button activates playback mode.

- [ ] **Step 2: Test manually**

Encode a file with the encode tab. Switch to decode tab, upload the encoded file, enter password. Verify message appears.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/page.tsx
git commit -m "feat: decode view — file decode and real-time playback"
```

---

### Task 21: E2E integration test

**Files:**
- Create: `frontend/lib/__tests__/e2e.test.ts`

- [ ] **Step 1: Generate Python crypto test vector**

Create a Python script that generates a known ciphertext:
```python
# In carnation-stego/testdata/generate_crypto_vector.py
import sys, os, json
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../steganography_cli/engine"))
from crypto import encrypt_message, decrypt_message

passphrase = "cross-compat-test"
plaintext = b"Crypto cross-compat!"
ciphertext = encrypt_message(plaintext, passphrase)

# Verify Python can decrypt
assert decrypt_message(ciphertext, passphrase) == plaintext

vector = {
    "passphrase": passphrase,
    "plaintext": plaintext.decode(),
    "ciphertext_hex": ciphertext.hex(),
}
with open("testdata/crypto_vector.json", "w") as f:
    json.dump(vector, f, indent=2)
```

Run: `cd carnation-stego && ../.venv/bin/python testdata/generate_crypto_vector.py`

- [ ] **Step 2: Write E2E test including cross-compat**

Test the crypto + wire pipeline end-to-end, plus cross-compat with Python:

```typescript
import { describe, it, expect } from 'vitest'
import { encryptMessage, decryptMessage } from '../crypto'
import { detectVersion, VERSION } from '../wire'
import cryptoVector from '../../../carnation-stego/testdata/crypto_vector.json'

describe('e2e pipeline', () => {
  it('encrypt + version prefix + decrypt', async () => {
    const message = new TextEncoder().encode('End-to-end test!')
    const passphrase = 'test-pass'

    const encrypted = await encryptMessage(message, passphrase)
    const payload = new Uint8Array(1 + encrypted.length)
    payload[0] = 0x01
    payload.set(encrypted, 1)

    const parsed = detectVersion(payload)
    expect(parsed.version).toBe(VERSION.PASSWORD_REPETITION)

    const decrypted = await decryptMessage(parsed.data, passphrase)
    expect(new TextDecoder().decode(decrypted)).toBe('End-to-end test!')
  })

  it('decrypts Python-encrypted ciphertext', async () => {
    const ciphertext = Uint8Array.from(
      cryptoVector.ciphertext_hex.match(/.{2}/g)!.map((b: string) => parseInt(b, 16))
    )
    const decrypted = await decryptMessage(ciphertext, cryptoVector.passphrase)
    expect(new TextDecoder().decode(decrypted)).toBe(cryptoVector.plaintext)
  })
})
```

- [ ] **Step 2: Run, commit**

Run: `cd frontend && npx vitest run`

```bash
git add frontend/lib/__tests__/e2e.test.ts
git commit -m "test: E2E crypto + wire format integration"
```

---

### Task 22: Update project docs

**Files:**
- Modify: `CLAUDE.md`
- Modify: `PLAN.md`
- Modify: `TASKS.md`

- [ ] **Step 1: Update CLAUDE.md**

- Header: "Carnation FM" → "Carnation Radio"
- Stego engine target: "TypeScript, Web Audio API / JS FFT library" → "Rust/WASM (carnation-stego crate), Web Audio API AudioWorklet"
- Add note that neural watermarking was evaluated and deferred for MVP
- Reference spec: `docs/superpowers/specs/2026-03-13-phase1-mvp-design.md`
- Reference plan: `docs/superpowers/plans/2026-03-13-phase1-mvp-plan.md`

- [ ] **Step 2: Update PLAN.md**

- Tech stack table: update stego engine row
- Phase 1 status: reference new spec and plan
- Architectural decision: document Rust/WASM over TypeScript, classical over neural

- [ ] **Step 3: Rewrite TASKS.md**

Point to this implementation plan instead of the old ONNX/TypeScript tasks.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md PLAN.md TASKS.md
git commit -m "docs: update project docs to reflect Rust/WASM approach"
```

---

### Task 23: Build and verify

- [ ] **Step 1: Build WASM**

Run: `cd carnation-stego && wasm-pack build --target web --features wasm --out-dir ../frontend/public/wasm`

- [ ] **Step 2: Build Next.js**

Run: `cd frontend && npm run build`
Expected: Static export succeeds.

- [ ] **Step 3: Smoke test**

Serve the static export and test encode → decode round-trip in the browser.

- [ ] **Step 4: Commit any build fixes**

```bash
git add -A
git commit -m "fix: build configuration for WASM + static export"
```

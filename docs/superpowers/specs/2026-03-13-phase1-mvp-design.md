# Carnation Radio — Phase 1 MVP Design Spec

**Date**: 2026-03-13
**Status**: Draft
**Scope**: Phase 1 — browser-based audio steganography with encrypted messaging

---

## Overview

Carnation Radio is a decentralized encrypted communication platform that hides secret messages inside music using audio steganography. The Phase 1 MVP delivers a zero-trust web application where users can:

1. **Encode**: Upload a song + secret message → encrypt → embed in audio → download stego MP3
2. **Decode**: Upload or play stego audio in the browser → message reveals during playback

Everything runs client-side. No backend, no server, no data leaves the browser.

### Why Rust/WASM Instead of TypeScript or Neural Watermarking

The project's PLAN.md and CLAUDE.md previously recommended either a TypeScript port or ONNX-based neural watermarking (IDEAW/XAttnMark). This spec supersedes both with Rust/WASM for the following reasons:

- **Neural watermarking rejected for MVP**: IDEAW and XAttnMark have no publicly available ONNX exports. Model weights would be 50-200MB browser downloads. AudioWorklet latency for neural inference is unproven. Classical DCT patchwork with BCH error correction achieves sufficient robustness (>95% at 128kbps MP3) without these risks.
- **Rust/WASM over TypeScript**: Rust compiles to WASM with near-native DSP performance (SIMD support). Same crate compiles as native CLI. AudioWorklet + WASM is proven (Spotify, SoundCloud, essentia.js). TypeScript FFT libraries are significantly slower and lack SIMD.

PLAN.md and CLAUDE.md should be updated to reflect this decision when implementation begins.

---

## System Architecture

```
┌─────────────────────────────────────────────────┐
│                   Browser (Zero-Trust)           │
│                                                  │
│  ┌──────────────┐  ┌─────────────┐  ┌─────────┐ │
│  │ ffmpeg.wasm  │  │ Stego WASM  │  │  Crypto │ │
│  │ (transcode)  │  │ (Rust DSP)  │  │ AES-GCM │ │
│  │              │  │ DCT/embed/  │  │ scrypt  │ │
│  │ MP3→WAV      │  │ extract     │  │         │ │
│  │ WAV→MP3      │  │             │  │         │ │
│  └──────┬───────┘  └──────┬──────┘  └────┬────┘ │
│         │                 │              │      │
│  ┌──────┴─────────────────┴──────────────┴────┐ │
│  │           TypeScript Orchestration          │ │
│  │  encode flow / decode flow / UI state       │ │
│  └──────┬──────────────────────────────┬──────┘ │
│         │                              │        │
│  ┌──────┴──────┐              ┌────────┴──────┐ │
│  │  eciesjs    │              │ AudioWorklet  │ │
│  │  + viem     │              │ (real-time    │ │
│  │  (ECIES +   │              │  decode via   │ │
│  │   ENS)      │              │  stego WASM)  │ │
│  └─────────────┘              └───────────────┘ │
│                                                  │
│  ┌──────────────────────────────────────────────┐│
│  │        Next.js Static Export (no server)     ││
│  └──────────────────────────────────────────────┘│
└─────────────────────────────────────────────────┘
```

### Five Modules

| Module | Responsibility | Technology |
|--------|---------------|------------|
| **ffmpeg.wasm** | Format transcoding (any input → WAV, WAV → MP3 output). Lazy-loaded — decode-only flows can skip it if input is already WAV. ~25MB one-time load. | `@ffmpeg/ffmpeg` |
| **Stego WASM** | DCT patchwork encode/decode, bin pair selection, repetition/BCH coding | Rust crate compiled to WASM via `wasm-pack` (~100-200KB) |
| **Crypto** | AES-256-GCM encryption, scrypt key derivation (matching Python prototype) | `@noble/hashes/scrypt` + Web Crypto `SubtleCrypto` for AES-GCM |
| **eciesjs + viem** | ECIES wallet encryption, ENS name resolution, public key recovery | Existing npm packages (already installed) |
| **AudioWorklet** | Real-time decode during playback, hosts stego WASM decoder | Web Audio API `AudioWorkletNode` |

### Key Principle

Nothing leaves the browser. No backend, no API calls except ENS resolution via public Ethereum RPC. The entire encode→encrypt→embed and play→extract→decrypt→reveal pipeline runs client-side.

---

## Encryption Modes

### Mode 1: Password (AES-256-GCM)

User enters a passphrase. Key derived via **scrypt** (matching the Python prototype exactly). Message encrypted with AES-256-GCM.

**KDF parameters** (must match `crypto.py`):
- Algorithm: scrypt
- N = 2^14 (CPU/memory cost)
- r = 8
- p = 1
- Key size: 32 bytes (AES-256)
- Salt: 16 random bytes

**AES-GCM parameters** (must match `crypto.py`):
- Nonce: 16 bytes (non-standard but matches prototype; Web Crypto supports arbitrary IV lengths)
- Tag: 16 bytes

**Crypto wire format** (identical to Python `crypto.py`):
```
[salt:16][nonce:16][tag:16][ciphertext:N]
```

**Browser implementation**: Use `@noble/hashes/scrypt` for key derivation (pure JS, no WASM needed, matches Python's scrypt exactly). Use Web Crypto `SubtleCrypto` for AES-GCM encrypt/decrypt with the 16-byte nonce.

### Mode 2: Wallet (ECIES + ENS)

User enters a recipient's ENS name (e.g., `vitalik.eth`) or ETH address (`0x...`).

**Resolution flow**:
1. If ENS name → resolve to address via `viem`
2. Recover recipient's public key from an on-chain transaction signature
3. Encrypt message using `eciesjs` (ECIES to the recipient's public key)
4. Only the recipient's wallet can decrypt (via signature)

**ENS UX**: On valid ENS resolution, display the resolved name + avatar as confirmation ("Encrypting to vitalik.eth"). Uses the ENS `avatar` text record.

### Mode Prefix

The first byte of the embedded payload indicates the encryption mode:

| Byte | Mode |
|------|------|
| `0x00` | Legacy / no prefix (Python prototype compatibility — assume password mode) |
| `0x01` | Password / AES-256-GCM |
| `0x02` | ECIES / Wallet |

This lets the decoder auto-detect which decryption flow to prompt for. See Wire Format section for how this integrates with the Python prototype's format.

---

## Embedding Key Derivation

The stego engine needs a key for PRNG-seeded bin pair selection. This is **separate** from the encryption key.

### Password Mode

Embedding key derived identically to the Python prototype (`carnation.py` line 43):
```
embed_key = SHA-256("carnation-embed:" + passphrase_utf8)
```

### Wallet Mode

The stego embedding key is derived from the **sender's** wallet signature over a fixed challenge:
```
embed_key = SHA-256("carnation-embed:" + sender_signature)
```

The sender signs a deterministic message (e.g., `"carnation-radio embed key"`) via their connected wallet. The signature (or a hash of it) becomes the embedding key. The recipient needs the sender's public key + the same signed challenge to reconstruct the embedding key, which is included as metadata in the ECIES-encrypted payload.

**Alternative under consideration**: Use a fixed public embedding key (all stego files use the same bin pairs). Security comes entirely from encryption, not from secret bin selection. Simpler, but slightly less robust against targeted attacks. Decision to be finalized during implementation.

---

## Wire Format

### V1 Format (this spec)

Extends the Python prototype's format with a version/mode byte:

```
┌────────────┬──────────────┬─────────┬──────────────────────────┐
│ 0xCAFEBABE │ 4-byte len   │ version │ encrypted payload        │
│ (sync)     │ (big-endian) │ (1 byte)│                          │
└────────────┴──────────────┴─────────┴──────────────────────────┘
```

**Version byte** (first byte of payload, included in the 4-byte length):

| Value | Meaning | Coding |
|-------|---------|--------|
| `0x01` | Password mode, 17x repetition | Cross-compatible with Python prototype |
| `0x02` | Wallet (ECIES) mode, 17x repetition | New in V1 |
| `0x11` | Password mode, BCH coding | New in V1 |
| `0x12` | Wallet (ECIES) mode, BCH coding | New in V1 |

High nibble = coding scheme (0 = repetition, 1 = BCH). Low nibble = encryption mode.

### Python Prototype Compatibility

The Python prototype does not emit a version byte — its payload starts directly with the AES-GCM ciphertext (`salt + nonce + tag + ciphertext`). Since salt bytes are random, the first byte is unlikely to be `0x01` or `0x02`.

**Decoding strategy**: After extracting the payload, check the first byte:
- If `0x01`, `0x02`, `0x11`, or `0x12` → V1 format, read version byte, route accordingly
- Otherwise → legacy Python format, assume password mode + 17x repetition, treat entire payload as AES-GCM ciphertext

This provides backwards compatibility without modifying the Python prototype.

### Encoding default

MVP ships with **17x repetition coding as default** (version bytes `0x01`/`0x02`) to maximize cross-compatibility with the Python prototype. BCH coding (`0x11`/`0x12`) is implemented and available as an opt-in flag. BCH becomes the default in a future release once the Python prototype is no longer the primary encoder.

---

## Encode Flow

```
1. User uploads audio file (MP3/FLAC/WAV/OGG/AAC)
       │
2. ffmpeg.wasm transcodes to 44.1kHz 16-bit mono WAV
       │
3. User enters message + chooses mode:
       ├── Password: enter passphrase
       │     → @noble/hashes scrypt derives encryption key
       │     → Web Crypto AES-256-GCM encrypts message
       │     → Embedding key = SHA-256("carnation-embed:" + passphrase)
       │
       └── Wallet: enter recipient ENS name or 0x address
             → viem resolves ENS → address
             → Recover public key from on-chain tx
             → eciesjs encrypts message to that public key
             → Embedding key derived from sender wallet signature
       │
4. Build payload: version_byte + encrypted_ciphertext
       │
5. Prepend wire format: 0xCAFEBABE + 4-byte length + payload
       │
6. Stego WASM embeds payload bits into WAV via DCT patchwork
       │
7. ffmpeg.wasm encodes result to MP3 (192kbps default)
       │
8. User downloads stego MP3
```

---

## Decode Flow

### File Upload Decode

```
1. User uploads stego audio file
       │
2. ffmpeg.wasm transcodes to WAV
       │
3. Stego WASM extracts raw bits via DCT patchwork
       │
4. Deinterleave + majority vote → recover payload bytes
       │
5. Find 0xCAFEBABE sync → read length → extract payload
       │
6. Read first byte to determine version/mode:
       ├── 0x01: password mode → prompt for passphrase → scrypt → AES-GCM decrypt
       ├── 0x02: wallet mode → prompt for wallet connect → ECIES decrypt
       ├── 0x11/0x12: same as above but payload was BCH-coded (already handled in step 4)
       └── other: legacy Python format → prompt for passphrase → scrypt → AES-GCM decrypt
       │
7. Display decrypted message
```

### Real-Time Playback Decode

```
1. User uploads stego audio file
       │
2. FrameDecoder initialized with total sample count (from file metadata)
   and embedding key (derived from passphrase or wallet — prompted before playback)
       │
3. Audio plays through Web Audio API pipeline:
       AudioElement → MediaElementSource → AudioWorklet → Destination
                                               │
4. AudioWorklet runs stego WASM on each frame:
       - Calls FrameDecoder.feed_frame(samples) per 1024-sample frame
       - FrameDecoder accumulates raw bits internally
       - FrameDecoder knows total_frames from initialization,
         so it can compute stride = (total_frames * 6) / 17 for deinterleaving
       │
5. Once sufficient frames processed, FrameDecoder attempts:
       - Deinterleave + majority vote
       - Sync pattern detection (0xCAFEBABE)
       - If found → posts payload to main thread via MessagePort
       │
6. Main thread decrypts (same mode detection as file decode)
       │
7. Message appears on screen while music continues playing
```

**Key requirement**: The `FrameDecoder` must be initialized with the total number of audio frames (available from the file's duration/sample count) to compute the deinterleaving stride. This means real-time decode requires knowing the file length upfront — true streaming (unknown length) is not supported in the MVP. This is acceptable since the MVP is file-based (upload then play), not live-stream-based.

**Threshold for reveal**: The decoder needs roughly `(header_bits + message_bits) * 17 / 6` frames before reliable majority vote. For a typical short message (~100 bytes), approximately 3-4 seconds of playback at 44.1kHz. The UI stays in a "listening..." state until confidence is met, then the message appears at once.

**Stretch goal**: Progressive reveal — characters/words appear as byte-level confidence builds, typewriter-style. Only if implementation complexity is low.

**The music never stops** — the AudioWorklet taps the audio stream non-destructively. The user hears music, then the message materializes.

---

## Rust/WASM Stego Engine

### Crate Structure

```
carnation-stego/
├── src/
│   ├── lib.rs          # Public API: encode(), decode(), extract_frame()
│   ├── dct.rs          # DCT/IDCT via rustfft (real-valued FFT → DCT)
│   ├── patchwork.rs    # Bin pair selection, bit embedding/extraction
│   ├── coding.rs       # Interleaved repetition coding, BCH coding, majority vote
│   ├── framing.rs      # Wire format: sync pattern, length header, version byte
│   ├── prng.rs         # Mersenne Twister (MT19937) matching numpy.random.RandomState
│   └── wasm.rs         # wasm-bindgen exports + AudioWorklet glue
├── Cargo.toml          # Features: "wasm" (wasm-bindgen), "cli" (native)
└── tests/
    └── cross_compat.rs # Round-trip tests + cross-compat with Python output
```

### Parameters (identical to Python prototype)

| Parameter | Value | Source |
|-----------|-------|--------|
| Frame size | 1024 samples (~23ms at 44.1kHz) | `patchwork.py` line 33 |
| Frequency bins | 40–350 (~1.7–15kHz) | `patchwork.py` lines 35-36 |
| Pairs per frame | 6 | `patchwork.py` line 34 |
| Adaptive delta floor | 200.0 | `patchwork.py` line 37 |
| Sync pattern | `0xCAFEBABE` | `patchwork.py` line 38 |
| Repetition coding | 17x interleaved | `patchwork.py` line 39 |

### PRNG Specification (critical for cross-compatibility)

The Python prototype uses `numpy.random.RandomState` seeded with a 31-bit truncated value:

```python
seed = int.from_bytes(SHA256(key + big_endian_u32(frame_idx))[:8], "big")
rng = np.random.RandomState(seed % (2**31))
```

`RandomState` uses the **Mersenne Twister (MT19937)** algorithm. The Rust implementation must replicate this exactly:

**Full key derivation chain** (critical — note the double hash):
```
passphrase → embed_key = SHA-256("carnation-embed:" + passphrase_utf8)     # carnation.py line 43
           → key_hash  = SHA-256(embed_key)                                 # patchwork.py line 245
           → per-frame seed = SHA-256(key_hash + big_endian_u32(frame_idx)) # patchwork.py line 44
           → take first 8 bytes as u64
           → truncate: seed = u64 % 2^31                                    # patchwork.py line 45, 52
           → MT19937(seed) → shuffle bin array                              # patchwork.py line 52-54
```

The Rust implementation must replicate this exact chain, including the double SHA-256 (embedding key is hashed again inside `patchwork.encode()`).

A Rust MT19937 implementation (e.g., from the `rand_mt` crate) must produce identical output to numpy's `RandomState.shuffle()`. This is validated in `cross_compat.rs` with known test vectors.

### WASM Exports

```rust
/// Full encode — takes PCM samples (f64), returns modified samples
fn encode(samples: &[f64], message: &[u8], key: &[u8]) -> Vec<f64>;

/// Full decode — takes PCM samples (f64), returns extracted payload (before decryption)
fn decode(samples: &[f64], key: &[u8]) -> Option<Vec<u8>>;

/// Stateful frame decoder for AudioWorklet
fn create_frame_decoder(key: &[u8], total_frames: u32) -> FrameDecoder;

/// FrameDecoder methods:
impl FrameDecoder {
    /// Feed one frame of 1024 samples. Returns Some(payload) when
    /// enough frames have been processed and sync pattern is found.
    fn feed_frame(&mut self, samples: &[f64]) -> Option<Vec<u8>>;

    /// Returns progress as fraction (0.0 to 1.0) for UI feedback
    fn progress(&self) -> f32;
}
```

Note: The Python prototype uses `float64` (numpy default). The WASM exports use `f64` to match. If AudioWorklet provides `f32` buffers, the WASM glue layer converts.

### Cross-Compatibility

The test suite validates interop with the Python prototype:
- Encode with Python → decode with Rust (V1 decoder handles legacy format)
- Encode with Rust (version `0x01`) → decode with Python (Python ignores version byte as first byte of "ciphertext" — **note**: this means Python prototype cannot decode V1 format without a small patch to skip the version byte. Cross-compat is Rust-decodes-Python, not bidirectional for V1.)
- Same key + same frame index must produce identical bin pairs (MT19937 test vectors)

**Note**: Cross-compatibility is **Rust-decodes-Python only** for V1 format. The Python prototype cannot decode V1-encoded files without modification (it would try to decrypt the version byte as part of the AES-GCM ciphertext). If bidirectional compat is needed, the Rust encoder can emit legacy format (no version byte) via a flag.

---

## Improvements Over Python Prototype

### BCH Error Correction (opt-in for MVP, default later)

**Current**: Each bit repeated 17x with majority vote. Works but wastes capacity.

**Upgrade**: BCH(63,7) or BCH(31,6) codes — same robustness at ~3-5x better message capacity. BCH handles burst errors from MP3 block quantization (validated by Iqbal et al. 2025).

**Capacity comparison** (3-minute song at 44.1kHz, 1024-sample frames):
- Total frames: ~7,735
- Total bit slots: 7,735 * 6 = 46,410
- With 17x repetition: 46,410 / 17 = 2,730 logical bits = **341 bytes** (minus 8-byte header = ~333 bytes max message)
- With BCH(31,6): ~46,410 / 5.17 = 8,978 logical bits = **~1,122 bytes** max message (~3.4x improvement)

The Rust crate implements both coding modes. Version byte high nibble selects the coding scheme. **MVP default is 17x repetition** for Python cross-compatibility. BCH is opt-in via a UI toggle.

### Psychoacoustic Masking (stretch goal, not MVP requirement)

**Current**: Fixed adaptive delta (floor 200.0) regardless of frequency content.

**Possible upgrade**: Compute a simple masking curve per frame — embed stronger in loud frequency regions, softer in quiet ones. Better imperceptibility at the same robustness level.

Not a full psychoacoustic model — a per-bin energy-weighted delta adjustment. **Deferred to post-MVP** unless implementation proves trivial during the DSP work.

---

## Frontend & UX

### Visual Identity

- **Theme**: Black background, carnation red accents, white text
- **Brand mark**: Carnation flower motif (existing hackathon assets from GitHub: `Tranquil-Flow/carnation-radio`)
- **Aesthetic**: Dark, minimal, the audio and message are the focus
- Hackathon assets to pull into repo: screenshot, user flow diagram, tech stack diagram

### Encode View

- Drag-and-drop audio upload (or file picker)
- Text input for the secret message
- Toggle between Password / Wallet mode
  - Password: passphrase field with strength indicator
  - Wallet: ENS name or address input, shows resolved name + avatar on match
- "Encode" button → progress bar (transcode → encrypt → embed → compress)
- Download button for the stego MP3
- Optional: audio preview player to verify the result sounds clean

### Decode View

- Drag-and-drop stego audio upload
- Big play button — audio starts, UI shows a subtle "listening..." state
- Message reveal: after ~3-5 seconds, the decrypted message fades in
- Mode auto-detected from the version byte:
  - `0x01`/`0x11` or legacy: passphrase prompt appears before playback
  - `0x02`/`0x12`: wallet connect prompt, sign to decrypt
- Also supports non-playback decode (upload → instant extract → display)

### Shared Elements

- RainbowKit connect button in header (only needed for wallet mode)
- No accounts, no tracking, no analytics — static site, everything local
- Mobile responsive — encode on desktop, decode on phone is a valid flow

### Tech Stack

- Next.js 14 static export
- Tailwind CSS + DaisyUI (already installed)
- RainbowKit + wagmi + viem (already installed)

---

## Roadmap

### Phase 1: Audio Steganography MVP (this spec)

Zero-trust browser app for audio encode/decode with password and wallet encryption modes. Rust/WASM stego engine with 17x repetition coding (BCH opt-in). Real-time decode during playback via AudioWorklet.

### Phase 2: Image Steganography

JPEG DCT-domain steganography — same DCT concept as audio but in 8x8 pixel blocks. Mature research field, survives social media recompression (proven by TRIST, USENIX 2014). Browser-feasible (Stego-JS by Mask Network is a proof-of-concept). Same UX pattern: upload image + message → download stego image. View image → decode message. Same encryption modes.

### Phase 3: Decentralized Radio Stations (high priority)

**Core goal**: A persistent decentralized audio stream — station owners curate playlists of stego tracks, listeners tune in via the web app, hidden messages decode in real-time as each track plays. No central server.

- Channel NFTs for station ownership on-chain
- Decentralized audio hosting via IPFS/web3.storage or Swarm
- Station browser — discover and tune into channels
- Per-broadcast access rules (open, password, wallet, token-gated)
- Lit Protocol integration for group/NFT-gated encryption
- Live streaming exploration (libp2p, WebRTC, or HLS over IPFS)
- This phase requires solving real-time decode for unknown-length streams (not supported in Phase 1's file-based FrameDecoder)

### Phase 4: Video Steganography & Advanced Features

- Video steganography R&D — open research problem, deep learning methods only viable path for surviving platform re-encoding. Very low capacity (9-18 bits/frame), likely only useful for short codes/links.
- Semaphore ZK anonymity for listeners
- Artist registration, tipping, revenue splitting smart contracts

**Each phase is self-contained** — Phase 1 ships a useful product. Each subsequent phase adds a new medium or distribution layer without breaking what exists.

---

## What Is NOT in Scope for Phase 1

- Server-side anything (no backend, no API)
- Audio hosting or sharing (download only)
- Lit Protocol / group encryption (Phase 3)
- Image or video steganography (Phase 2/4)
- Channel/station infrastructure (Phase 3)
- Token economics (Phase 4)
- True streaming decode (unknown-length audio — Phase 3)
- Psychoacoustic masking (stretch goal / post-MVP)
- Neural watermarking (IDEAW/XAttnMark) — evaluated and deferred; classical DCT patchwork with BCH is sufficient for MVP and avoids model weight/latency/availability issues

---

## Key Academic References

| Paper | Relevance |
|-------|-----------|
| Yeo & Kim, 2003 (Modified Patchwork Algorithm) | Foundation of the stego engine |
| Natgunanathan et al. 2012 | Formal patchwork improvement, buffer compensation |
| Iqbal et al. 2025 | DCT + SS + BCH error correction, validates BCH for MP3 robustness |
| Cruz & Jovanovic-Dolecek 2024 | Real-time watermarking latency analysis (AudioWorklet design) |
| TRIST (USENIX 2014) | Image stego surviving social media recompression (Phase 2 reference) |
| Salah et al. 2024 (Survey) | Comprehensive comparison justifying classical + BCH over neural for MVP |
| IDEAW (Li et al. 2024) | Evaluated for MVP, deferred — no public ONNX weights, large download |
| XAttnMark (Liu et al. 2025) | Evaluated for MVP, deferred — same practical issues as IDEAW |

---

## Critical Constraints

- **Clean-room implementation**: NEVER reference audiowmark source code (GPL). All implementations derive from academic papers cited above.
- **Python prototype is ground truth**: Do not modify `steganography_cli/engine/`. It is the reference for cross-compatibility testing.
- **Zero-trust**: No data leaves the browser. No telemetry, no analytics, no server calls (except public Ethereum RPC for ENS).
- **Naming**: The project name is "Carnation Radio" (not "Carnation FM").

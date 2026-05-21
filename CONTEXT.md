# Carnation Radio — Project Context

## Project Type
Decentralized audio steganography platform. Hide encrypted messages in music, broadcast publicly, decode in browser.

## Critical Constraint
The steganography engine MUST be a clean-room implementation from academic papers. NEVER reference, copy, or look at audiowmark code (GPL licensed). Base implementation on:
- Modified Patchwork Algorithm (Yeo & Kim, 2003)
- Natgunanathan et al. 2012 (formal improvement with buffer compensation)
- Spread spectrum steganography literature

## Current Implementation State

### Rust/WASM Stego Engine (`carnation-stego/`)
Complete clean-room implementation compiled to WASM (~212KB):
- `src/prng.rs` — MT19937 PRNG matching numpy (rejection sampling bitmask, NOT modulo)
- `src/dct.rs` — FFT-based DCT-II/IDCT-II matching scipy ortho normalization
- `src/patchwork.rs` — Bit embedding/extraction with adaptive delta and sign preservation
- `src/coding.rs` — 17x interleaved repetition coding with majority vote
- `src/framing.rs` — Wire format: `0xCAFEBABE` sync + length + version + payload
- `src/lib.rs` — `encode()` / `decode()` with double SHA-256 key chain
- `src/wasm.rs` — WASM exports: `wasm_encode`, `wasm_decode`, `FrameDecoder`

Constants: FRAME_SIZE=1024, PAIRS_PER_FRAME=6, FREQ_BIN_LOW=40, FREQ_BIN_HIGH=350, DELTA_STRENGTH=200.0, REPETITION=17

### Key Derivation Chain
```
passphrase → embed_key = SHA-256("carnation-embed:" + passphrase)
           → key_hash = SHA-256(embed_key) → per-frame PRNG seed
```
The double SHA-256 is applied inside the Rust engine. Frontend derives `embed_key` and passes it in.

#### Version Bytes (wire format payload header)
- `VERSION.PASSWORD` = 0x01 — AES key derived from scrypt passphrase
- `VERSION.WALLET`   = 0x02 — AES key encrypted via ECIES to recipient pubkey
- `VERSION.CLAIM`    = 0x03 — ephemeral AES key, decrypted via claim link

### Frontend (`frontend/`)
Next.js 14 static export with:
- `lib/crypto.ts` — AES-256-GCM + scrypt (matches Python prototype)
- `lib/wire.ts` — Version byte detection
- `lib/ecies.ts` — ECIES encryption + ENS resolution
- `lib/stego.ts` — WASM module loader
- `lib/transcode.ts` — ffmpeg.wasm wrapper (any format → PCM → MP3)
- `lib/registry.ts` — CarnationRegistry client (`lookupRegistry`, `registerSelf` via viem)
- `lib/encrypt-to-address.ts` — Sender encryption: Mode A (ECDH via registry) or Mode B (ephemeral + claim link)
- `lib/tx-pubkey.ts` — On-chain history check for recipient identity display
- `public/worklet/decode-processor.js` — AudioWorklet (scales `input[i] * 32768.0`)
- `app/page.tsx` — Encode/decode tabs with full pipeline
- 7 UI components: AudioDropzone, EncryptionModeToggle, PasswordInput, WalletRecipient, EncodeProgress, MessageReveal, AudioPlayer
- Carnation dark theme (DaisyUI, primary #DC143C)

### Smart Contracts (`contracts/`)
- `CarnationRegistry.sol` — Permissionless pubkey registry (no admin, immutable); maps Ethereum address → compressed secp256k1 pubkey
  - Deployed addresses: Sepolia: 0x80634dE8ddb230dA28241f0656f4c127A4c7566F (deployed + verified 2026-03-27); Ethereum mainnet: TBD

### Python Prototype (`steganography_cli/engine/`) — READ ONLY
- `patchwork.py` — Reference implementation (DO NOT MODIFY)
- `crypto.py` — AES-256-GCM + scrypt KDF
- `carnation.py` — High-level API
- Tests: `test_patchwork.py`, `test_mp3.py`

### Cross-Compatibility
- Rust decodes Python-encoded audio (verified via `tests/cross_compat.rs`)
- TypeScript decrypts Python-encrypted ciphertext (verified via `frontend/lib/__tests__/e2e.test.ts`)

## Tech Stack
- **Stego engine**: Rust → WASM via wasm-pack (rustfft, rand_mt, sha2)
- **Encryption**: AES-256-GCM + scrypt (Web Crypto), eciesjs (ECIES/wallet)
- **Frontend**: Next.js 14 + RainbowKit + Wagmi + Tailwind + DaisyUI
- **Audio**: ffmpeg.wasm (transcoding), AudioWorklet (real-time decode)
- **Smart contracts**: Solidity on Ethereum mainnet + Sepolia, Foundry/forge
  - `CarnationRegistry.sol` — permissionless pubkey registry (no admin, immutable)
  - Deployed addresses: Sepolia: 0x80634dE8ddb230dA28241f0656f4c127A4c7566F (deployed + verified 2026-03-27); Ethereum mainnet: TBD

## Build Commands
```bash
# WASM build
cd carnation-stego && wasm-pack build --target web --features wasm --out-dir ../frontend/public/wasm

# Frontend
cd frontend && npm run build

# Tests
cd carnation-stego && cargo test
cd frontend && npx vitest run
cd forge && forge test --summary
```

## Test Status (last verified 2026-04-07)

### Rust Engine (`cargo test` — Rust 1.94.1)
- `src/lib.rs` unit tests: 12 passed
- `tests/dct_compat.rs`: 1 passed (DCT-II matches scipy ortho)
- `tests/patchwork_pipeline.rs`: 3 passed
- `tests/carnation_pipeline.rs`: 7 passed (MP3/OGG survival at 128k–320k)
- `tests/mp3_survival.rs`: 7 passed (roundtrip + BER threshold)
- `tests/prng_compat.rs`: 1 passed (MT19937 matches numpy)
- `tests/round_trip.rs`: 4 passed (encode/decode, wrong key, long, overflow)
- **Total: 35 passed, 0 failed**
- `cargo clippy -- -D warnings`: clean (4 errors fixed 2026-04-07)

### Smart Contracts (`forge test` — Foundry 1.5.1-stable)
- `CarnationRegistryTest`: 8 passed (lookup, overwrite, event, prefix validation)
- `CounterTest`: 2 passed
- **Total: 10 passed, 0 failed**
- RegisterAndLookup gas: 93,999 (first SSTORE + event emit)

### Frontend (`npx vitest run` — vitest 4.1.0)
- Crypto / wire / registry / wallet / claim-link suites
- Acoustic codecs: `acoustic.test.ts` (single-FSK), `acoustic-ofdm.test.ts` (4-band OFDM)
- Psychoacoustic codec: `psychoacoustic.test.ts` (STFT, Bark, masking), `acoustic-masked.test.ts` (DSSS)
- Microphone listener: `microphone-listener.test.ts`
- Wallet-acoustic integration covering all 3 codecs
- **Total: 108 passed, 6 skipped (as of 2026-05-21)**

## Design Documents
- `docs/superpowers/specs/2026-03-13-phase1-mvp-design.md` — Full design spec
- `docs/superpowers/plans/2026-03-13-phase1-mvp-plan.md` — Implementation plan

## Acoustic codec landscape (2026-05-21)

Three codecs ship alongside each other, exposed via a 3-way selector in the
encode/decode UI:

| Codec | Module | Where it lives | Audibility | Channel |
|---|---|---|---|---|
| **Patchwork** | `carnation-stego` Rust/WASM | DCT bins 40-350 | Mostly inaudible (depends on music) | File (MP3 ≥128 kbps) |
| **OFDM** | `lib/acoustic-ofdm.ts` | 14.5-18 kHz, 4-band FSK | Faint high-frequency whine | Air, 1-5m line-of-sight in quiet rooms |
| **Masked (experimental)** | `lib/acoustic-masked.ts` | 2-6 kHz DSSS at masking threshold | Inaudible at α=1.0 (validated) | File only; does NOT survive air |

Defaults: Patchwork on encode, Patchwork on decode (matches the production
file-sharing use case). Decode-mode selector must match what the sender used.

### Phase 5 air-channel characterization (masked codec)

Tested both speaker→mic configurations:
- Self-coupling (laptop speakers → laptop mic): bandpass + α∈{1,5,20} — fails
- True air gap (m4pro speakers → this laptop mic, 1-4m): α∈{1,5,20} — fails

In every config: chirp sync detection works robustly (peakRatio 8-278 vs the
4.0 threshold), but DSSS data demod gives ~50% bit error rate. Root cause is
the per-bin SNR math at the carrier band:
- DSSS bin value (α=20): ~2,400 vs music bin RMS ~50,000 → −26 dB per-bin
- After 32-chip correlation gain (+15 dB): −11 dB post-correlation SNR
- Need ~+9 dB for ~1% BER → 20 dB gap

Closing that gap requires α≈200 (audible), spread factor ~3200 (50s/bit), or
a different demod (neural codec). The fully-inaudible + air-channel +
practical-bitrate triangle is closed under classical DSSS.

Path forward for masked-over-air: XAttnMark ONNX or IDEAW (Phase 2 targets).

## Phase 2 Targets
- Neural watermarking (IDEAW/XAttnMark ONNX models) — now ALSO the path to masked-over-air
- BCH error correction upgrade from 17x repetition coding
- Wallet-mode decryption in decode view
- IPFS/Arweave storage integration

### Wallet-Mode Encryption (send to Ethereum address)
| Item | Status |
|------|--------|
| Registry contract (`CarnationRegistry.sol`) — code + tests | ✅ done |
| Registry client (`lib/registry.ts`) | ✅ done |
| Sender flow (`lib/encrypt-to-address.ts`) — Mode A (ECDH) + Mode B (ephemeral/claim) | ✅ done |
| Wire format (`VERSION.CLAIM = 0x03`) | ✅ done |
| Tests (registry, encrypt-to-address, tx-pubkey) | ✅ done |
| UI components (claim link display, recipient decode, registration prompt) | ⏳ pending |
| Contract deployment (Ethereum mainnet — future decision) | ⏳ pending |

## Python Environment
`.venv` with Python 3.14, numpy 2.4.2, scipy 1.17.0, pycryptodome 3.23.0. Tests require ffmpeg for MP3 encoding.

## Key Constants / Environment
- Wallet key derivation sign message: `CARNATION_DERIVE_MESSAGE`

## Key Academic References
- Yeo & Kim, 2003 — Modified Patchwork Algorithm (foundation)
- Natgunanathan et al. 2012 — Formal patchwork improvement, buffer compensation
- IDEAW (Li et al. 2024) — Invertible dual-embedding neural watermarking (Phase 2)
- XAttnMark (Liu et al., ICML 2025) — Cross-attention watermarking (Phase 2)


# Milestone: Phase 1 — MVP (Rust/WASM Stego Engine + Frontend)

## Tasks

### Python Prototype — DONE
- [x] Study Modified Patchwork Algorithm paper (Yeo & Kim, 2003)
- [x] Implement DCT-based patchwork embedding (`steganography_cli/engine/patchwork.py`)
- [x] Add AES-256-GCM encryption (`steganography_cli/engine/crypto.py`)
- [x] Build CLI tool (`steganography_cli/engine/cli.py`)
- [x] Test survival against MP3 compression at 128kbps+ (`steganography_cli/engine/test_mp3.py`)
- [x] Write unit tests (`steganography_cli/engine/test_patchwork.py`)

### Rust/WASM Stego Engine (`carnation-stego/`) — DONE
- [x] MT19937 PRNG matching numpy (rejection sampling bitmask)
- [x] FFT-based DCT-II/IDCT-II matching scipy ortho normalization
- [x] Patchwork bit embedding/extraction with adaptive delta
- [x] 17x interleaved repetition coding with majority vote
- [x] Wire format: `0xCAFEBABE` sync + length + version + payload
- [x] Full encode/decode pipeline with double SHA-256 key chain
- [x] WASM exports: `wasm_encode`, `wasm_decode`, `FrameDecoder`
- [x] Cross-compatibility: Rust decodes Python-encoded audio
- [x] PRNG compat tests against Python vectors
- [x] DCT compat tests against scipy vectors
- [x] Round-trip tests (basic, wrong key, long message, capacity overflow)

### Frontend Integration (`frontend/`) — DONE
- [x] AES-256-GCM + scrypt crypto matching Python (`lib/crypto.ts`)
- [x] Wire format version detection (`lib/wire.ts`)
- [x] ECIES encryption + ENS resolution (`lib/ecies.ts`)
- [x] WASM stego module loader (`lib/stego.ts`)
- [x] ffmpeg.wasm transcoding wrapper (`lib/transcode.ts`)
- [x] AudioWorklet decode processor with `input[i] * 32768.0` scaling
- [x] Carnation dark theme (DaisyUI, primary #DC143C)
- [x] UI components: AudioDropzone, EncryptionModeToggle, PasswordInput, WalletRecipient, EncodeProgress, MessageReveal, AudioPlayer
- [x] Encode/decode views in `app/page.tsx`
- [x] E2E tests: crypto + wire format + cross-compat decrypt
- [x] Crypto cross-compat: TypeScript decrypts Python-encrypted ciphertext

### Build & Docs — IN PROGRESS
- [x] Update CONTEXT.md, PLAN.md, TASKS.md
- [ ] Build WASM to frontend (`wasm-pack build --target web --features wasm`)
- [ ] Build Next.js static export (`npm run build`)
- [ ] Smoke test: verify static export produces working output

## Phase 2 Targets
- Neural watermarking (IDEAW/XAttnMark ONNX) for better MP3 robustness
- BCH error correction upgrade from 17x repetition coding
- Wallet-mode decryption in decode view
- IPFS/Arweave storage integration
- Lit Protocol group encryption

## Project Notes
The Python prototype is the reference implementation — do not modify it.

**Clean-room constraint**: NEVER look at audiowmark source code.

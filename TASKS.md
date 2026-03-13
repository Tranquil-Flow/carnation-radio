# Milestone: Phase 1 — Steganography Engine (complete the TypeScript port)

## Tasks

### Python Prototype — DONE
- [x] Study Modified Patchwork Algorithm paper (Yeo & Kim, 2003)
- [x] Implement DCT-based patchwork embedding (`steganography_cli/engine/patchwork.py`)
- [x] Add AES-256-GCM encryption (`steganography_cli/engine/crypto.py`)
- [x] Build CLI tool (`steganography_cli/engine/cli.py`)
- [x] Test survival against MP3 compression at 128kbps+ (`steganography_cli/engine/test_mp3.py`)
- [x] Write unit tests (`steganography_cli/engine/test_patchwork.py`)

### Architecture Decision — MADE (see PLAN.md § Architectural Decision Summary 2026)
The 2026 literature review concludes neural watermarking is the right approach for the TypeScript port:
- **Encoder**: IDEAW (ONNX-exportable, <10ms CPU encode/detect)
- **Decoder**: XAttnMark fast detector — no full inversion required, real-time safe for Web Audio API
- Full rationale in PLAN.md — do not relitigate this decision, proceed with ONNX approach

### Benchmark (one-time validation before committing to ONNX path)
- [ ] Run IDEAW inference against Python prototype on the same test corpus — measure bit accuracy at 128kbps MP3; if >95% and <10ms decode latency in browser → confirmed, proceed; if not → fall back to BCH-enhanced classical port (document result either way)

### TypeScript Engine (`frontend/src/stego/`)
- [ ] Set up `onnxruntime-web` in the Next.js frontend
- [ ] Implement `encode(audioBuffer: AudioBuffer, message: string, key: string): Promise<AudioBuffer>` — wraps ONNX IDEAW encoder
- [ ] Implement `decode(audioBuffer: AudioBuffer, key: string): Promise<string | null>` — wraps XAttnMark fast detector
- [ ] Port AES-256-GCM layer from Python using Web Crypto API (`crypto.ts`) — same wire format (`\xCAFEBABE` + 4-byte length + encrypted payload)
- [ ] Wire key derivation equivalent to Python scrypt KDF using SubtleCrypto PBKDF2
- [ ] Unit tests: round-trip encode→decode, noise tolerance, wrong key returns null, cross-compat with Python prototype output
- [ ] MP3 survival test: encode in TypeScript → compress to MP3 via ffmpeg.wasm → decode, assert >90% bit accuracy

### Web Audio API Real-Time Decoder
- [ ] Build `RealtimeDecoder` using `AudioWorkletNode` (preferred) or `ScriptProcessorNode` (fallback)
- [ ] Decoder processes audio frames during playback and runs XAttnMark fast detector per frame
- [ ] Emit decoded message event as soon as sufficient frames accumulate (ring buffer)
- [ ] Test: play encoded MP3 in browser → message appears within 5 seconds of playback start

### Demo Webapp (`frontend/app/demo/`)
- [ ] Encode tab: upload audio file + enter message + key → download stego audio
- [ ] Decode tab: upload audio file + enter key → display decoded message
- [ ] End-to-end test: encode in browser → compress to MP3 → decode in browser → message matches
- [ ] Deploy demo to Vercel

## Phase 2 Preview (Wallet Integration + Encryption Modes)
ECIES mode (`eciesjs` — encrypt to ETH address, no key exchange needed), Lit Protocol group mode (on-chain access conditions), RainbowKit wallet connect, decentralized audio storage (IPFS/web3.storage). TASKS.md for Phase 2 to be written when Phase 1 ships.

## Project Notes
The Python prototype is the reference implementation — do not modify it, it is the ground truth for cross-compatibility testing.

**Clean-room constraint**: NEVER look at audiowmark source code. All implementations must derive from academic papers cited in PLAN.md.

Key reference parameters (Python prototype):
- Frame size: 1024 samples, frequency bins 40–350 (~1.7–15kHz), 6 bin pairs per frame
- Adaptive delta with floor 200.0, 17x interleaved repetition coding
- SHA-256 keyed bin selection, scrypt KDF, `\xCAFEBABE` sync pattern + 4-byte length header

Key files:
- `steganography_cli/engine/patchwork.py` — reference encoder
- `steganography_cli/engine/crypto.py` — reference AES-256-GCM
- `steganography_cli/engine/test_mp3.py` — MP3 survival test harness (requires ffmpeg)
- `frontend/` — Next.js app (wallet connect only, no audio yet; npm with package-lock.json)
- `forge/` — Solidity contracts on Sepolia (CarnationAuction + CarnationAudioNFT, untested)

Python env: `.venv` with Python 3.14, numpy 2.4.2, scipy 1.17.0, pycryptodome 3.23.0. ffmpeg required for MP3 tests.

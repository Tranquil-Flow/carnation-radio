# Carnation FM — Project Context

## Project Type
Decentralized audio steganography platform. Hide encrypted messages in music, broadcast publicly, decode in browser.

## Critical Constraint
The steganography engine MUST be a clean-room implementation from academic papers. NEVER reference, copy, or look at audiowmark code (GPL licensed). Base implementation on:
- Modified Patchwork Algorithm (Yeo & Kim, 2003)
- Natgunanathan et al. 2012 (formal improvement with buffer compensation)
- Spread spectrum steganography literature

## Current Implementation State
**Python prototype complete** at `steganography_cli/engine/`:
- `patchwork.py` — DCT-based MPA (1024-sample frames, bins 40-350, 6 pairs/frame, adaptive delta, 17x interleaved repetition coding)
- `crypto.py` — AES-256-GCM + scrypt KDF
- `carnation.py` — High-level API (hide_message / reveal_message)
- `cli.py` — argparse CLI (encode/decode)
- `test_patchwork.py` — Unit tests (round-trip, noise, SNR >20dB)
- `test_mp3.py` — MP3 survival at 128k/192k/256k/320k + OGG

**Not started**: TypeScript port, Web Audio API decoder, demo webapp.

## Tech Stack
- **Stego engine (prototype)**: Python, scipy (DCT), numpy, pycryptodome
- **Stego engine (target)**: TypeScript, Web Audio API / JS FFT library
- **Encryption**: AES-256-GCM (raw key), eciesjs (ECIES/wallet), Lit Protocol (group)
- **Smart contracts**: Solidity on Ethereum (Sepolia), Foundry/forge
- **Frontend**: Next.js + RainbowKit + Wagmi + Tailwind + DaisyUI
- **Storage**: IPFS/web3.storage, Arweave, or Swarm

## Existing Code (from hackathon, mostly broken)
- `steganography_cli/` — Old LSB encoder (C) and subsonic encoder (JS). Both broken for radio use.
- `steganography_cli/engine/` — NEW working Python prototype (patchwork algorithm)
- `forge/` — CarnationAuction.sol and CarnationAudioNFT.sol deployed on Sepolia. No tests.
- `frontend/` — Next.js shell with wallet connect only. No audio playback or contract interaction.

## Key Academic References
- Yeo & Kim, 2003 — Modified Patchwork Algorithm (foundation)
- Natgunanathan et al. 2012 — Formal patchwork improvement, buffer compensation
- Zhang et al. 2025 (RASF) — Surviving AAC/MP3 codec block boundaries
- Cruz & Jovanovic-Dolecek 2024 — Real-time watermark latency (Web Audio API design)
- AudioSeal (Meta, 2024) — Perceptual masking loss, fast detector (open-source)
- RAW-Bench (Sony, 2025) — Standardized evaluation benchmark
- IDEAW (Li et al. 2024) — Invertible dual-embedding neural watermarking, 95%+ bit accuracy at 128kbps MP3, <10ms encode/detect on CPU. ONNX-exportable for browser target.
- XAttnMark (Liu et al., ICML 2025) — Cross-attention watermarking, 99.3% bit accuracy, survives OGG Vorbis. Fast detector (no full inversion) enables real-time Web Audio API decode.
- Survey (Salah et al. 2024) — Comprehensive comparison showing neural > classical+BCH for MP3/AAC robustness. Informs TS port architecture decision.

## Python Environment
`.venv` with Python 3.14, numpy 2.4.2, scipy 1.17.0, pycryptodome 3.23.0. Tests require ffmpeg for MP3 encoding.

## Key Design Decisions
- TypeScript port must maintain identical embedding parameters for cross-compatibility with Python prototype
- Consider BCH error correction as upgrade from 17x repetition coding (better capacity, same robustness — see 2025 literature)
- Web Audio API decoder must work in real-time during playback (latency is a critical constraint)

# Carnation FM v2

A decentralized encrypted communication platform that hides secret messages inside music files using audio steganography. Music is broadcast publicly, but only those with the right key can extract hidden messages. Built for censorship-resistant communication.

## Core Innovation

**Patchwork/spread spectrum steganography in the audible range** — slightly adjusts amplitudes across audible frequencies using a pseudo-random key. Survives MP3 compression at 128kbps+ (98% recovery rate). Browser-decodable via Web Audio API. No existing tool combines compression-survivable + encrypted + browser-decodable + decentralized.

## Key Distribution — Why Blockchain

The fundamental problem: if you need a secure channel to share the key, why not just share the message? Blockchain dissolves this — ETH public keys are the key infrastructure.

### Encryption Modes

1. **Raw Key** — User picks a password, AES encrypts, embeds. Recipients get key out-of-band (flyers, DMs, word of mouth). Most punk.
2. **ECIES (1-to-1)** — Encrypt to a specific ETH address using their public key. No key exchange needed.
3. **Lit Protocol (group)** — Encrypt with on-chain access conditions (e.g., must hold NFT). Threshold cryptography.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Steganography engine | Rust → WASM via wasm-pack (rustfft, rand_mt, sha2) |
| Python prototype | Python, scipy (DCT), numpy, pycryptodome (READ-ONLY reference) |
| Encryption | AES-256-GCM (raw key), eciesjs (ECIES/wallet), Lit Protocol (group) |
| Smart contracts | Solidity on Ethereum (Sepolia), Foundry/forge |
| Frontend | Next.js + RainbowKit + Wagmi + Tailwind + DaisyUI |
| Storage | IPFS/web3.storage (free tier), Arweave, or Swarm |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    CARNATION FM v2                        │
├─────────────────────────────────────────────────────────┤
│  CHANNELS                                                │
│    Channel NFT = ownership of a station                  │
│    Owner uploads audio + embedded messages                │
│    Owner sets access rules per broadcast                  │
│                                                          │
│  ACCESS MODES (per broadcast, channel owner chooses):    │
│    Open - anyone can decode                              │
│    Raw Key - shared password                             │
│    ECIES - specific wallet only                          │
│    Lit Protocol - token/NFT gated group                  │
│                                                          │
│  STEGANOGRAPHY                                           │
│    Patchwork/spread spectrum in audible range             │
│    Survives MP3 compression + streaming                  │
│    Decoded in real-time via Web Audio API                 │
│                                                          │
│  STORAGE                                                 │
│    IPFS/web3.storage (free tier), Arweave, or Swarm     │
│                                                          │
│  WEBAPP (PWA)                                            │
│    Browse channels > Play audio > Decode messages         │
│    Connect wallet for ECIES/Lit decryption               │
│    Or enter raw key for password mode                    │
└─────────────────────────────────────────────────────────┘
```

## Phased Roadmap

### Phase 1: Steganography Engine ← CURRENT (~95% done)
Python prototype complete. Rust/WASM engine complete (clean-room DCT patchwork, cross-compatible with Python). Frontend complete (encode/decode views, crypto, AudioWorklet). Remaining: final build verification.

### Phase 2: Wallet Integration + Encryption Modes
ECIES mode (wallet-to-wallet via eciesjs), Lit Protocol mode (group/token-gated), wallet connect (RainbowKit), decentralized storage (IPFS/web3.storage).

### Phase 3: Radio Stations
Channel NFTs (station ownership), playlist management, station browser, per-broadcast access rules, embedded player with real-time decoder, play tracking.

### Phase 4: Economics
Artist registration + track uploads, tipping + subscriptions, revenue splitting smart contracts (% artist, % curator, % platform), batch settlements (off-chain play counting, on-chain periodic settlement).

### Phase 5: Ecosystem
Discovery/trending, Semaphore ZK anonymity for listeners, premium channel name auctions (ENS-style), PWA optimization.

## Academic References

### Foundation
- Modified Patchwork Algorithm — Yeo & Kim, 2003 (basis of current implementation)
- Natgunanathan et al. 2012 — Formal patchwork improvement with provable decoding probability and buffer compensation

### Compression Robustness
- Zhang et al. 2025 (RASF) — Triple-stage pipeline for surviving AAC/MP3 codec block boundaries
- Iqbal et al. 2025 — DCT + SS + BCH error correction, BER <0.08 under MP3
- Zhu et al. 2025 — Most recent patchwork improvement with desynchronization resilience

### Real-Time Decoding
- Cruz & Jovanovic-Dolecek 2024 — Real-time audio watermarking latency analysis
- AudioSeal (Meta, 2024) — Single-pass fast detector, open-source perceptual masking loss

### Evaluation
- RAW-Bench (Sony, 2025) — Standardized audio watermarking benchmark with MP3/AAC/OGG attack pipeline

### Key Insight from Literature
Multiple 2025 papers converge on BCH error correcting codes for MP3 robustness (handles burst errors from block quantization). Current repetition coding (17x) works but BCH would improve capacity at same robustness.

## Existing Code

- `carnation-stego/` — Rust/WASM stego engine (complete, cross-compatible with Python)
- `steganography_cli/engine/` — Python prototype (READ-ONLY reference)
- `steganography_cli/` — Old hackathon code (LSB + subsonic, archived)
- `forge/` — CarnationAuction.sol + CarnationAudioNFT.sol on Sepolia (no tests)
- `frontend/` — Next.js 14 app with encode/decode views, crypto, WASM stego integration

## Research Updates (2026)

### State-of-the-Art Neural Audio Watermarking

Three papers integrated 2026-02-26 that directly inform the TypeScript port architectural decision:

#### IDEAW: Robust Neural Audio Watermarking with Invertible Dual-Embedding (EMNLP 2024)
- **Authors**: Pengcheng Li, Xulong Zhang, Jing Xiao, Jianzong Wang
- **DOI**: 10.48550/arXiv.2409.19627 | Citations: 13
- **Key Finding**: Invertible neural network with dual embedding paths (robustness path + capacity path). Reports 95%+ bit accuracy at 128kbps MP3 vs. ~75-80% for classical DCT patchwork methods. Encoder and detector both run in <10ms on CPU.
- **Integration Guidance**: Before committing to a TypeScript port of the Python DCT patchwork, benchmark IDEAW against the existing prototype. IDEAW's encoder is ONNX-exportable and can target the browser via onnxruntime-web — satisfying the Web Audio API real-time constraint. Because this is a different algorithm from the Python patchwork, it also satisfies the clean-room implementation constraint with no risk of GPL contamination from audiowmark.

#### XAttnMark: Learning Robust Audio Watermarking with Cross-Attention (ICML 2025)
- **Authors**: Yixin Liu, Lie Lu, Jihui Jin, Lichao Sun, Andrea Fanelli
- **DOI**: 10.48550/arXiv.2502.04230 | Citations: 8
- **Key Finding**: Current state-of-the-art (2025). Uses cross-attention to embed bits in psychoacoustically masked regions. First system to reliably survive OGG Vorbis compression in addition to MP3. Achieves 99.3% bit accuracy at 128kbps MP3. Crucially, includes a fast detector that does not require full inversion of the neural encoder — the decoder only extracts bits, not audio.
- **Integration Guidance**: XAttnMark's fast detector architecture is the right design target for Carnation-radio's Web Audio API decoder. The decoder only needs to extract bits during playback, not reconstruct audio. This directly addresses the real-time latency constraint identified in CONTEXT.md — a full post-hoc decode pass is unnecessary. Prioritize implementing or ONNX-porting the XAttnMark fast detector over a full encoder/decoder pair.

#### Survey of imperceptible and robust digital audio watermarking systems (Multimedia Tools and Applications, 2024)
- **Authors**: Euschi Salah, Z. Narima, Amine Khaldi, K. Redouane
- **DOI**: 10.1007/s11042-024-18969-4 | Citations: 16
- **Key Finding**: Comprehensive comparison of patchwork, spread-spectrum, and neural watermarking approaches and their robustness tradeoffs under MP3/AAC compression. Neural watermarking consistently outperforms classical methods for MP3/AAC robustness. BCH error correction applied to classical methods narrows the gap but does not close it. The survey quantifies the tradeoff between bit capacity and robustness across all major algorithm families.
- **Integration Guidance**: Use this survey's comparison tables as the technical justification in architectural decisions for the TypeScript port. The two candidate paths are: (a) upgrade the Python DCT patchwork with BCH error correction and port it to TypeScript, or (b) switch to a neural watermarking approach (IDEAW or XAttnMark). The survey's data makes option (b) the stronger choice for MP3 survival and positions neural watermarking as the right long-term direction for Phase 1 completion.

### Architectural Decision Summary (2026)

The three papers together recommend the following updated approach for Phase 1 completion:

1. Do not directly port the Python DCT patchwork to TypeScript without first benchmarking against IDEAW.
2. Target XAttnMark's fast detector as the Web Audio API decoder — it is latency-optimal and format-agnostic (MP3 + OGG).
3. Use the Survey (Salah et al. 2024) comparison tables as the written justification for choosing neural watermarking over BCH-enhanced classical methods.

## Version Map

| Version | Scope | Status |
|---------|-------|--------|
| V0 | Hackathon prototype (ETHDam, LSB/subsonic, broken) | Done (archived) |
| V1 | Working MVP — stego engine + encryption + radio stations | In progress |
| V2 | Economics, ecosystem, PWA, Semaphore anonymity | Future |

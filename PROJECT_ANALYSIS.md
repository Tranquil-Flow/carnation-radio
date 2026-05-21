# Carnation FM v2 - Project Analysis & Research Summary

## Session Date: 2026-02-17

## What Is This Project?

Carnation FM is a decentralized encrypted communication platform that hides secret messages inside music files using audio steganography. Music is broadcast publicly, but only those with the right key can extract hidden messages.

**Original repo:** https://github.com/Tranquil-Flow/carnation-radio
**Location:** /Users/evinova/Documents/carnation-radio

---

## Original Hackathon Project Assessment

### Three Components:

1. **Whistle (steganography_cli/Step2_AudioEncryptWhistle/)** - WORKING
   - C-based LSB steganography with AES-128-CBC encryption
   - Solid crypto but **fundamentally broken for radio** - LSBs are destroyed by any compression/streaming
   - Has debug flag `offset=0` on line 303

2. **Subsonic Encoder (steganography_cli/Step1_EncodeFile/)** - BROKEN/INCOMPLETE
   - JavaScript, encodes data as sine waves at 10Hz/15Hz
   - Right concept (frequency-based survives broadcast) but wrong frequencies (speakers can't produce 10-15Hz)
   - Hardcoded message "LOL", 2 bits/sec, no error correction, decoder has bugs

3. **Smart Contracts (forge/)** - DEPLOYED ON SEPOLIA
   - CarnationAuction.sol - 24h auction for playlist NFT slots
   - CarnationAudioNFT.sol - ERC721 NFT minted to winners
   - Swarm integration is a placeholder comment
   - No tests for actual contracts
   - Deployed: Auction 0x4894421a7c0bc369a5c10ddbaf4dbc7cf3b72ae5, NFT 0x75993080804d364419445175c5a543eda6a20bb0

4. **Frontend (frontend/)** - SHELL ONLY
   - Next.js + RainbowKit + Wagmi + Tailwind + DaisyUI
   - Just wallet connect + static radio player mockup
   - No audio playback, no contract interaction, no steganography UI

---

## Research Findings

### Steganography Approach Decision

**LSB steganography (whistle):** Does NOT survive compression/streaming. Wrong for radio.

**Subsonic/infrasonic (10-15Hz):** Speakers can't produce these. Wrong frequencies.

**Near-ultrasonic (17-19kHz):** Destroyed by MP3/AAC/streaming codecs (they filter above ~16kHz). ruvnet/ultrasonic framework claims otherwise but its own code warns against it.

**CHOSEN APPROACH: Patchwork/Spread Spectrum in the audible range**
- Slightly adjust amplitudes across the audible frequency spectrum, pseudo-randomly selected with a key
- Imperceptible (psychoacoustic masking - music hides changes)
- Survives MP3 compression at 128kbps+ (98% recovery rate per academic research)
- Survives streaming
- All speakers reproduce audible frequencies
- Based on published academic algorithm: "Modified Patchwork Algorithm" (Yeo & Kim, 2003)
- audiowmark (GPL) implements this but we must do a clean-room implementation (read papers, never look at GPL code)

### Existing Tools Analyzed

| Tool | Approach | Survives MP3 | Browser Decode | Encryption | License |
|------|----------|-------------|---------------|------------|---------|
| audiowmark | Patchwork FFT (audible) | YES (128kbps+) | No (CLI) | No | GPL |
| ggwave | Multi-freq FSK | No | Yes (WASM) | No | MIT |
| quiet-js | OFDM modem | No | Yes (Web Audio) | No | BSD-3 |
| ruvnet/ultrasonic | FSK 18.5-19.5kHz | No | Partial | AES-256 | MIT |

**Gap we fill:** Nobody has compression-survivable + encrypted + browser-decodable + decentralized. That's our niche.

### Key Distribution - The Core Innovation

The fundamental problem: if you need a secure channel to share the key, why not just share the message?

**Solution: Blockchain dissolves this problem.**

Three encryption modes decided:

1. **Raw Key (Mode 1):** User picks a password/key, AES encrypts, embeds. Recipients get key however they want (flyers, DMs, word of mouth). Most punk. Most flexible.

2. **ECIES (Mode 2, 1-to-1):** Encrypt TO a specific ETH address using their public key. Only that wallet can decrypt. No key exchange needed - blockchain IS the key infrastructure. Use eciesjs library (MIT).

3. **Lit Protocol (Mode 3, group):** Encrypt with on-chain access conditions (e.g., "must hold CarnationFM NFT"). Threshold cryptography - no single entity holds full key. NFT ownership = decryption rights. Optional: add Semaphore ZK proofs for anonymous listening.

### Storage Costs (per 4-min MP3 track)

| Platform | Cost | Model |
|----------|------|-------|
| Swarm | ~$0.012/year | Annual, BZZ token |
| Arweave | ~$0.004-$0.06 | One-time, forever |
| web3.storage (IPFS) | Free (5GB) | Free tier = ~625 tracks |

Storage is essentially free at small scale. The NFT auction is NOT needed for funding storage.

### NFT/Auction System Analysis

Original purpose was disconnected (funding + curation in one).

**New vision: NFT as channel ownership**
- Each NFT = a "radio station/channel"
- Channel owner curates playlists, sets access rules
- Listeners browse/tune in
- Good curation = more listeners = more earnings
- The auction could be for premium channel names (like ENS)

**Artist payment model:**
- Start with tips + optional subscriptions (works from day one)
- Plan for batch settlements later (count plays off-chain, settle on-chain periodically)
- Revenue split: % artist, % curator, % platform via smart contracts

---

## Architecture Decision

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
│  WEBAPP (PWA - desktop + mobile)                         │
│    Browse channels > Play audio > Decode messages         │
│    Connect wallet for ECIES/Lit decryption               │
│    Or enter raw key for password mode                    │
└─────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Steganography Engine (PRIORITY - build first)
- TypeScript/JavaScript library
- Patchwork algorithm (clean-room from academic papers)
- Encode/decode hidden messages in audio
- Raw key mode (AES-GCM)
- Browser support via Web Audio API
- CLI tool for power users
- Simple demo webapp
- Must survive MP3 compression at 128kbps+

### Phase 2: Wallet Integration + Encryption Modes
- ECIES mode (wallet-to-wallet, eciesjs)
- Lit Protocol mode (group/token-gated)
- Wallet connect (RainbowKit)
- Decentralized storage (IPFS/web3.storage)

### Phase 3: Radio Stations
- Channel creation, playlist management
- Station browser for listeners
- Play tracking
- Per-station access rules
- Embedded player + decoder

### Phase 4: Economics
- Artist registration + track uploads
- Tipping, subscriptions
- Revenue splitting smart contracts
- Batch settlements

### Phase 5: Ecosystem
- Discovery/trending, Semaphore anonymity, premium auctions, ads, PWA optimization

---

## Skills/Plugins Installed

### Mindrally Skills (in ~/.claude/skills/):
- scipy-best-practices (DSP, FFT, signal processing)
- numpy-best-practices (numerical computing)
- python, typescript (languages)
- vite (bundling)
- performance-optimization (real-time audio)
- security-best-practices (crypto)
- jest (testing)
- ethereum, solidity, blockchain, onchainkit (Web3)
- nextjs-react-typescript, tailwindcss (frontend)
- pwa-development, websocket-development (platform)

### Existing Plugins:
- scientific-skills (matplotlib, sympy, research tools)
- superpowers (TDD, brainstorming, planning)
- feature-dev (architecture, development)
- frontend-design, typescript-lsp, security-guidance, code-simplifier
- claude-mem (memory - needs uv installed for vector search)

---

## Next Steps

Start Phase 1 implementation:
1. Read patchwork algorithm academic papers in depth
2. Design encoder/decoder architecture
3. Prototype in Python (scipy FFT) to validate approach
4. Port to TypeScript for browser
5. Test against MP3 compression
6. Build simple demo webapp

---

## Key References

- Modified Patchwork Algorithm paper: https://ieeexplore.ieee.org/document/918798/
- audiowmark (reference, GPL - do NOT copy code): https://github.com/swesterfeld/audiowmark
- ggwave (data-over-sound, MIT): https://github.com/ggerganov/ggwave
- quiet-js (Web Audio modem, BSD): https://github.com/quiet/quiet-js
- eciesjs (ECIES for ETH keys, MIT): https://github.com/ecies/js
- Lit Protocol: https://developer.litprotocol.com/sdk/access-control/quick-start
- Semaphore (ZK group membership): https://semaphore.pse.dev/
- Web Audio API AnalyserNode: https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode
- EIP-5630 (ETH encryption): https://eips.ethereum.org/EIPS/eip-5630
- Spread spectrum steganography: https://pmc.ncbi.nlm.nih.gov/articles/PMC9105752/

# Carnation FM — Claude Context

## Project Type
Decentralized audio steganography platform. Hide encrypted messages in music, broadcast publicly, decode in browser.

## Critical Constraint
The steganography engine MUST be a clean-room implementation from academic papers. NEVER reference, copy, or look at audiowmark code (GPL licensed). Base implementation on the Modified Patchwork Algorithm (Yeo & Kim, 2003) and spread spectrum steganography literature.

## Tech Stack
- **Steganography engine**: TypeScript, Web Audio API, FFT-based patchwork
- **Encryption**: AES-GCM (raw key), eciesjs (ECIES/wallet), Lit Protocol (group)
- **Smart contracts**: Solidity on Ethereum (Sepolia), Foundry/forge
- **Frontend**: Next.js + RainbowKit + Wagmi + Tailwind + DaisyUI
- **Storage**: IPFS/web3.storage, Arweave, or Swarm

## Existing Code (from hackathon, mostly broken)
- `steganography_cli/` — LSB encoder (C) and subsonic encoder (JS). Both broken for radio use.
- `forge/` — CarnationAuction.sol and CarnationAudioNFT.sol deployed on Sepolia. No tests.
- `frontend/` — Next.js shell with wallet connect only. No audio playback or contract interaction.

## Key References
- Modified Patchwork Algorithm: https://ieeexplore.ieee.org/document/918798/
- eciesjs (MIT): https://github.com/ecies/js
- Lit Protocol: https://developer.litprotocol.com/sdk/access-control/quick-start
- Spread spectrum steganography: https://pmc.ncbi.nlm.nih.gov/articles/PMC9105752/

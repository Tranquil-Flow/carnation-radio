# Carnation FM v2

A decentralized encrypted communication platform that hides secret messages inside music files using audio steganography. Music is broadcast publicly, but only those with the right key can extract hidden messages. Built for censorship-resistant communication.

## Core Innovation

**Patchwork/spread spectrum steganography in the audible range** — slightly adjusts amplitudes across audible frequencies using a pseudo-random key. Survives MP3 compression at 128kbps+ (98% recovery rate). Browser-decodable via Web Audio API. No existing tool combines compression-survivable + encrypted + browser-decodable + decentralized.

## Encryption Modes

1. **Raw Key** — User picks a password, AES encrypts, embeds. Recipients get key out-of-band.
2. **ECIES (1-to-1)** — Encrypt to a specific ETH address using their public key. Blockchain is the key infrastructure.
3. **Lit Protocol (group)** — Encrypt with on-chain access conditions (e.g., must hold NFT). Threshold cryptography.

## Architecture

- **Channels** — NFTs representing radio stations. Owner curates playlists, sets access rules per broadcast.
- **Storage** — IPFS/web3.storage, Arweave, or Swarm. Essentially free at small scale.
- **Frontend** — PWA with embedded player + real-time decoder via Web Audio API.
- **Smart Contracts** — Channel ownership, revenue splitting, batch settlements.

## Implementation Phases

1. **Steganography Engine** — Clean-room patchwork algorithm in TypeScript, browser + CLI support
2. **Wallet Integration** — ECIES, Lit Protocol, decentralized storage
3. **Radio Stations** — Channel creation, playlist management, station browser
4. **Economics** — Artist payments, tipping, subscriptions, revenue splitting
5. **Ecosystem** — Discovery, Semaphore anonymity, premium auctions, PWA optimization

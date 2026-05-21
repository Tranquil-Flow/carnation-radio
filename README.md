# Carnation Radio

Decentralized encrypted communication hidden in music. Encrypt a message to a passphrase or an Ethereum address, embed it in any audio file, and only the recipient can extract it. Three different steganography codecs cover different threat models and channels — from MP3-safe file watermarks to over-the-air live broadcasts at events.

## What's in the box

Three steganography codecs ship side-by-side, selectable per encode/decode:

| Codec | Where | Audibility | Channel | Status |
|---|---|---|---|---|
| **Patchwork** (Rust → WASM) | DCT bins 40-350 | Mostly inaudible | File (MP3 ≥128 kbps) | Default |
| **OFDM** (TypeScript) | 14.5-18 kHz, 4-band FSK | Faint high-frequency whine | Speaker → air → mic (1-5 m line-of-sight) | Production |
| **Masked DSSS** (TypeScript) | 2-6 kHz at masking threshold | Inaudible (validated A/B) | File only | Experimental |

Two encryption modes, fully implemented:

- **Password** — AES-256-GCM + scrypt KDF, passphrase shared out-of-band.
- **Wallet** — ECIES to an Ethereum address via a permissionless on-chain pubkey registry (`CarnationRegistry.sol`), or "Mode B" ephemeral key with a single-use claim link. Recipient decrypts with their wallet signature; no key exchange needed.

## How it works

1. **Encode**: Pick a song, type a hidden message, pick a passphrase or a recipient ETH address, pick a codec. The message is encrypted, framed (magic + length + CRC32 + Reed-Solomon), and embedded into the audio. Output is a normal-sounding WAV.
2. **Decode**: Upload the file (or listen with the microphone for OFDM), supply the passphrase or connect the recipient wallet, pick the matching codec. The steganography engine extracts and decrypts the hidden message.

The wire envelope (`MAGIC | length | CRC32 | RS-encoded payload`) is shared across all three codecs, so a payload encrypted to a wallet works identically regardless of which codec carried it.

## Architecture

```
carnation-stego/                Rust stego engine → WASM (~212KB)
  src/prng.rs                     MT19937 PRNG (numpy-compatible)
  src/dct.rs                      FFT-based DCT-II/IDCT-II (scipy-compatible)
  src/patchwork.rs                Bit embedding/extraction
  src/coding.rs                   17x interleaved repetition coding
  src/framing.rs                  Rust-side wire format
  src/lib.rs                      encode() / decode() pipeline
  src/wasm.rs                     WASM exports

frontend/                       Next.js 14 web app
  lib/
    stego.ts                      Rust WASM loader
    acoustic.ts                   Single-pair FSK (15.5/16.5 kHz, legacy)
    acoustic-ofdm.ts              4-band parallel FSK in 14.5-18 kHz
    acoustic-masked.ts            Psychoacoustic-masked DSSS in 2-6 kHz
    psychoacoustic/
      stft.ts                       STFT/iSTFT with sqrt-Hann at 50% OL
      bark.ts                       Zwicker 1980 Bark-scale mapping
      masking.ts                    Painter-Spanias PAM1 threshold model
      pn.ts                         M-sequence (Galois LFSR) PN codes
      chirp.ts                      Linear-FM chirp sync
      bandpass.ts                   2-6 kHz biquad bandpass (mic input)
    codec-framing.ts              Shared MAGIC + length + CRC + RS envelope
    reed-solomon.ts               RS(255,223) / RS(255,127) wrapper
    crypto.ts                     AES-256-GCM + scrypt
    wallet-crypto.ts              ECIES + secp256k1 signing
    encrypt-to-address.ts         Sender flow (Mode A ECDH + Mode B claim)
    registry.ts                   CarnationRegistry client (viem)
    microphone-listener.ts        Bounded ring buffer + decode driver
    transcode.ts                  ffmpeg.wasm wrapper
  app/page.tsx                  Encode/decode UI w/ 3-way codec selector

forge/                          Foundry workspace
  src/CarnationRegistry.sol       Permissionless secp256k1 pubkey registry
  test/CarnationRegistry.t.sol    Coverage: lookup, overwrite, events

steganography_cli/engine/       Python prototype (reference, read-only)
```

## Prerequisites

- **Node.js** 18.17+ (`node --version`)
- **Rust** stable + **wasm-pack** (`cargo install wasm-pack`)
- **Foundry** (`curl -L https://foundry.paradigm.xyz | bash`) — only for the registry contract
- **Python** 3.11+ (optional, only for running the prototype Python tests)
- **ffmpeg** (optional, only for Python MP3 survival tests)

## Quick start

```bash
git clone <repo-url> && cd carnation-radio

# Build WASM (pre-built copy is committed under frontend/public/wasm/)
cd carnation-stego
wasm-pack build --target web --features wasm --out-dir ../frontend/public/wasm
cd ..

# Run frontend
cd frontend
cp .env.example .env.local  # add Alchemy API keys for wallet mode (optional)
npm install
npm run dev
```

Open http://localhost:3000 — Encode tab to hide a message, Decode tab to extract.

## Running tests

```bash
# Rust engine — 35 tests (DCT, PRNG, patchwork pipeline, MP3 survival)
cd carnation-stego && cargo test

# Smart contracts — 10 tests
cd forge && forge test --summary

# Frontend — 108 tests (crypto, codecs, integration, wallet flow)
cd frontend && npx vitest run

# Python prototype tests (optional)
cd steganography_cli/engine
python -m pytest test_patchwork.py -v
python -m pytest test_mp3.py -v  # requires ffmpeg
```

## Static build

```bash
cd frontend
npm run build    # → frontend/out/
```

The app uses cross-origin isolation for SharedArrayBuffer (ffmpeg.wasm).
COOP/COEP headers need to be configured at the hosting level (e.g.
`vercel.json`, Netlify `_headers`).

## Encryption modes

### Password
`scrypt(passphrase)` → AES-256-GCM key. Embed key (which frequency bins are
used) derived separately via `SHA-256("carnation-embed:" + passphrase)`. The
two-key separation means a wrong passphrase can't even detect that a
message exists at the embedding location.

### Wallet (Mode A — ECDH via registry)
Recipient first registers their compressed secp256k1 pubkey on
`CarnationRegistry.sol` (deployed to Sepolia at
`0x80634dE8ddb230dA28241f0656f4c127A4c7566F`, 2026-03-27). Sender looks up
the pubkey by ETH address and encrypts via ECIES. Recipient connects their
wallet, signs `CARNATION_DERIVE_MESSAGE`, derives the private key, and
decrypts.

### Wallet (Mode B — claim link)
For unregistered recipients: sender generates an ephemeral AES key, encrypts
the payload, and shares a URL containing the key in the fragment (never
sent to a server). Recipient opens the link, the page decrypts in-browser,
and optionally registers their pubkey on-chain afterward for future Mode A
messages.

## Codec selection guide

- **Sharing a file?** → Patchwork. Default. MP3-safe down to 128 kbps. Largest payload capacity.
- **Live broadcast at a venue?** → OFDM. Add the carrier to your music; anyone in the room with the page open can decode through their mic. Adds an audible high-frequency whine on quiet passages.
- **Inaudible file watermark?** → Masked DSSS. Carrier lives at the music's own masking threshold so the encoding is perceptually transparent. Slower bitrate; file channel only.

## Key derivation

```
passphrase → embed_key = SHA-256("carnation-embed:" + passphrase)
           → AES key   = scrypt(passphrase)
wallet     → embed_key = SHA-256("carnation-embed:" + recipient_address)
           → AES key   = ECIES(sender_priv, recipient_pub) for Mode A
                       = random ephemeral key for Mode B
```

## Academic foundation

Clean-room implementation. No GPL-licensed audio steganography references
were consulted at any point.

- **Patchwork engine**: Yeo & Kim 2003, Natgunanathan et al. 2012
- **OFDM sync + framing**: standard radio-comms practice (Proakis, *Digital Communications*)
- **Masked DSSS codec**: Painter & Spanias 2000 (psychoacoustic model), Cox et al. 1997 (spread-spectrum watermarking), Garcia 1999 (DSSS for audio), Zwicker 1980 (Bark scale)
- **Reed-Solomon**: ZXing port via npm `reedsolomon`

## License

TBD

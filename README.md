# Carnation Radio

Decentralized encrypted communication hidden in music via audio steganography. Messages are encrypted, embedded in audio frequency coefficients, and survive MP3 compression. Only someone with the right passphrase can extract and decrypt the hidden message.

## How It Works

1. **Encode**: Upload audio + type a secret message + set a passphrase. The message is AES-256-GCM encrypted, then embedded into DCT frequency coefficients using a modified patchwork algorithm. Output is a normal-sounding MP3.
2. **Decode**: Upload the encoded audio + enter the passphrase. The steganography engine extracts the hidden bits and decrypts the message.

The embedding uses 17x interleaved repetition coding for error correction, allowing messages to survive lossy MP3 compression.

## Architecture

```
steganography_cli/engine/   Python prototype (reference implementation, read-only)
carnation-stego/            Rust stego engine → compiled to WASM (~212KB)
  src/prng.rs                 MT19937 PRNG (numpy-compatible)
  src/dct.rs                  FFT-based DCT-II/IDCT-II (scipy-compatible)
  src/patchwork.rs            Bit embedding/extraction
  src/coding.rs               17x interleaved repetition coding
  src/framing.rs              Wire format (sync + length + version + payload)
  src/lib.rs                  encode() / decode() pipeline
  src/wasm.rs                 WASM exports
frontend/                   Next.js 14 web app
  lib/crypto.ts               AES-256-GCM + scrypt encryption
  lib/stego.ts                WASM module loader
  lib/transcode.ts            ffmpeg.wasm audio transcoding
  app/page.tsx                Encode/decode UI
```

## Prerequisites

- **Node.js** 18.17+ (`node --version`)
- **Rust** stable (`rustc --version`)
- **wasm-pack** (`cargo install wasm-pack`)
- **Python** 3.11+ (optional, only for running prototype tests)
- **ffmpeg** (optional, only for Python MP3 survival tests)

## Quick Start

```bash
# Clone
git clone <repo-url> && cd carnation-radio

# Build WASM (only needed if you modify Rust code — pre-built WASM is committed)
cd carnation-stego
wasm-pack build --target web --features wasm
cp -r pkg/* ../frontend/public/wasm/
cd ..

# Start frontend
cd frontend
cp .env.example .env.local  # Edit with your Alchemy API keys (optional for basic use)
npm install
npm run dev
```

Open http://localhost:3000 — use the Encode tab to hide a message, Decode tab to extract it.

## Running Tests

```bash
# Rust tests (21 tests: unit + integration + cross-compat)
cd carnation-stego && cargo test

# Frontend tests (7 tests: crypto + wire format + E2E)
cd frontend && npx vitest run

# Python prototype tests (optional)
cd steganography_cli/engine
python -m pytest test_patchwork.py -v
python -m pytest test_mp3.py -v  # requires ffmpeg
```

## Static Build

```bash
cd frontend
npm run build    # Outputs to frontend/out/
```

Note: COOP/COEP headers for SharedArrayBuffer must be configured at the hosting level (e.g., Vercel `vercel.json`, Netlify `_headers`).

## Encryption Modes

- **Password mode** (implemented): AES-256-GCM with scrypt KDF. Passphrase shared out-of-band.
- **Wallet mode** (planned): ECIES encryption to an Ethereum address. No key exchange needed.

## Key Derivation

```
passphrase → embed_key = SHA-256("carnation-embed:" + passphrase)
           → AES key via scrypt(passphrase)
```

The embed key controls which frequency bins are used for embedding. The AES key encrypts the message payload. Different keys mean you can't even detect that a message exists.

## Academic Foundation

Clean-room implementation based on:
- Yeo & Kim, 2003 — Modified Patchwork Algorithm
- Natgunanathan et al., 2012 — Formal patchwork improvement

## License

TBD

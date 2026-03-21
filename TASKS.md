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

### Build & Docs — DONE
- [x] Update CLAUDE.md, PLAN.md, TASKS.md
- [x] Build WASM to frontend (`wasm-pack build --target web --features wasm`)
- [x] Build Next.js static export (`npm run build`)
- [x] Smoke test: verify static export produces working output

---

# Milestone: Phase 2 — Wallet-to-Wallet Encryption (Zero Recipient Setup)

## Design Overview

Two encryption modes replace the current wallet-crypto.ts ECDH scheme:

**Mode A — Direct (recipient registered on-chain)**
Sender looks up recipient's Carnation-derived pubkey from a registry contract.
Encrypts using ECDH. Recipient connects wallet, signs once, decrypts. Zero friction.
Works for any address that has opted into the registry.

**Mode B — Ephemeral/Claim (recipient fresh, never used Carnation)**
Sender generates a random AES-256-GCM key, encrypts the message, embeds it in audio
with a new version byte (VERSION.CLAIM). A claim link is generated containing the
decryption key in the URL fragment (never hits any server). Sender shares audio +
claim link with recipient out of band. Recipient opens link, message decrypts — no
wallet required for decryption. Optionally they can then register on-chain for future
direct messages.

**Recipient decode tab (no link)**
Connect wallet → sign canonical message → derived keypair → scan for Mode A messages
addressed to their derived pubkey. If none found, prompt: "Have a claim link? Paste it here."
No trace, no on-chain action, purely local.

**Default: no on-chain trace. On-chain registration is opt-in.**

---

## Wire Format Changes

Add two new version bytes to `lib/wire.ts`:

```
VERSION.WALLET_ECDH    = 0x02   // existing — both parties use derived keypairs
VERSION.CLAIM          = 0x03   // new — ephemeral AES key, decrypted via claim link
```

Payload layout for VERSION.CLAIM:
```
[version: 1 byte = 0x03]
[recipientAddress: 20 bytes]   // who this was sent to (informational, not enforced)
[nonce: 12 bytes]              // AES-GCM nonce
[ciphertext + tag]             // AES-256-GCM encrypted message
```

Claim link format (URL fragment, never sent to server):
```
https://carnation.radio/#claim&key=<base64url(32-byte AES key)>&for=<checksumAddress>
```

---

## Tasks

### 1. Registry Contract (`forge/`)
- [x] Write `CarnationRegistry.sol`
  - `mapping(address => bytes) public keys` — stores compressed secp256k1 pubkey (33 bytes)
  - `function register(bytes calldata compressedPubkey) external` — any address self-registers
  - `function lookup(address account) external view returns (bytes memory)` — returns empty bytes if not registered
  - No owner, no admin, no upgradability — immutable public utility
  - Emit `event Registered(address indexed account, bytes pubkey)`
- [x] Write Foundry tests for CarnationRegistry.sol
  - register + lookup round trip
  - overwrite (re-register with new key)
  - lookup unregistered address returns empty
- [ ] Deploy to Base (low gas, good UX) and Sepolia testnet
- [ ] Record deployed addresses in `frontend/lib/registry.ts`

### 2. Registry Client (`frontend/lib/registry.ts`)
- [x] `lookupRegistry(address: string): Promise<string | null>`
  - Uses viem publicClient to call `lookup(address)` on CarnationRegistry
  - Returns compressed pubkey hex (66 chars) or null if not registered
  - Tries Base mainnet first, falls back to Sepolia for testing
- [x] `registerSelf(walletClient: WalletClient, derivedPubkeyHex: string): Promise<Hash>`
  - Calls `register(compressedPubkey)` — sends an on-chain tx
  - Recipient pays gas (minimal, ~30k gas)

### 3. Transaction Public Key Recovery (`frontend/lib/tx-pubkey.ts`)
- [x] `recoverPubkeyFromHistory(address: string): Promise<string | null>`
  - Queries Alchemy/Infura (via viem) for the most recent outgoing tx from address
  - Uses `viem.recoverPublicKey({ hash: txHash, signature: { r, s, v } })` to get full 65-byte pubkey
  - Compresses to 33-byte form
  - Returns null if address has no tx history (brand new address)
  - Cache result in memory for the session (don't re-query)
- [x] This is used ONLY for identity display (ENS name, avatar, address confirmation)
  and for informing the sender "this address exists on-chain"
  NOT used for encryption (encryption uses registry derived pubkey or ephemeral key)

### 4. Sender Flow Rewrite (`frontend/lib/encrypt-to-address.ts`)
- [x] `encryptToAddress(recipientAddress: string, message: Uint8Array, senderPrivHex: string): Promise<{ payload: Uint8Array, claimLink: string | null }>`

  Logic:
  ```
  1. Look up registry: derivedPubkey = await lookupRegistry(recipientAddress)
  2. If derivedPubkey found (Mode A):
       - ECDH(senderPrivHex, derivedPubkey) → shared secret → AES-256-GCM encrypt
       - Embed with VERSION.WALLET_ECDH
       - Return { payload, claimLink: null }
  3. If not found (Mode B):
       - Generate random 32-byte AES key K
       - AES-256-GCM encrypt message with K
       - Embed with VERSION.CLAIM + recipientAddress prefix
       - claimLink = `https://carnation.radio/#claim&key=${base64url(K)}&for=${checksumAddress(recipientAddress)}`
       - Return { payload, claimLink }
  ```

### 5. Claim Link Generation + Display (`frontend/`)
- [x] After encode completes in Mode B, show a "Claim Link" panel:
  - Copy-to-clipboard button for the link
  - Warning: "Share this link with your recipient alongside the audio file. Anyone with this link can decrypt the message."
  - QR code of the claim link (optional but nice, use `qrcode` npm package)
- [x] If recipient address was entered as ENS, resolve to checksummed address before embedding

### 6. Recipient Decode Flow — Mode A (registered)
- [x] In decode tab, wallet mode:
  - Connect wallet → `signMessageAsync(WALLET_SIGN_MESSAGE)` → derive keypair (existing)
  - Extract sender pubkey from payload (existing 33-byte header)
  - ECDH(recipientDerivedPriv, senderPub) → decrypt (existing)
  - No changes needed to crypto, only to UX framing

### 7. Recipient Decode Flow — Mode B (claim link)
- [x] On page load, check URL fragment for `#claim&key=...&for=...`
  - If present: extract key, store in component state, show "You have a pending message" banner
  - Pre-populate decode tab with the claim key
- [x] Add "Have a claim link?" paste input in decode tab
  - User can paste the full URL, frontend extracts key from fragment
- [x] Decrypt logic for VERSION.CLAIM:
  - Extract AES key from claim link fragment
  - Strip 20-byte recipient address prefix from payload
  - AES-256-GCM decrypt with extracted key
  - No wallet required

### 8. Optional On-Chain Registration UI
- [x] After successful Mode B decrypt, show optional prompt:
  - "Register your address for direct future messages (no claim link needed)"
  - "This sends one transaction and permanently links your address to Carnation."
  - [Register on Base — ~$0.01 gas] [Skip, keep no trace]
  - Default: dismissed/skipped
- [x] After successful Mode A decrypt (wallet connected):
  - Check if they're registered. If not, show same optional prompt
  - If already registered: no prompt

### 9. Encode Tab UX — Recipient Input
- [x] Replace current "Paste recipient's public key (02... or 03...)" input with:
  - Address/ENS input field (already partially built in WalletRecipient component)
  - On input: resolve ENS → address → check registry
  - Show status badge:
    - "✓ Registered — direct message" (Mode A)
    - "⚠ Not registered — claim link will be generated" (Mode B)
    - "Address not found on-chain" (warn sender, still allow Mode B)
  - Remove the manual pubkey paste field entirely (not needed anymore)

### 10. Update `lib/wire.ts`
- [x] Add VERSION.CLAIM = 0x03
- [x] Update `detectVersion()` to handle new byte
- [x] Add `parseClaimPayload(data: Uint8Array): { recipientAddress: string, nonce: Uint8Array, ciphertext: Uint8Array }`

### 11. Update `lib/wallet-crypto.ts`
- [x] Rename WALLET_SIGN_MESSAGE to something clearer — `CARNATION_DERIVE_MESSAGE`
- [x] Add JSDoc clarifying: this message is signed to derive the Carnation keypair.
  It is deterministic (RFC 6979) — same wallet always produces the same signature → same keypair.
  The signature never leaves the device. No transaction is created.
- [x] No logic changes needed — the derive/encrypt/decrypt functions stay the same

### 12. Tests
- [x] `lib/__tests__/encrypt-to-address.test.ts`
  - Mock registry returning a pubkey → verify Mode A payload + null claimLink
  - Mock registry returning null → verify Mode B payload + valid claim link
  - Verify claim link key decrypts Mode B payload correctly
  - Verify VERSION bytes are correct in each mode
- [x] `lib/__tests__/registry.test.ts`
  - Mock viem publicClient, verify lookup/register calls
- [x] `lib/__tests__/claim-link.test.ts`
  - Parse claim link URL fragment → extract key and address
  - Round trip: generate claim link → parse → decrypt

### 13. CLAUDE.md + PLAN.md Update
- [x] Update CLAUDE.md with new lib files, new version bytes, registry address
- [ ] Update PLAN.md Phase 2 section to reflect implemented design

---

## What Was Removed / Replaced

The current flow requiring recipient to manually share their Carnation public key
(66-char hex) out of band is fully replaced. The `WalletRecipient` component's
"Paste recipient's public key" input is removed. The sender only needs an address or ENS name.

The `ecies.ts` `encryptToPublicKey` / `decryptWithPrivateKey` functions (using the
`eciesjs` library) are no longer used for the wallet-to-wallet flow. They can be kept
for potential future use or removed at cleanup time.

---

## Notes for Agent

- Registry contract must be minimal and immutable. No proxy, no owner, no pause. It is a public good.
- Deploy to Base for mainnet (low gas, widely used). Sepolia for testnet.
- The claim link key lives ONLY in the URL fragment (#). It is never sent to any server.
  Test this explicitly — `window.location.hash` not `window.location.search`.
- VERSION.CLAIM payloads are NOT encrypted to any public key. Anyone with the AES key can decrypt.
  This is intentional and must be documented clearly in the UI.
- Do not modify the Python prototype or Rust stego engine. Crypto changes are TypeScript-only.
- Run `npm run build` after changes to verify static export still works.
- Run `npx vitest run` for all tests before committing.

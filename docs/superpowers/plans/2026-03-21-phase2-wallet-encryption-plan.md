# Phase 2 Implementation Plan — Wallet-to-Wallet Encryption

**Goal:** Wallet-to-wallet encrypted messaging with zero recipient setup. The sender needs only the recipient's Ethereum address or ENS name. The recipient needs only their wallet.

**Architecture:** Two encryption modes selected automatically based on recipient state.

- **Mode A — Direct ECDH (on-chain registry):** Recipient has previously registered their compressed secp256k1 public key in `CarnationRegistry.sol`. Sender fetches the pubkey, runs ECDH, encrypts with AES-256-GCM. Recipient decrypts by re-deriving the shared secret from their wallet signature.
- **Mode B — Ephemeral AES + claim link:** Recipient has no registry entry but has on-chain transaction history (recoverable pubkey). Sender generates an ephemeral AES key, encrypts the payload, encrypts the AES key to the recovered pubkey, and produces a shareable claim link. Recipient opens the link, signs to decrypt the AES key, decrypts the payload.

**Mode selection logic:**
```
encryptToAddress(address) →
  1. lookupRegistry(address) → pubkey?  → Mode A (ECDH, wire byte 0x02)
  2. hasOnChainHistory(address) → tx?   → Mode B (ephemeral AES + claim link, wire byte 0x03)
  3. Neither                            → error: recipient unreachable
```

**Wire format version bytes:**
- `0x01` — password / scrypt (Phase 1)
- `0x02` — wallet ECDH, registry pubkey (Phase 2 Mode A)
- `0x03` — wallet claim mode, ephemeral AES (Phase 2 Mode B)

**Spec:** `docs/superpowers/specs/2026-03-13-phase1-mvp-design.md` (wallet section) + this document.

**Removed in Phase 2:**
- Manual pubkey paste field (replaced by automatic registry + tx-history lookup)
- Direct `eciesjs` usage for the wallet encryption flow (replaced by `encrypt-to-address.ts` + native ECDH via `@noble/curves`)

---

## File Structure

### New: Smart contract (`contracts/`)

```
contracts/
├── src/
│   └── CarnationRegistry.sol         # Immutable, permissionless pubkey registry
├── test/
│   └── CarnationRegistry.t.sol       # 8 Foundry tests
└── foundry.toml
```

### New: Frontend crypto/registry layer (`frontend/lib/`)

```
frontend/lib/
├── registry.ts                       # lookupRegistry + registerSelf via viem
├── encrypt-to-address.ts             # encryptToAddress (Mode A/B) + parseClaimLink
├── tx-pubkey.ts                      # hasOnChainHistory — recover pubkey from tx history
└── wallet-crypto.ts                  # Wallet signing + ECDH; CARNATION_DERIVE_MESSAGE constant
```

### Modified: Existing frontend files

```
frontend/lib/wire.ts                  # Added VERSION.CLAIM (0x03), parseClaimPayload, isClaimMode
frontend/app/encode/page.tsx          # Address/ENS input, registry status badge, claim link panel
frontend/app/decode/page.tsx          # Claim link input field, URL fragment auto-detection
```

---

## Implementation Status

### Contracts

- [x] **CarnationRegistry.sol** — Immutable, permissionless pubkey registry. Stores one compressed secp256k1 pubkey (33 bytes) per address. Emits `PubkeyRegistered` on write. No owner, no upgrades.
  - 8 Foundry tests: register, overwrite, lookup missing, lookup registered, event emission, pubkey length validation, zero-address guard, re-registration idempotency.

### Frontend — Library

- [x] **lib/registry.ts** — `lookupRegistry(address): Promise<Hex | null>` reads from deployed contract via viem public client. `registerSelf(walletClient): Promise<Hash>` signs + submits registration tx with the wallet's derived pubkey.

- [x] **lib/encrypt-to-address.ts** — Top-level `encryptToAddress(address, plaintext): Promise<EncryptResult>` orchestrates mode selection. Returns `{ mode, payload, claimLink? }`. `parseClaimLink(url): ClaimLinkParams` decodes a claim link URL into its constituent parts.

- [x] **lib/wire.ts** — Added `VERSION.CLAIM = 0x03`. `parseClaimPayload(bytes)` splits the wire payload into `{ ephemeralEncryptedKey, iv, ciphertext }`. `isClaimMode(versionByte)` predicate.

- [x] **lib/wallet-crypto.ts** — Renamed derivation constant to `CARNATION_DERIVE_MESSAGE` (was `CARNATION_SIGN_MESSAGE`). Derives deterministic entropy from wallet signature for use as ECDH private key material.

- [x] **lib/tx-pubkey.ts** — `hasOnChainHistory(address): Promise<boolean>` queries a configured RPC for outbound transactions. Returns true if at least one outbound tx exists (from which the pubkey is recoverable). Used as Mode B eligibility gate.

### Frontend — Tests

- [x] **11 new Vitest tests** across three test files:
  - `encrypt-to-address.test.ts` — Mode A path, Mode B path, unreachable address error
  - `registry.test.ts` — lookup hit, lookup miss, register flow (mocked viem)
  - `claim-link.test.ts` — encode/decode round-trip, URL fragment detection, malformed input rejection

### Frontend — UI

- [x] **Encode tab** — Address/ENS input with ENS resolution. Registry status badge (`Registered ✓` / `Unregistered — claim link will be used`). Claim link panel shown when Mode B is selected, with copy-to-clipboard.
- [x] **Decode tab** — Claim link input field. URL fragment auto-detection on page load (`#claim=...` in the URL opens the claim flow automatically).

### Deployment

- [ ] **Deploy CarnationRegistry.sol to Base Sepolia** — `forge script` + verify on Basescan.
- [ ] **Deploy CarnationRegistry.sol to Base mainnet** — same, after Sepolia validation.
- [ ] **Record deployed addresses in registry.ts** — update `REGISTRY_ADDRESS` constants for both chains.
- [ ] **Update this document** — mark deployment steps complete, add deployed addresses.

---

## Deployed Addresses

| Network       | Address | Block |
|---------------|---------|-------|
| Base Sepolia  | —       | —     |
| Base mainnet  | —       | —     |

*(Populated after deployment)*

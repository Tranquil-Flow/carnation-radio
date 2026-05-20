import { describe, expect, it } from 'vitest'
import { acousticEncodePayload, acousticDecodePayload, mixCarrier } from '../acoustic'
import { walletEncrypt, walletDecrypt, getPublicKeyHex } from '../wallet-crypto'
import { detectVersion } from '../wire'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { secp256k1 } from '@noble/curves/secp256k1'

/**
 * Wallet-mode + acoustic codec integration tests. Proves the end-to-end wire-format
 * compatibility: a message encrypted to a recipient's wallet-derived pubkey can be
 * acoustically encoded, traversed through (simulated) air noise + music interference,
 * and decoded back to plaintext by the recipient using their wallet-derived privkey.
 *
 * The UI-level wallet flow (sign CARNATION_DERIVE_MESSAGE → derive priv → encrypt to
 * recipient address) is exercised separately by wallet-crypto.test.ts. This test fills
 * the gap between that and the existing acoustic codec tests by combining both paths.
 */

const VERSION_WALLET_REPETITION = 0x02

function deriveTestWallet(seed: string): { privHex: string; pubHex: string } {
  const seedBytes = new TextEncoder().encode(`carnation-test-wallet:${seed}`)
  const privBytes = new Uint8Array(32)
  // Hash the seed to get a deterministic 32-byte private key.
  // Use noble's secp256k1 internal hashToCurve — but simpler: just SHA-256 the seed.
  const { sha256 } = require('@noble/hashes/sha2.js')
  const hashed = sha256(seedBytes)
  privBytes.set(hashed)
  const privHex = bytesToHex(privBytes)
  const pubHex = getPublicKeyHex(privHex)
  return { privHex, pubHex }
}

describe('Wallet mode + acoustic codec integration', () => {
  it('round-trips a wallet-encrypted message through the acoustic codec', async () => {
    // Two distinct deterministic test wallets (no real chain involved).
    const sender = deriveTestWallet('sender-alice')
    const recipient = deriveTestWallet('recipient-bob')

    const plaintext = new TextEncoder().encode('hidden message for bob')

    // 1. Sender encrypts with ECDH to recipient's derived pubkey.
    const walletPayload = await walletEncrypt(
      sender.privHex,
      sender.pubHex,
      recipient.pubHex,
      plaintext,
    )

    // 2. Prepend VERSION.WALLET_REPETITION byte (mirrors page.tsx encode path).
    const versioned = new Uint8Array(1 + walletPayload.length)
    versioned[0] = VERSION_WALLET_REPETITION
    versioned.set(walletPayload, 1)

    // 3. Acoustic encode the wallet payload (this is what the speaker would play).
    const carrier = acousticEncodePayload(versioned)

    // 4. Acoustic decode (this is what the mic would deliver to the listener).
    const decodedVersioned = acousticDecodePayload(carrier)

    // 5. Strip version byte and walletDecrypt with recipient's privhex.
    const { version, data } = detectVersion(decodedVersioned)
    expect(version).toBe('wallet_repetition')
    const decryptedPlaintext = await walletDecrypt(recipient.privHex, data)

    expect(new TextDecoder().decode(decryptedPlaintext)).toBe('hidden message for bob')
  })

  it('survives mixing into a music-like carrier (full air-path simulation)', async () => {
    const sender = deriveTestWallet('sender-c')
    const recipient = deriveTestWallet('recipient-d')

    const plaintext = new TextEncoder().encode('encrypted via wallet through music')

    const walletPayload = await walletEncrypt(
      sender.privHex,
      sender.pubHex,
      recipient.pubHex,
      plaintext,
    )

    const versioned = new Uint8Array(1 + walletPayload.length)
    versioned[0] = VERSION_WALLET_REPETITION
    versioned.set(walletPayload, 1)

    const carrier = acousticEncodePayload(versioned)

    // Build a music-like signal (bass + mid + treble) and mix the carrier in.
    const sampleRate = 44100
    const music = new Float64Array(carrier.length)
    const freqs = [110, 220, 440, 880, 1760, 3520]
    for (let i = 0; i < music.length; i++) {
      let v = 0
      for (let j = 0; j < freqs.length; j++) {
        v += Math.sin(2 * Math.PI * freqs[j] * i / sampleRate + j * 0.7)
      }
      music[i] = (v / freqs.length) * 20000
    }
    const mixed = mixCarrier(music, carrier)

    const decodedVersioned = acousticDecodePayload(mixed)
    const { version, data } = detectVersion(decodedVersioned)
    expect(version).toBe('wallet_repetition')
    const decrypted = await walletDecrypt(recipient.privHex, data)
    expect(new TextDecoder().decode(decrypted)).toBe('encrypted via wallet through music')
  })

  it('decode fails with wrong recipient privhex (cryptographic integrity)', async () => {
    const sender = deriveTestWallet('sender-e')
    const recipient = deriveTestWallet('recipient-f')
    const attacker = deriveTestWallet('attacker-g')

    const plaintext = new TextEncoder().encode('secret')
    const walletPayload = await walletEncrypt(
      sender.privHex,
      sender.pubHex,
      recipient.pubHex,
      plaintext,
    )

    const versioned = new Uint8Array(1 + walletPayload.length)
    versioned[0] = VERSION_WALLET_REPETITION
    versioned.set(walletPayload, 1)

    const carrier = acousticEncodePayload(versioned)
    const decodedVersioned = acousticDecodePayload(carrier)
    const { data } = detectVersion(decodedVersioned)

    // Attacker with a different privkey cannot decrypt — AES-GCM auth tag rejects.
    await expect(walletDecrypt(attacker.privHex, data)).rejects.toThrow()
  })
})

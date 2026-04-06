import { describe, it, expect } from 'vitest'
import {
  walletEncrypt,
  walletDecrypt,
  CARNATION_DERIVE_MESSAGE,
  derivePrivateKeyHex,
  getPublicKeyHex,
} from '../wallet-crypto'

describe('wallet-crypto', () => {
  describe('CARNATION_DERIVE_MESSAGE', () => {
    it('is non-empty (regression guard)', () => {
      expect(CARNATION_DERIVE_MESSAGE.length).toBeGreaterThan(0)
    })

    it('matches exact value from wallet-crypto.ts (regression guard)', () => {
      // This exact string is used to derive encryption identities.
      // If it changes, existing wallets will derive different keypairs.
      const expected = `Carnation Radio: derive encryption identity

Sign this to generate your Carnation Radio public key.
This signature is used locally and never leaves your device.`
      expect(CARNATION_DERIVE_MESSAGE).toBe(expected)
    })
  })

  describe('derivePrivateKeyHex', () => {
    it('produces 64-char hex for any signature input', () => {
      const sig = '0xabcd1234' // arbitrary hex
      const result = derivePrivateKeyHex(sig)
      expect(result).toMatch(/^[0-9a-f]{64}$/)
    })

    it('produces consistent output for same input', () => {
      const sig = '0xfedcba0987654321'
      const result1 = derivePrivateKeyHex(sig)
      const result2 = derivePrivateKeyHex(sig)
      expect(result1).toBe(result2)
    })
  })

  describe('getPublicKeyHex', () => {
    it('returns 66-char hex starting with 02 or 03', () => {
      // Derive a valid private key first
      const priv = derivePrivateKeyHex('0x12345678')
      const pub = getPublicKeyHex(priv)
      // bytesToHex returns raw hex without 0x prefix — 66 chars for 33-byte compressed pubkey
      expect(pub).toMatch(/^[0-9a-f]{66}$/)
      // Compressed secp256k1 pubkeys always start with 02 or 03
      expect(pub.startsWith('02') || pub.startsWith('03')).toBe(true)
    })

    it('produces consistent output for same private key', () => {
      const priv = derivePrivateKeyHex('0xabcdef01')
      const pub1 = getPublicKeyHex(priv)
      const pub2 = getPublicKeyHex(priv)
      expect(pub1).toBe(pub2)
    })
  })

  describe('walletEncrypt + walletDecrypt round-trip', () => {
    it('same key pair recovers plaintext', async () => {
      // Derive sender keypair
      const senderPriv = derivePrivateKeyHex('0x1111111111111111111111111111111111111111')
      const senderPub = getPublicKeyHex(senderPriv)

      // Derive recipient keypair
      const recipientPriv = derivePrivateKeyHex('0x2222222222222222222222222222222222222222')
      const recipientPub = getPublicKeyHex(recipientPriv)

      const plaintext = new Uint8Array([0xde, 0xad, 0xbe, 0xef])

      const encrypted = await walletEncrypt(senderPriv, senderPub, recipientPub, plaintext)
      expect(encrypted.length).toBeGreaterThan(61) // 33 sender_pub + 12 nonce + tag

      const decrypted = await walletDecrypt(recipientPriv, encrypted)
      expect(decrypted).toEqual(plaintext)
    })

    it('encrypts to different ciphertext each time (random nonce)', async () => {
      const senderPriv = derivePrivateKeyHex('0x3333333333333333333333333333333333333333')
      const senderPub = getPublicKeyHex(senderPriv)
      const recipientPriv = derivePrivateKeyHex('0x4444444444444444444444444444444444444444')
      const recipientPub = getPublicKeyHex(recipientPriv)
      const plaintext = new Uint8Array([0xca, 0xfe])

      const enc1 = await walletEncrypt(senderPriv, senderPub, recipientPub, plaintext)
      const enc2 = await walletEncrypt(senderPriv, senderPub, recipientPub, plaintext)

      // Nonces are random, so ciphertext should differ
      expect(enc1).not.toEqual(enc2)
    })
  })

  describe('walletDecrypt error cases', () => {
    it('throws on wrong key (auth tag failure)', async () => {
      const senderPriv = derivePrivateKeyHex('0x5555555555555555555555555555555555555555')
      const senderPub = getPublicKeyHex(senderPriv)
      const recipientPriv = derivePrivateKeyHex('0x6666666666666666666666666666666666666666')
      const recipientPub = getPublicKeyHex(recipientPriv)

      // Encrypt with sender→recipient
      const plaintext = new Uint8Array([0x12, 0x34])
      const encrypted = await walletEncrypt(senderPriv, senderPub, recipientPub, plaintext)

      // Try to decrypt with a different private key (wrong key)
      const wrongPriv = derivePrivateKeyHex('0x7777777777777777777777777777777777777777')

      await expect(walletDecrypt(wrongPriv, encrypted)).rejects.toThrow()
    })

    it('throws on truncated payload (too short)', async () => {
      const truncated = new Uint8Array([0x01, 0x02, 0x03]) // only 3 bytes
      const priv = derivePrivateKeyHex('0x8888888888888888888888888888888888888888')

      await expect(walletDecrypt(priv, truncated)).rejects.toThrow(/too short/i)
    })

    it('throws on empty payload', async () => {
      const priv = derivePrivateKeyHex('0x9999999999999999999999999999999999999999')
      await expect(walletDecrypt(priv, new Uint8Array(0))).rejects.toThrow(/too short/i)
    })
  })
})
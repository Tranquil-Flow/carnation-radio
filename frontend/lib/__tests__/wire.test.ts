import { describe, it, expect } from 'vitest'
import { detectVersion, VERSION, parseClaimPayload } from '../wire'

describe('wire', () => {
  describe('detectVersion', () => {
    it('detects password repetition mode', () => {
      const payload = new Uint8Array([0x01, ...new Array(50).fill(0)])
      const result = detectVersion(payload)
      expect(result.version).toBe(VERSION.PASSWORD_REPETITION)
      expect(result.data.length).toBe(50)
    })

    it('detects legacy format', () => {
      const payload = new Uint8Array([0x42, ...new Array(50).fill(0)])
      const result = detectVersion(payload)
      expect(result.version).toBe(VERSION.LEGACY)
      expect(result.data.length).toBe(51)
    })

    it('detects 0x03 as VERSION.CLAIM', () => {
      const payload = new Uint8Array([0x03, ...new Array(50).fill(0)])
      const result = detectVersion(payload)
      expect(result.version).toBe(VERSION.CLAIM)
      expect(result.data.length).toBe(50)
    })

    it('detects 0x02 as VERSION.WALLET_REPETITION', () => {
      const payload = new Uint8Array([0x02, ...new Array(50).fill(0)])
      const result = detectVersion(payload)
      expect(result.version).toBe(VERSION.WALLET_REPETITION)
      expect(result.data.length).toBe(50)
    })

    it('throws on empty payload', () => {
      expect(() => detectVersion(new Uint8Array(0))).toThrow('Empty payload')
    })

    it('detects 0x11 as VERSION.PASSWORD_BCH', () => {
      const payload = new Uint8Array([0x11, ...new Array(50).fill(0)])
      const result = detectVersion(payload)
      expect(result.version).toBe(VERSION.PASSWORD_BCH)
      expect(result.data.length).toBe(50)
    })

    it('detects 0x12 as VERSION.WALLET_BCH', () => {
      const payload = new Uint8Array([0x12, ...new Array(50).fill(0)])
      const result = detectVersion(payload)
      expect(result.version).toBe(VERSION.WALLET_BCH)
      expect(result.data.length).toBe(50)
    })
  })

  describe('parseClaimPayload', () => {
    it('parses valid CLAIM payload correctly', () => {
      // Build a valid CLAIM payload:
      // [recipientAddress: 20 bytes] [nonce: 12 bytes] [ciphertext + tag: 32+ bytes]
      // Use a known address: 0x742d35Cc6634C0532925a3b844Bc9e7595f1234
      const addressBytes = Uint8Array.from([
        0x74, 0x2d, 0x35, 0xcc, 0x66, 0x34, 0xc0, 0x53,
        0x29, 0x25, 0xa3, 0xb8, 0x44, 0xbc, 0x9e, 0x75,
        0x95, 0xf1, 0x23, 0x41,
      ])
      const nonce = new Uint8Array(12) // all zeros is fine for test
      const ciphertext = new Uint8Array(32) // dummy ciphertext

      const data = new Uint8Array([...addressBytes, ...nonce, ...ciphertext])
      const result = parseClaimPayload(data)

      // recipientAddress should be checksummed EIP-55 (viem getAddress produces checksum)
      expect(result.recipientAddress).toMatch(/^0x[0-9a-fA-F]{40}$/)
      // Verify checksum format — at least some upper and lower case chars (not all same case)
      const hex = result.recipientAddress.slice(2)
      const hasUpper = /[A-F]/.test(hex)
      const hasLower = /[a-f]/.test(hex)
      expect(hasUpper && hasLower).toBe(true)

      // nonce should be exactly 12 bytes
      expect(result.nonce.length).toBe(12)
      expect(result.nonce).toEqual(nonce)

      // ciphertext should be remaining bytes
      expect(result.ciphertext.length).toBe(32)
    })

    it('throws when payload too short (< 48 bytes)', () => {
      const shortPayload = new Uint8Array([...new Array(47).fill(0)])
      expect(() => parseClaimPayload(shortPayload)).toThrow(/too short/i)
    })

    it('throws when payload is exactly 48 bytes (minimum size)', () => {
      // MIN_SIZE = 20 + 12 + 16 = 48 — this should NOT throw
      const minPayload = new Uint8Array([...new Array(48).fill(0)])
      // Should not throw
      const result = parseClaimPayload(minPayload)
      expect(result.ciphertext.length).toBe(16) // 48 - 20 - 12 = 16 (just the tag)
    })

    it('throws when payload is 47 bytes (one byte short)', () => {
      const shortPayload = new Uint8Array([...new Array(47).fill(0)])
      expect(() => parseClaimPayload(shortPayload)).toThrow(/too short/i)
    })
  })
})
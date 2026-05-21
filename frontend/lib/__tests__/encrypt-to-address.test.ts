import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the registry module BEFORE importing encrypt-to-address
vi.mock('../registry', () => ({
  lookupRegistry: vi.fn(),
}))

import { encryptToAddress, parseClaimLink } from '../encrypt-to-address'
import { lookupRegistry } from '../registry'
import { detectVersion, VERSION } from '../wire'

const mockedLookup = vi.mocked(lookupRegistry)

describe('encryptToAddress', () => {
  // Use a deterministic test keypair (secp256k1)
  // These are NOT real keys, just valid format for testing
  const senderPrivHex = 'a'.repeat(64)  // 32 bytes of 0xaa
  const senderPubHex = '02' + 'b'.repeat(64)  // fake compressed pubkey

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('Mode A: registry returns pubkey → WALLET_REPETITION version, no claim link', async () => {
    // Use a real valid secp256k1 compressed public key (the generator point G, pubkey for privkey=1)
    const recipientPub = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
    mockedLookup.mockResolvedValue(recipientPub)

    const msg = new TextEncoder().encode('hello direct')
    const result = await encryptToAddress(
      '0x1234567890123456789012345678901234567890',
      msg, senderPrivHex, senderPubHex,
    )

    expect(result.claimLink).toBeNull()
    expect(result.payload[0]).toBe(0x02) // VERSION byte for wallet/ECDH

    const { version } = detectVersion(result.payload)
    expect(version).toBe(VERSION.WALLET_REPETITION)
  })

  it('Mode B: registry returns null → CLAIM version + valid claim link', async () => {
    mockedLookup.mockResolvedValue(null)

    const msg = new TextEncoder().encode('hello claim')
    const result = await encryptToAddress(
      '0x1234567890123456789012345678901234567890',
      msg, senderPrivHex, senderPubHex,
    )

    expect(result.claimLink).not.toBeNull()
    expect(result.claimLink!).toContain('#claim')
    expect(result.claimLink!).toContain('key=')
    expect(result.claimLink!).toContain('for=')
    expect(result.payload[0]).toBe(0x03) // VERSION.CLAIM

    const { version } = detectVersion(result.payload)
    expect(version).toBe(VERSION.CLAIM)
  })

  it('Mode B: claim link key decrypts the payload correctly', async () => {
    mockedLookup.mockResolvedValue(null)

    const plaintext = 'secret message for claim'
    const msg = new TextEncoder().encode(plaintext)
    const result = await encryptToAddress(
      '0x1234567890123456789012345678901234567890',
      msg, senderPrivHex, senderPubHex,
    )

    // Parse the claim link
    const parsed = parseClaimLink(result.claimLink!)
    expect(parsed).not.toBeNull()
    expect(parsed!.key.length).toBe(32)

    // Extract nonce and ciphertext from payload
    // Payload: [0x03] [recipientAddr: 20] [nonce: 12] [ciphertext+tag]
    const nonce = result.payload.slice(1 + 20, 1 + 20 + 12)
    const ciphertextAndTag = result.payload.slice(1 + 20 + 12)

    // Decrypt with the claim key
    const cryptoKey = await crypto.subtle.importKey(
      'raw', parsed!.key, 'AES-GCM', false, ['decrypt']
    )
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce, tagLength: 128 },
      cryptoKey, ciphertextAndTag,
    )
    expect(new TextDecoder().decode(decrypted)).toBe(plaintext)
  })
})

describe('parseClaimLink', () => {
  it('parses a valid claim link', () => {
    // Create a known 32-byte key
    const key = new Uint8Array(32)
    for (let i = 0; i < 32; i++) key[i] = i
    
    // base64url encode it
    let binary = ''
    for (let i = 0; i < key.length; i++) binary += String.fromCharCode(key[i])
    const b64 = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    
    const addr = '0x1234567890123456789012345678901234567890'
    const link = `https://carnation.radio/#claim&key=${b64}&for=${addr}`
    
    const result = parseClaimLink(link)
    expect(result).not.toBeNull()
    expect(result!.key).toEqual(key)
  })

  it('returns null for invalid link', () => {
    expect(parseClaimLink('https://example.com')).toBeNull()
    expect(parseClaimLink('not a url')).toBeNull()
  })
})

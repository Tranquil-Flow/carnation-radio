import { describe, it, expect } from 'vitest'
import { parseClaimLink } from '../encrypt-to-address'

describe('claim link parsing', () => {
  function makeClaimLink(key: Uint8Array, addr: string): string {
    let binary = ''
    for (let i = 0; i < key.length; i++) binary += String.fromCharCode(key[i])
    const b64 = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    return `https://carnation.radio/#claim&key=${b64}&for=${addr}`
  }

  it('round trip: generate → parse → same key and address', () => {
    const key = new Uint8Array(32)
    crypto.getRandomValues(key)
    const addr = '0xdead000000000000000000000000000000000001'
    
    const link = makeClaimLink(key, addr)
    const parsed = parseClaimLink(link)
    
    expect(parsed).not.toBeNull()
    expect(parsed!.key).toEqual(key)
    // Address should be checksummed
    expect(parsed!.forAddress).toMatch(/^0x[0-9a-fA-F]{40}$/)
  })

  it('handles fragment-only input', () => {
    const key = new Uint8Array(32).fill(0x42)
    const addr = '0x1234567890123456789012345678901234567890'
    
    // Just the fragment part
    let binary = ''
    for (let i = 0; i < key.length; i++) binary += String.fromCharCode(key[i])
    const b64 = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const fragment = `claim&key=${b64}&for=${addr}`
    
    const parsed = parseClaimLink(fragment)
    expect(parsed).not.toBeNull()
    expect(parsed!.key).toEqual(key)
  })

  it('returns null for missing key', () => {
    const result = parseClaimLink('https://carnation.radio/#claim&for=0x1234567890123456789012345678901234567890')
    expect(result).toBeNull()
  })

  it('returns null for missing address', () => {
    const result = parseClaimLink('https://carnation.radio/#claim&key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
    expect(result).toBeNull()
  })

  it('returns null for wrong key length', () => {
    // 16 bytes instead of 32
    const shortKey = new Uint8Array(16).fill(0x42)
    let binary = ''
    for (let i = 0; i < shortKey.length; i++) binary += String.fromCharCode(shortKey[i])
    const b64 = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const result = parseClaimLink(`https://carnation.radio/#claim&key=${b64}&for=0x1234567890123456789012345678901234567890`)
    expect(result).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { rsEncodeShortened, rsDecodeShortened, RS_PARITY_BYTES } from '../reed-solomon'

describe('Reed-Solomon RS(255, 223) shortened', () => {
  it('encode then decode round-trips a small payload with no errors', () => {
    const data = new TextEncoder().encode('hello world')
    const encoded = rsEncodeShortened(data)
    expect(encoded.length).toBe(data.length + RS_PARITY_BYTES)
    // First N bytes are the original data
    expect(Array.from(encoded.subarray(0, data.length))).toEqual(Array.from(data))
    const decoded = rsDecodeShortened(encoded)
    expect(Array.from(decoded)).toEqual(Array.from(data))
  })

  it('round-trips a larger payload (100 bytes) with no errors', () => {
    const data = new Uint8Array(100)
    for (let i = 0; i < data.length; i++) data[i] = (i * 37) & 0xff
    const encoded = rsEncodeShortened(data)
    const decoded = rsDecodeShortened(encoded)
    expect(Array.from(decoded)).toEqual(Array.from(data))
  })

  it('corrects up to 16 byte errors anywhere in the codeword', () => {
    const data = new TextEncoder().encode('this payload survives 16 byte errors')
    const encoded = rsEncodeShortened(data)
    // Flip 16 bytes at scattered positions (mix of data and parity bytes).
    const corrupted = new Uint8Array(encoded)
    const positions = [0, 3, 7, 11, 15, 19, 22, 25, 28, 31, 33, 36, 39, 42, 45, 48]
    for (const p of positions) {
      corrupted[p] = (corrupted[p] ^ 0xa5) & 0xff
    }
    const decoded = rsDecodeShortened(corrupted)
    expect(Array.from(decoded)).toEqual(Array.from(data))
  })

  it('throws when error count exceeds correction capacity (17 errors)', () => {
    const data = new TextEncoder().encode('this payload has too many errors and should fail')
    const encoded = rsEncodeShortened(data)
    const corrupted = new Uint8Array(encoded)
    for (let i = 0; i < 17; i++) corrupted[i * 3] ^= 0xa5
    expect(() => rsDecodeShortened(corrupted)).toThrow()
  })

  it('handles a payload that uses the full block (k=223 bytes)', () => {
    const data = new Uint8Array(223)
    for (let i = 0; i < data.length; i++) data[i] = (i * 13 + 7) & 0xff
    const encoded = rsEncodeShortened(data)
    expect(encoded.length).toBe(223 + RS_PARITY_BYTES)
    // Inject 10 byte errors
    const corrupted = new Uint8Array(encoded)
    for (let i = 0; i < 10; i++) corrupted[i * 20] ^= 0xff
    const decoded = rsDecodeShortened(corrupted)
    expect(Array.from(decoded)).toEqual(Array.from(data))
  })

  it('rejects payloads larger than k', () => {
    const data = new Uint8Array(224)
    expect(() => rsEncodeShortened(data)).toThrow()
  })
})

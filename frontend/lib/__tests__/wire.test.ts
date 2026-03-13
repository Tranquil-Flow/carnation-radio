import { describe, it, expect } from 'vitest'
import { detectVersion, VERSION } from '../wire'

describe('wire', () => {
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
})

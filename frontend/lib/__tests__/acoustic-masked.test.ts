import { describe, it, expect } from 'vitest'
import {
  maskedEncodePayload,
  maskedDecodePayload,
  MASKED_SAMPLE_RATE,
} from '../acoustic-masked'
import { makeMSequence, makeCodebook } from '../psychoacoustic/pn'

function makeMusicLikeSignal(durationSec: number, sampleRate = MASKED_SAMPLE_RATE): Float64Array {
  // Mixture of low/mid sinusoids — provides masking energy across the spectrum
  // so the codec has a non-trivial threshold to embed under.
  const n = Math.floor(durationSec * sampleRate)
  const out = new Float64Array(n)
  const freqs = [110, 220, 440, 880, 1760, 3520]
  for (let i = 0; i < n; i++) {
    let v = 0
    for (let j = 0; j < freqs.length; j++) {
      v += Math.sin((2 * Math.PI * freqs[j] * i) / sampleRate + j * 0.7)
    }
    out[i] = (v / freqs.length) * 4000 // moderate amplitude, well below int16 peak
  }
  return out
}

function addAwgnNoise(samples: Float64Array, amp: number, seedInit = 7777): Float64Array {
  let seed = seedInit
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
  const out = new Float64Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const u1 = Math.max(1e-12, random())
    const u2 = random()
    const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    out[i] = samples[i] + gauss * amp
  }
  return out
}

describe('PN sequence generator', () => {
  it('M-sequence of order 11 has period 2^11 - 1 = 2047', () => {
    const seq = makeMSequence(11, 1, 2047)
    expect(seq.length).toBe(2047)
    // All values are ±1
    for (const v of seq) expect(Math.abs(v)).toBe(1)
  })

  it('M-sequence autocorrelation has a sharp peak at zero shift', () => {
    const len = 1023
    const seq = makeMSequence(10, 1, len)
    let auto0 = 0
    for (let i = 0; i < len; i++) auto0 += seq[i] * seq[i]
    expect(auto0).toBe(len)
    // Shift by 1 — m-sequence off-peak autocorrelation is -1 by construction
    let auto1 = 0
    for (let i = 0; i < len - 1; i++) auto1 += seq[i] * seq[i + 1]
    // Actual value is ≈ -1 ± small edge-of-sequence noise
    expect(Math.abs(auto1)).toBeLessThan(len * 0.1)
  })

  it('codebook produces N distinct subcarrier codes', () => {
    const codes = makeCodebook(4, 32)
    expect(codes.length).toBe(4)
    for (const c of codes) expect(c.length).toBe(32)
    // No two codes should be identical
    for (let i = 0; i < 4; i++) {
      for (let j = i + 1; j < 4; j++) {
        let same = 0
        for (let k = 0; k < 32; k++) if (codes[i][k] === codes[j][k]) same++
        expect(same).toBeLessThan(32)
      }
    }
  })
})

describe('Masked DSSS codec — clean round-trip', () => {
  it('round-trips a 4-byte payload through music with no impairment', () => {
    const payload = new TextEncoder().encode('test')
    // 4-byte payload + 32 RS = 36 bytes RS-encoded; +10 envelope = 46 bytes
    // packet = 368 bits. With 4 subcarriers, 92 symbol times. With spreadFactor=4
    // (test-only fast setting), 368 frames, ~4.3s of music needed.
    const music = makeMusicLikeSignal(8)
    const encoded = maskedEncodePayload(payload, music, { spreadFactor: 4 })
    const decoded = maskedDecodePayload(encoded, { spreadFactor: 4 })
    expect(decoded).toEqual(payload)
  })

  it('round-trips with moderate spread factor', () => {
    const payload = new TextEncoder().encode('hi')
    const music = makeMusicLikeSignal(15)
    const encoded = maskedEncodePayload(payload, music, { spreadFactor: 8 })
    const decoded = maskedDecodePayload(encoded, { spreadFactor: 8 })
    expect(decoded).toEqual(payload)
  })

  it('preserves music length (encoded.length === music.length)', () => {
    const payload = new TextEncoder().encode('x')
    const music = makeMusicLikeSignal(8)
    const encoded = maskedEncodePayload(payload, music, { spreadFactor: 4 })
    expect(encoded.length).toBe(music.length)
  })

  it('encoded music is perceptually close to original (RMS difference small)', () => {
    const payload = new TextEncoder().encode('ok')
    const music = makeMusicLikeSignal(10)
    const encoded = maskedEncodePayload(payload, music, { spreadFactor: 8, alpha: 1.0 })
    // Mean-square diff should be a tiny fraction of music's mean-square level
    let musicMs = 0, diffMs = 0
    for (let i = 0; i < music.length; i++) {
      musicMs += music[i] * music[i]
      const d = encoded[i] - music[i]
      diffMs += d * d
    }
    musicMs /= music.length
    diffMs /= music.length
    // Embedded signal at masking threshold should be at least 20 dB below music
    expect(diffMs / musicMs).toBeLessThan(0.01)
  })
})

describe('Masked DSSS codec — robustness', () => {
  it('survives moderate AWGN at the recorder', () => {
    const payload = new TextEncoder().encode('hi')
    const music = makeMusicLikeSignal(22)
    const encoded = maskedEncodePayload(payload, music, { spreadFactor: 16, alpha: 2.0 })
    const noisy = addAwgnNoise(encoded, 200) // ~5% of music peak
    const decoded = maskedDecodePayload(noisy, { spreadFactor: 16, alpha: 2.0 })
    expect(decoded).toEqual(payload)
  })

  it('rejects pure-silence input with a structural error', () => {
    const silence = new Float64Array(44100 * 5)
    expect(() => maskedDecodePayload(silence, { spreadFactor: 4 })).toThrow()
  })
})

describe('Masked DSSS codec — error paths', () => {
  it('throws when music is too short to fit the payload', () => {
    const payload = new TextEncoder().encode('long enough to overflow')
    const music = makeMusicLikeSignal(0.5)
    expect(() => maskedEncodePayload(payload, music, { spreadFactor: 32 })).toThrow(/too short/i)
  })

  it('throws on implausibly large declared packet length', () => {
    const samples = new Float64Array(44100 * 5)
    // Inject a few non-zero samples to ensure the decoder reaches the header
    // check before terminating on length validation rather than silence.
    for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i * 0.01) * 10
    expect(() => maskedDecodePayload(samples, { spreadFactor: 4 })).toThrow()
  })
})

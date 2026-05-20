import { describe, expect, it } from 'vitest'
import {
  acousticEncodePayload,
  acousticDecodePayload,
  DEFAULT_BIT_SAMPLES,
  DEFAULT_REPEATS,
} from '../acoustic'

function withLeadingSilence(samples: Float64Array, silenceSamples: number): Float64Array {
  const out = new Float64Array(samples.length + silenceSamples)
  out.set(samples, silenceSamples)
  return out
}

function mixStereoToMonoInterleaved(samples: Float64Array): Float64Array {
  const out = new Float64Array(samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    out[i * 2] = samples[i]
    out[i * 2 + 1] = samples[i] * 0.97
  }
  return out
}

function resampleByRatio(samples: Float64Array, ratio: number): Float64Array {
  const out = new Float64Array(Math.floor(samples.length * ratio))
  for (let i = 0; i < out.length; i++) {
    const source = i / ratio
    const left = Math.floor(source)
    const frac = source - left
    const a = samples[left] ?? 0
    const b = samples[left + 1] ?? a
    out[i] = a + (b - a) * frac
  }
  return out
}

function addMusicLikeInterference(samples: Float64Array, amplitude: number): Float64Array {
  const out = new Float64Array(samples.length)
  const sampleRate = 44100
  const freqs = [196, 247, 330, 392, 523, 659, 988, 1319, 1760, 2349]
  for (let i = 0; i < samples.length; i++) {
    let noise = 0
    for (let j = 0; j < freqs.length; j++) {
      const wobble = 1 + 0.002 * Math.sin(2 * Math.PI * 0.7 * i / sampleRate + j)
      noise += Math.sin(2 * Math.PI * freqs[j] * wobble * i / sampleRate + j * 0.41)
    }
    out[i] = samples[i] * 0.7 + noise * amplitude / freqs.length
  }
  return out
}

describe('acoustic proof codec', () => {
  it('decodes a payload from tone audio with arbitrary leading capture offset', () => {
    const payload = new Uint8Array([0x01, 4, 8, 15, 16, 23, 42, 99])
    const encoded = acousticEncodePayload(payload)
    const captured = withLeadingSilence(encoded, 2660)

    expect(acousticDecodePayload(captured)).toEqual(payload)
  })

  it('decodes after moderate amplitude scaling and stereo capture folding', () => {
    const payload = new TextEncoder().encode('moonlit acoustic payload')
    const encoded = acousticEncodePayload(payload)
    const captured = mixStereoToMonoInterleaved(encoded.map(sample => sample * 0.42) as Float64Array)

    expect(acousticDecodePayload(captured, { channels: 2 })).toEqual(payload)
  })

  it('decodes after small microphone/browser sample-clock drift', () => {
    const payload = new TextEncoder().encode('resampled moon packet')
    const encoded = acousticEncodePayload(payload)
    const captured = withLeadingSilence(resampleByRatio(encoded, 1.002), 1733)

    expect(acousticDecodePayload(captured)).toEqual(payload)
  })

  it('decodes with moderate music-like interference', () => {
    const payload = new TextEncoder().encode('message under music')
    const encoded = acousticEncodePayload(payload)
    const captured = addMusicLikeInterference(withLeadingSilence(encoded, 901), 1400)

    expect(acousticDecodePayload(captured)).toEqual(payload)
  })

  it('reports preamble-not-found on pure silence', () => {
    const silence = new Float64Array(44100)
    expect(() => acousticDecodePayload(silence)).toThrow(/preamble not found/i)
  })

  it('reports checksum mismatch — not preamble-not-found — when payload is too corrupted for RS to recover', () => {
    const payload = new TextEncoder().encode('payload to corrupt with many bytes worth of damage')
    const encoded = acousticEncodePayload(payload)
    // Layout (bit indices): preamble 0..47, magic 48..79, length 80..95, crc 96..127, payload 128+
    // RS(255,223) corrects up to 16 byte errors. Zero out 20 bytes (160 bits) of payload to
    // exceed the correction capacity — RS-decode fails and verifyAndExtract returns null,
    // so the iteration records "checksum mismatch" (post-RS-failure, the highest-tier error).
    const bitWindow = DEFAULT_REPEATS * DEFAULT_BIT_SAMPLES
    const corruptStart = 128 * bitWindow
    const corruptEnd = (128 + 20 * 8) * bitWindow
    for (let i = corruptStart; i < corruptEnd && i < encoded.length; i++) {
      encoded[i] = 0
    }
    expect(() => acousticDecodePayload(encoded)).toThrow(/checksum mismatch/i)
  })

  it('decodes when the magic bytes have up to 4 bit-errors (tolerant magic check)', () => {
    const payload = new TextEncoder().encode('hello tolerant magic')
    const encoded = acousticEncodePayload(payload)
    // Flip one symbol within each of the first 4 magic-byte regions so each byte loses 1 bit
    // after majority vote. With DEFAULT_REPEATS=5 we need to corrupt 3 of 5 reps for a flip.
    const bitWindow = DEFAULT_REPEATS * DEFAULT_BIT_SAMPLES
    const repWindow = DEFAULT_BIT_SAMPLES
    // Flip bit 0 of magic byte 0 (= bit index 48 in encoded stream): corrupt reps 0, 1, 2.
    // To "flip" via silence (Goertzel sign-invariant), zero out 3 of 5 rep windows.
    const targetBitsToFlip = [48, 56, 64, 72] // first bit of each magic byte
    for (const bitIdx of targetBitsToFlip) {
      const bitStart = bitIdx * bitWindow
      for (let rep = 0; rep < 3; rep++) {
        const repStart = bitStart + rep * repWindow
        for (let i = repStart; i < repStart + repWindow && i < encoded.length; i++) {
          encoded[i] = 0
        }
      }
    }
    // 4 bit errors total — within MAGIC_BIT_TOLERANCE — should still decode.
    expect(acousticDecodePayload(encoded)).toEqual(payload)
  })

  it('decodes through additive white noise at ~30% per-symbol error rate', () => {
    const payload = new TextEncoder().encode('survive noise floor')
    const encoded = acousticEncodePayload(payload)
    // Add gaussian noise scaled to the signal amplitude. With 5x repetition, the codec should
    // tolerate substantial per-symbol error rates and still recover via majority vote.
    const noisy = new Float64Array(encoded.length)
    let seed = 12345
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 4294967296
    }
    const noiseAmplitude = 12000 // significant noise relative to signal amplitude 28000
    for (let i = 0; i < encoded.length; i++) {
      const u1 = Math.max(1e-12, random())
      const u2 = random()
      const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
      noisy[i] = encoded[i] + gauss * noiseAmplitude
    }
    expect(acousticDecodePayload(noisy)).toEqual(payload)
  })
})

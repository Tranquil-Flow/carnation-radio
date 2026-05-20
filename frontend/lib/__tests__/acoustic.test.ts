import { describe, expect, it } from 'vitest'
import { acousticEncodePayload, acousticDecodePayload } from '../acoustic'

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
})

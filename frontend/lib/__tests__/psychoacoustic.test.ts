import { describe, it, expect } from 'vitest'
import {
  stft,
  istft,
  frameMagnitudes,
  binToHz,
  hzToBin,
} from '../psychoacoustic/stft'

function rmsError(a: Float64Array, b: Float64Array): number {
  const n = Math.min(a.length, b.length)
  let acc = 0
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i]
    acc += d * d
  }
  return Math.sqrt(acc / n)
}

function makeSineWave(freq: number, durationSec: number, sampleRate = 44100, amplitude = 0.5): Float64Array {
  const n = Math.floor(durationSec * sampleRate)
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate)
  return out
}

function makeWhiteNoise(n: number, amplitude = 0.1, seed = 4242): Float64Array {
  let s = seed >>> 0
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0
    out[i] = ((s / 4294967296) * 2 - 1) * amplitude
  }
  return out
}

describe('STFT / iSTFT round-trip', () => {
  it('reconstructs a 5s pure sine wave to <1e-9 RMS error', () => {
    const sr = 44100
    const x = makeSineWave(1000, 5, sr, 0.5)
    const frames = stft(x)
    const y = istft(frames)
    expect(y.length).toBe(x.length)
    expect(rmsError(x, y)).toBeLessThan(1e-9)
  })

  it('reconstructs music-like multi-sine signal', () => {
    const sr = 44100
    const n = Math.floor(2 * sr)
    const x = new Float64Array(n)
    const freqs = [220, 440, 880, 1760, 3520]
    for (let i = 0; i < n; i++) {
      let v = 0
      for (const f of freqs) v += Math.sin((2 * Math.PI * f * i) / sr)
      x[i] = (v / freqs.length) * 0.5
    }
    const frames = stft(x)
    const y = istft(frames)
    expect(y.length).toBe(x.length)
    expect(rmsError(x, y)).toBeLessThan(1e-9)
  })

  it('reconstructs white noise', () => {
    const x = makeWhiteNoise(Math.floor(0.5 * 44100), 0.3)
    const frames = stft(x)
    const y = istft(frames)
    expect(rmsError(x, y)).toBeLessThan(1e-9)
  })

  it('handles non-multiple-of-hop length inputs', () => {
    const x = makeSineWave(1000, 0.123, 44100) // 5424 samples, not a multiple of 512
    const frames = stft(x)
    const y = istft(frames)
    expect(y.length).toBe(x.length)
    expect(rmsError(x, y)).toBeLessThan(1e-9)
  })

  it('uses 1024-FFT 512-hop defaults', () => {
    const x = makeSineWave(440, 0.1, 44100)
    const frames = stft(x)
    expect(frames.params.fftSize).toBe(1024)
    expect(frames.params.hop).toBe(512)
    expect(frames.params.window.length).toBe(1024)
  })

  it('rejects non-power-of-2 FFT size', () => {
    const x = makeSineWave(440, 0.05, 44100)
    expect(() => stft(x, 1000)).toThrow(/power of 2/i)
  })
})

describe('STFT magnitude spectrum', () => {
  it('a 1 kHz pure sine produces a magnitude peak at the 1 kHz bin', () => {
    const sr = 44100
    const x = makeSineWave(1000, 0.5, sr, 0.5)
    const frames = stft(x)
    // pick a middle frame (boundary frames have window-edge artifacts)
    const f = Math.floor(frames.numFrames / 2)
    const mags = frameMagnitudes(frames, f)
    const expectedBin = hzToBin(1000, frames.params.fftSize, sr)
    // Find argmax across the lower half
    let maxBin = 0, maxVal = -Infinity
    for (let k = 0; k < mags.length; k++) {
      if (mags[k] > maxVal) { maxVal = mags[k]; maxBin = k }
    }
    // Allow ±1 bin tolerance (sine may straddle bins depending on phase alignment)
    expect(Math.abs(maxBin - expectedBin)).toBeLessThanOrEqual(1)
  })

  it('binToHz / hzToBin are inverse for on-grid frequencies', () => {
    const fftSize = 1024
    const sr = 44100
    for (const hz of [100, 1000, 3000, 7350, 14000]) {
      const bin = hzToBin(hz, fftSize, sr)
      const backHz = binToHz(bin, fftSize, sr)
      // Allow rounding error of up to half a bin width
      const binWidth = sr / fftSize
      expect(Math.abs(backHz - hz)).toBeLessThanOrEqual(binWidth / 2 + 1e-9)
    }
  })
})

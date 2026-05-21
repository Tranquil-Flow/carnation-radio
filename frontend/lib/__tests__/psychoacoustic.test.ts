import { describe, it, expect } from 'vitest'
import {
  stft,
  istft,
  frameMagnitudes,
  binToHz,
  hzToBin,
} from '../psychoacoustic/stft'
import {
  freqToBark,
  barkToFreq,
  binBarks,
  bandIndexForHz,
  BARK_BAND_EDGES_HZ,
} from '../psychoacoustic/bark'
import { ath, athCurve, computeMaskingThreshold } from '../psychoacoustic/masking'

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

describe('Bark scale (Zwicker 1980)', () => {
  it('freqToBark is monotonic and matches Schroeder approximation', () => {
    // Reference values for the Schroeder/Zwicker closed-form (which is what
    // we use). Differs slightly from the discrete Bark-band table.
    expect(freqToBark(100)).toBeCloseTo(1.0, 0)
    expect(freqToBark(1000)).toBeCloseTo(8.5, 0)
    expect(freqToBark(5000)).toBeGreaterThan(17)
    expect(freqToBark(5000)).toBeLessThan(20)
    expect(freqToBark(15000)).toBeGreaterThan(22)
    // Monotonic
    for (let hz = 100; hz < 16000; hz += 100) {
      expect(freqToBark(hz + 100)).toBeGreaterThan(freqToBark(hz))
    }
  })

  it('barkToFreq is the inverse of freqToBark', () => {
    for (const hz of [50, 250, 1000, 4000, 10000]) {
      const back = barkToFreq(freqToBark(hz))
      expect(Math.abs(back - hz)).toBeLessThan(1) // ≤1 Hz error via bisection
    }
  })

  it('binBarks length equals fftSize/2 + 1', () => {
    const b = binBarks(1024, 44100)
    expect(b.length).toBe(513)
    expect(b[0]).toBe(0)
    expect(b[b.length - 1]).toBeGreaterThan(24)
  })

  it('bandIndexForHz partitions frequencies into critical bands', () => {
    // 1 kHz should fall in the band [920, 1080] — index 8 in BARK_BAND_EDGES_HZ
    expect(BARK_BAND_EDGES_HZ[bandIndexForHz(1000)]).toBeLessThanOrEqual(1000)
    expect(BARK_BAND_EDGES_HZ[bandIndexForHz(1000) + 1]).toBeGreaterThan(1000)
    // Out of range → -1
    expect(bandIndexForHz(5)).toBe(-1)
    expect(bandIndexForHz(50000)).toBe(-1)
  })
})

describe('Absolute Threshold of Hearing (ATH)', () => {
  it('has a minimum near 3-4 kHz (peak sensitivity region)', () => {
    const sr = 44100
    const curve = athCurve(1024, sr)
    // Find min
    let minBin = 0, minVal = Infinity
    for (let k = 1; k < curve.length; k++) {
      if (curve[k] < minVal) { minVal = curve[k]; minBin = k }
    }
    const minHz = (minBin * sr) / 1024
    expect(minHz).toBeGreaterThan(2000)
    expect(minHz).toBeLessThan(5500)
  })

  it('rises steeply at low and very-high frequencies', () => {
    // ATH at 50 Hz should be much higher than at 1 kHz
    expect(ath(50)).toBeGreaterThan(ath(1000) + 20)
    // ATH at 18 kHz should be much higher than at 1 kHz
    expect(ath(18000)).toBeGreaterThan(ath(1000) + 20)
  })

  it('ATH(1 kHz) is ~4 dB SPL (Terhardt 1979 reference)', () => {
    expect(ath(1000)).toBeGreaterThan(0)
    expect(ath(1000)).toBeLessThan(10)
  })
})

describe('Painter-Spanias masking threshold', () => {
  it('silence → threshold equals ATH only (no maskers)', () => {
    const fftSize = 1024
    const sr = 44100
    const mags = new Float64Array(fftSize / 2 + 1) // all zeros
    const T = computeMaskingThreshold(mags, { sampleRate: sr })
    const athDb = athCurve(fftSize, sr)
    // Convert ATH to amplitude in our reference frame: amp = 10^((ATH - refDb)/20)
    const refDb = 96
    for (let k = 0; k < T.length; k++) {
      const expectedAmp = Math.pow(10, (athDb[k] - refDb) / 20)
      expect(Math.log10(T[k] + 1e-30)).toBeCloseTo(Math.log10(expectedAmp + 1e-30), 1)
    }
  })

  it('a strong 1 kHz tone elevates threshold near 1 kHz', () => {
    const fftSize = 1024
    const sr = 44100
    const mags = new Float64Array(fftSize / 2 + 1)
    // Put a strong "tonal" spike at the 1 kHz bin with leading/trailing
    // sidelobes so it qualifies as a tonal masker (local max, 7 dB above
    // ±2 neighbors).
    const k1k = Math.round((1000 * fftSize) / sr) // ≈ 23
    mags[k1k] = 1000
    mags[k1k - 1] = 100
    mags[k1k + 1] = 100
    mags[k1k - 2] = 10
    mags[k1k + 2] = 10
    const T = computeMaskingThreshold(mags, { sampleRate: sr })
    // Threshold at 1 kHz should be much higher than threshold at 12 kHz
    const k12k = Math.round((12000 * fftSize) / sr)
    expect(T[k1k]).toBeGreaterThan(T[k12k] * 10)
  })

  it('threshold output length matches input length', () => {
    const mags = new Float64Array(513)
    const T = computeMaskingThreshold(mags, { sampleRate: 44100 })
    expect(T.length).toBe(513)
  })

  it('all threshold values are non-negative and finite', () => {
    const fftSize = 1024
    const sr = 44100
    // Synthetic mid-energy music-like spectrum: 1/f falloff
    const mags = new Float64Array(fftSize / 2 + 1)
    for (let k = 1; k < mags.length; k++) mags[k] = 1000 / k
    const T = computeMaskingThreshold(mags, { sampleRate: sr })
    for (let k = 0; k < T.length; k++) {
      expect(T[k]).toBeGreaterThanOrEqual(0)
      expect(Number.isFinite(T[k])).toBe(true)
    }
  })
})

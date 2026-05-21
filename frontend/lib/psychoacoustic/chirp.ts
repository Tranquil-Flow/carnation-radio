/**
 * Linear-FM chirp generation + FFT-based cross-correlation for sync.
 *
 * Used by the masked-DSSS codec to locate the start-of-packet in a recording
 * with unknown leading offset (the air-channel case: mic recording starts
 * some random time before audio playback, possibly after a long silence).
 *
 * A linear FM sweep has nearly-ideal autocorrelation: a sharp central peak
 * with sidelobes ~13 dB down at the first lobe. This makes the chirp robust
 * even when buried 20 dB below music — correlation gain (length × amplitude²)
 * lifts the peak above the music's incoherent contribution.
 *
 * For Carnation, we sweep 2-6 kHz over 0.5 s (matches the masked DSSS band)
 * so the chirp's spectral energy lies entirely within the music's own
 * masking-threshold region — making it inaudible-ish (the chirp peaks higher
 * than the DSSS carrier but is brief).
 */

import FFT from 'fft.js'

export interface ChirpParams {
  durationSec: number
  f0: number
  f1: number
  sampleRate: number
}

export const DEFAULT_CHIRP: ChirpParams = {
  durationSec: 0.5,
  f0: 2000,
  f1: 6000,
  sampleRate: 44100,
}

/**
 * Generate a linear-FM chirp. Returns time-domain samples in [-1, 1].
 * Caller scales to the appropriate amplitude before adding to music.
 *
 * Instantaneous frequency at sample n: f(n) = f0 + (f1 - f0) * n / L
 * Phase: integral of 2π·f(n)/Fs dn = 2π·(f0·n + (f1-f0)·n²/(2L)) / Fs
 */
export function generateChirp(params: ChirpParams = DEFAULT_CHIRP): Float64Array {
  const L = Math.floor(params.durationSec * params.sampleRate)
  const out = new Float64Array(L)
  const Fs = params.sampleRate
  const df = params.f1 - params.f0
  for (let n = 0; n < L; n++) {
    const phase = (2 * Math.PI / Fs) * (params.f0 * n + (df * n * n) / (2 * L))
    out[n] = Math.sin(phase)
  }
  // Hann-shaped ramp at edges (10% each end) to suppress click artifacts.
  const ramp = Math.floor(L * 0.1)
  for (let n = 0; n < ramp; n++) {
    const w = 0.5 * (1 - Math.cos(Math.PI * n / ramp))
    out[n] *= w
    out[L - 1 - n] *= w
  }
  return out
}

/** Round n up to the next power of 2. */
function nextPow2(n: number): number {
  let p = 1
  while (p < n) p <<= 1
  return p
}

export interface ChirpDetectionResult {
  /** Sample offset where chirp BEGINS in the input. -1 if no clear peak found. */
  offset: number
  /** Peak correlation / mean(|correlation|). Higher = more confident match. */
  peakRatio: number
  /** Length of the chirp template in samples (chirp ends at offset + chirpLength). */
  chirpLength: number
}

/**
 * Locate `chirpTemplate` within `samples` via FFT-based cross-correlation.
 *
 * The returned offset is the sample position where the chirp's first sample
 * aligns with the input. Cross-correlation is computed as IFFT(FFT(samples) ·
 * conj(FFT(chirpTemplate))), which is mathematically the convolution of
 * samples with the time-reversed template.
 *
 * `minPeakRatio` (default 4.0): if the peak isn't this many times the mean
 * absolute correlation, the result is treated as "no chirp detected" and
 * offset = -1. Calibrate this with real data — too low → false positives;
 * too high → missed detections in noisy conditions.
 */
export function findChirpStart(
  samples: Float64Array,
  chirpTemplate: Float64Array,
  minPeakRatio = 4.0,
): ChirpDetectionResult {
  const chirpLength = chirpTemplate.length
  if (samples.length < chirpLength) {
    return { offset: -1, peakRatio: 0, chirpLength }
  }

  // Pad both to a common power-of-2 length ≥ samples.length + chirpLength.
  const N = nextPow2(samples.length + chirpLength)
  const fft = new FFT(N)
  const SAMP = fft.createComplexArray() as unknown as Float64Array
  const CHIRP = fft.createComplexArray() as unknown as Float64Array
  const samplesPad = new Float64Array(N)
  samplesPad.set(samples, 0)
  const chirpPad = new Float64Array(N)
  chirpPad.set(chirpTemplate, 0)

  fft.realTransform(SAMP as any, samplesPad as any)
  fft.completeSpectrum(SAMP as any)
  fft.realTransform(CHIRP as any, chirpPad as any)
  fft.completeSpectrum(CHIRP as any)

  // Pointwise multiply SAMP · conj(CHIRP). For real signals this equals the
  // cross-correlation in time domain (samples ⋆ chirp).
  const PROD = new Float64Array(2 * N)
  for (let k = 0; k < N; k++) {
    const re1 = SAMP[2 * k], im1 = SAMP[2 * k + 1]
    const re2 = CHIRP[2 * k], im2 = CHIRP[2 * k + 1]
    // (re1 + i·im1) · (re2 - i·im2) = (re1·re2 + im1·im2) + i·(im1·re2 - re1·im2)
    PROD[2 * k] = re1 * re2 + im1 * im2
    PROD[2 * k + 1] = im1 * re2 - re1 * im2
  }

  const IFFT = fft.createComplexArray() as unknown as Float64Array
  fft.inverseTransform(IFFT as any, PROD as any)
  // IFFT result is normalized by N (per fft.js convention).

  // Argmax of real part across valid offsets (0 to samples.length - chirpLength).
  const maxOffset = samples.length - chirpLength
  let argmax = 0
  let peak = -Infinity
  let absSum = 0
  let absCount = 0
  for (let off = 0; off <= maxOffset; off++) {
    const v = IFFT[2 * off]
    if (v > peak) { peak = v; argmax = off }
    absSum += Math.abs(v)
    absCount++
  }
  const meanAbs = absCount > 0 ? absSum / absCount : 1e-30
  const peakRatio = peak / Math.max(meanAbs, 1e-30)
  return {
    offset: peakRatio >= minPeakRatio ? argmax : -1,
    peakRatio,
    chirpLength,
  }
}

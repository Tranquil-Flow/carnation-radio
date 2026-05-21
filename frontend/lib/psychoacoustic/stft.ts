/**
 * Short-Time Fourier Transform (STFT) wrapper around fft.js for Carnation
 * Radio's psychoacoustic-masked codec.
 *
 * Conventions
 * -----------
 * - Window:     sqrt(Hann), applied on BOTH analysis and synthesis. Product is
 *               Hann, which at 50% overlap satisfies COLA=1.0 → perfect
 *               reconstruction with zero spectral modification.
 * - FFT size:   power-of-2 (default 1024). 1024 @ 44.1 kHz → ~43 Hz bin width,
 *               ~23 ms frame — adequate for the 2-6 kHz carrier band.
 * - Hop:        FFT_SIZE / 2 (default 512).
 * - Frame data: each frame is a fft.js "complex array" — a Float64Array of
 *               length 2*N where element 2*k is Re[k] and 2*k+1 is Im[k]. This
 *               matches the format fft.js's transform/inverseTransform expect,
 *               so no marshalling is needed between layers.
 *
 * The single `stft()` call returns a contiguous Float64Array packed
 * (frame, complex-bin) for cache locality and minimal GC churn; helpers
 * are provided to view individual frames without copying.
 */

import FFT from 'fft.js'

export interface StftParams {
  readonly fftSize: number       // N (power of 2)
  readonly hop: number           // H (typically N/2)
  readonly originalLength: number // sample count before padding — istft trims to this
  readonly window: Float64Array  // sqrt(Hann) of length N
}

export interface StftFrames {
  /** Flat (numFrames * 2N) Float64Array. Each frame occupies 2N consecutive entries. */
  readonly data: Float64Array
  readonly numFrames: number
  readonly params: StftParams
}

const DEFAULT_FFT_SIZE = 1024

function sqrtHann(size: number): Float64Array {
  // Periodic Hann (n/N, not n/(N-1)). Squared, summed at 50% OL = 1.0 across all
  // sample positions strictly inside the windowed region.
  const w = new Float64Array(size)
  for (let n = 0; n < size; n++) {
    const hann = 0.5 * (1 - Math.cos((2 * Math.PI * n) / size))
    w[n] = Math.sqrt(hann)
  }
  return w
}

export function makeStftParams(
  originalLength: number,
  fftSize: number = DEFAULT_FFT_SIZE,
): StftParams {
  if ((fftSize & (fftSize - 1)) !== 0) throw new Error('stft: fftSize must be a power of 2')
  return {
    fftSize,
    hop: fftSize / 2,
    originalLength,
    window: sqrtHann(fftSize),
  }
}

/**
 * Forward STFT. Pads input with hop-many leading + trailing zeros so the first
 * and last samples are covered by full windows, then slides forward by `hop`
 * each step.
 */
export function stft(samples: Float64Array, fftSize: number = DEFAULT_FFT_SIZE): StftFrames {
  const params = makeStftParams(samples.length, fftSize)
  const { hop, window } = params
  // Pad with (fftSize - hop) at each end so boundary samples get full window
  // coverage and the inverse can recover them. With sqrt-Hann × sqrt-Hann at
  // 50% overlap, every sample in the padded interior has window sum = 1.0.
  const padPre = fftSize - hop // == hop for 50% OL
  const padPost = fftSize
  const padded = new Float64Array(padPre + samples.length + padPost)
  padded.set(samples, padPre)

  const numFrames = Math.floor((padded.length - fftSize) / hop) + 1
  const data = new Float64Array(numFrames * 2 * fftSize)
  const fft = new FFT(fftSize)
  const buf = new Float64Array(fftSize)
  const out = fft.createComplexArray() as unknown as Float64Array

  for (let f = 0; f < numFrames; f++) {
    const start = f * hop
    for (let i = 0; i < fftSize; i++) buf[i] = padded[start + i] * window[i]
    fft.realTransform(out as any, buf as any)
    // realTransform fills only positive frequencies; mirror conjugate so
    // bin-by-bin manipulation can address negative frequencies symmetrically.
    fft.completeSpectrum(out as any)
    data.set(out, f * 2 * fftSize)
  }
  return { data, numFrames, params }
}

/**
 * Inverse STFT (overlap-add). Applies the synthesis window (same sqrt-Hann),
 * overlaps frames at hop spacing, then trims pre-padding and clips to
 * params.originalLength. With sqrt-Hann × sqrt-Hann at 50% OL the COLA constant
 * is 1.0 exactly, so no per-sample window-sum normalization is needed.
 */
export function istft(frames: StftFrames): Float64Array {
  const { fftSize, hop, originalLength, window } = frames.params
  const padPre = fftSize - hop
  const reconstructedLength = padPre + originalLength + fftSize
  const accum = new Float64Array(reconstructedLength)
  const fft = new FFT(fftSize)
  const timeBuf = fft.createComplexArray() as unknown as Float64Array
  const freqBuf = new Float64Array(2 * fftSize)

  for (let f = 0; f < frames.numFrames; f++) {
    freqBuf.set(frames.data.subarray(f * 2 * fftSize, (f + 1) * 2 * fftSize))
    fft.inverseTransform(timeBuf as any, freqBuf as any)
    // fft.js inverseTransform DOES divide by size internally (see fft.js
    // source line 109–110), so we just apply the synthesis window here.
    const start = f * hop
    for (let i = 0; i < fftSize; i++) {
      // real part at 2*i, imag at 2*i+1; for real-input STFT the imag part of
      // the IFFT should be numerically near zero.
      accum[start + i] += timeBuf[2 * i] * window[i]
    }
  }
  return accum.subarray(padPre, padPre + originalLength).slice()
}

/**
 * Convenience: returns a *view* of frame `f`'s complex array (length 2*N).
 * Callers can mutate the view to inject spectral modifications before istft.
 */
export function frameView(frames: StftFrames, f: number): Float64Array {
  const { fftSize } = frames.params
  return frames.data.subarray(f * 2 * fftSize, (f + 1) * 2 * fftSize)
}

/**
 * Compute magnitude spectrum |X[k]| for frame f, length N (positive
 * frequencies only — bin 0..N-1 covers full DC..just-below-Nyquist symmetric
 * spectrum; psychoacoustic code only ever cares about 0..N/2).
 */
export function frameMagnitudes(frames: StftFrames, f: number): Float64Array {
  const { fftSize } = frames.params
  const view = frameView(frames, f)
  const mags = new Float64Array(fftSize / 2 + 1)
  for (let k = 0; k <= fftSize / 2; k++) {
    const re = view[2 * k]
    const im = view[2 * k + 1]
    mags[k] = Math.sqrt(re * re + im * im)
  }
  return mags
}

/**
 * Map FFT bin index → frequency in Hz, given the assumed sample rate.
 */
export function binToHz(bin: number, fftSize: number, sampleRate: number): number {
  return (bin * sampleRate) / fftSize
}

/**
 * Map frequency in Hz → nearest FFT bin (rounded). Inverse of binToHz.
 */
export function hzToBin(freq: number, fftSize: number, sampleRate: number): number {
  return Math.round((freq * fftSize) / sampleRate)
}

/**
 * Bark-scale frequency mapping (Zwicker 1980).
 *
 * The Bark scale partitions the audible spectrum into ~25 critical bands that
 * correspond to the ear's actual frequency-resolution. Below ~500 Hz the bands
 * are ~100 Hz wide; above 5 kHz they widen rapidly (3-5 kHz wide per band
 * around 10 kHz). The psychoacoustic-masking codec uses Bark distance Δz =
 * z(j) - z(i) — not Hz distance — when computing how much masker i masks
 * frequency j, because spreading functions are roughly invariant in Bark.
 *
 * Reference: Zwicker, E. (1980). "Subdivision of the audible frequency range
 * into critical bands". J. Acoust. Soc. Am. 33 (2): 248-249.
 */

/**
 * Convert frequency (Hz) → Bark value (the Zwicker 1980 closed-form).
 */
export function freqToBark(hz: number): number {
  const f = Math.max(0, hz)
  return 13 * Math.atan(0.00076 * f) + 3.5 * Math.atan((f / 7500) * (f / 7500))
}

/**
 * Inverse mapping (Bark → Hz) by 32-step bisection — accurate to ~0.01 Hz
 * across the audible range. The Zwicker formula isn't analytically invertible.
 */
export function barkToFreq(bark: number): number {
  if (bark <= 0) return 0
  let lo = 0, hi = 24000
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2
    if (freqToBark(mid) < bark) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** Bark value for every FFT bin k = 0..fftSize/2. */
export function binBarks(fftSize: number, sampleRate: number): Float64Array {
  const out = new Float64Array(fftSize / 2 + 1)
  for (let k = 0; k <= fftSize / 2; k++) {
    out[k] = freqToBark((k * sampleRate) / fftSize)
  }
  return out
}

/**
 * Standard Bark-band edge frequencies (25 bands covering ~20 Hz to ~16 kHz).
 * Used when grouping FFT bins into critical bands.
 */
export const BARK_BAND_EDGES_HZ: ReadonlyArray<number> = [
  20, 100, 200, 300, 400, 510, 630, 770, 920, 1080, 1270, 1480, 1720, 2000,
  2320, 2700, 3150, 3700, 4400, 5300, 6400, 7700, 9500, 12000, 15500, 22050,
]

/** Index of the critical band containing frequency hz, or -1 if out of range. */
export function bandIndexForHz(hz: number): number {
  if (hz < BARK_BAND_EDGES_HZ[0]) return -1
  for (let b = 0; b < BARK_BAND_EDGES_HZ.length - 1; b++) {
    if (hz >= BARK_BAND_EDGES_HZ[b] && hz < BARK_BAND_EDGES_HZ[b + 1]) return b
  }
  return -1
}

/**
 * For each FFT bin, the index of its critical band (or -1 if out of the
 * standard 25-band range).
 */
export function binBandIndices(fftSize: number, sampleRate: number): Int16Array {
  const out = new Int16Array(fftSize / 2 + 1)
  for (let k = 0; k <= fftSize / 2; k++) {
    out[k] = bandIndexForHz((k * sampleRate) / fftSize)
  }
  return out
}

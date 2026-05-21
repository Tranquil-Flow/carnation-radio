/**
 * Painter-Spanias MPEG-1 Layer 1 simplified psychoacoustic model (PAM1).
 *
 * Given a frame's FFT magnitude spectrum, returns a per-bin masking threshold:
 * the amplitude *below which* an added signal at that frequency is inaudible
 * given the presence of the music's own spectral content.
 *
 * Pipeline (per Painter-Spanias 2000, §III.B):
 *   1. Convert magnitudes → power-dB (relative; calibration via REF_SPL).
 *   2. Identify tonal maskers (local maxima exceeding neighbors by ≥7 dB).
 *   3. Compute non-tonal maskers per critical band (sum of remaining bins).
 *   4. Decimate maskers below the absolute hearing threshold ATH(f).
 *   5. Apply Painter-Spanias spreading function SF(Δz, L) — see eqns 7-9.
 *   6. Sum individual thresholds + ATH in linear power → output amplitude.
 *
 * Reference: Painter, T. & Spanias, A. (2000). "Perceptual coding of digital
 * audio." Proceedings of the IEEE, 88 (4): 451-515. (Public domain math; no
 * GPL-licensed reference implementations consulted.)
 */

import { freqToBark, binBarks, binBandIndices, BARK_BAND_EDGES_HZ } from './bark'

/**
 * Absolute threshold of hearing (Terhardt 1979) in dB SPL.
 * f in Hz. Result is dB SPL — a level the listener can just barely hear in
 * silence at that frequency.
 */
export function ath(hz: number): number {
  const f = Math.max(20, hz) / 1000
  return 3.64 * Math.pow(f, -0.8)
    - 6.5 * Math.exp(-0.6 * Math.pow(f - 3.3, 2))
    + 1e-3 * Math.pow(f, 4)
}

/**
 * Painter-Spanias spreading function. Returns how much a masker of level L
 * (dB SPL) at Bark position z_i masks a target at Bark position z_j.
 *
 * @param dz   z_j - z_i (in Bark, can be negative)
 * @param L    masker level in dB SPL
 * @return SF in dB (additive into the masker level)
 */
function spreadingFunction(dz: number, L: number): number {
  if (dz < -3 || dz >= 8) return -Infinity
  if (dz < -1) return 17 * dz - 0.4 * L + 11
  if (dz < 0) return (0.4 * L + 6) * dz
  if (dz < 1) return -17 * dz
  return (0.15 * L - 17) * dz - 0.15 * L
}

export interface MaskingOptions {
  /** Sample rate of the underlying audio (Hz). */
  sampleRate: number
  /**
   * dB SPL corresponding to magnitude 1.0 in the input FFT. Acts as a global
   * calibration knob — for a typical music-playback assumption ~75 dB SPL at
   * peak we set ref so a full-scale (16-bit PCM peak) bin reads ~96 dB SPL.
   */
  refDb?: number
}

const DEFAULT_REF_DB = 96 // 16-bit PCM full-scale → 96 dB SPL (MPEG convention)

/**
 * Compute the per-bin masking threshold for one frame.
 *
 * @param magnitudes |X[k]| of length fftSize/2+1
 * @param options    sample rate + reference SPL
 * @return per-bin amplitude threshold of same length; embedded amplitude
 *         ≤ alpha * threshold[k] is (per the model) inaudible.
 */
export function computeMaskingThreshold(
  magnitudes: Float64Array,
  options: MaskingOptions,
): Float64Array {
  const N = magnitudes.length // == fftSize/2 + 1
  const fftSize = (N - 1) * 2
  const sampleRate = options.sampleRate
  const refDb = options.refDb ?? DEFAULT_REF_DB

  // ---------- Step 1: convert to dB SPL power scale ----------
  // L[k] = refDb + 20 * log10(|X[k]|) (clamped to a sane floor)
  const L = new Float64Array(N)
  for (let k = 0; k < N; k++) {
    const m = Math.max(magnitudes[k], 1e-30)
    L[k] = refDb + 20 * Math.log10(m)
  }

  // Pre-compute per-bin Bark positions and band indices.
  const z = binBarks(fftSize, sampleRate)
  const bands = binBandIndices(fftSize, sampleRate)
  const athDb = new Float64Array(N)
  for (let k = 0; k < N; k++) athDb[k] = ath((k * sampleRate) / fftSize)

  // ---------- Step 2: identify tonal maskers ----------
  // A bin k is "tonal" if it is a local max (L[k] > L[k±1]) AND it exceeds
  // each of the ±Δ neighbors by ≥7 dB, where Δ depends on the frequency band
  // (per Painter-Spanias Table 6 — simplified to a single Δ=2 for the spike).
  const isTonal = new Uint8Array(N)
  for (let k = 2; k < N - 2; k++) {
    if (L[k] <= L[k - 1] || L[k] <= L[k + 1]) continue
    if (L[k] - L[k - 2] >= 7 && L[k] - L[k + 2] >= 7) isTonal[k] = 1
  }

  // ---------- Step 3: tonal masker levels (combine the ±1 neighbors) ----------
  // P_TM(k) = 10*log10(10^(L[k-1]/10) + 10^(L[k]/10) + 10^(L[k+1]/10))
  // Per PS — combining the local peak's lobe energy into the tonal level.
  const tonalLevel = new Float64Array(N)
  for (let k = 1; k < N - 1; k++) {
    if (!isTonal[k]) continue
    const p = Math.pow(10, L[k - 1] / 10) + Math.pow(10, L[k] / 10) + Math.pow(10, L[k + 1] / 10)
    tonalLevel[k] = 10 * Math.log10(p)
  }

  // ---------- Step 4: non-tonal maskers per critical band ----------
  // For each Bark band b, sum power across all bins in that band that AREN'T
  // tonal (and aren't a ±1 sidelobe of a tonal bin), then place a single
  // non-tonal masker at the geometric-mean frequency of the band.
  const numBands = BARK_BAND_EDGES_HZ.length - 1
  const nonTonalPower = new Float64Array(numBands)
  const nonTonalGmBin = new Int32Array(numBands).fill(-1)
  // Tag bins as "tonal or tonal-sidelobe" for exclusion
  const tonalOrSidelobe = new Uint8Array(N)
  for (let k = 0; k < N; k++) {
    if (isTonal[k]) {
      tonalOrSidelobe[k] = 1
      if (k > 0) tonalOrSidelobe[k - 1] = 1
      if (k < N - 1) tonalOrSidelobe[k + 1] = 1
    }
  }
  // Sum non-tonal power per band; track geometric-mean bin
  const bandLogSum = new Float64Array(numBands)
  const bandLogCount = new Int32Array(numBands)
  for (let k = 1; k < N; k++) {
    const b = bands[k]
    if (b < 0) continue
    if (tonalOrSidelobe[k]) continue
    nonTonalPower[b] += Math.pow(10, L[k] / 10)
    bandLogSum[b] += Math.log(k)
    bandLogCount[b] += 1
  }
  for (let b = 0; b < numBands; b++) {
    if (bandLogCount[b] > 0) {
      nonTonalGmBin[b] = Math.round(Math.exp(bandLogSum[b] / bandLogCount[b]))
    }
  }
  const nonTonalLevel = new Float64Array(numBands)
  for (let b = 0; b < numBands; b++) {
    nonTonalLevel[b] = nonTonalPower[b] > 0
      ? 10 * Math.log10(nonTonalPower[b])
      : -Infinity
  }

  // ---------- Step 5: spread each surviving masker across all bins ----------
  // Per Painter-Spanias eqn 11:
  //   T_TM(i,j) = P_TM(i) - 0.275*z(i) + SF(Δz, P_TM(i)) - 6.025
  //   T_NM(i,j) = P_NM(i) - 0.175*z(i) + SF(Δz, P_NM(i)) - 2.025
  // Discard maskers whose level is below ATH at their own location.
  const T_dB_perMasker: { z_i: number, L_i: number, offset: number }[] = []

  // Tonal contributions
  for (let i = 0; i < N; i++) {
    if (!isTonal[i]) continue
    const z_i = z[i]
    const L_i = tonalLevel[i]
    if (L_i < athDb[i]) continue
    T_dB_perMasker.push({ z_i, L_i, offset: -0.275 * z_i - 6.025 })
  }
  // Non-tonal contributions
  for (let b = 0; b < numBands; b++) {
    if (!isFinite(nonTonalLevel[b])) continue
    const binIdx = nonTonalGmBin[b]
    if (binIdx < 0 || binIdx >= N) continue
    const z_i = z[binIdx]
    const L_i = nonTonalLevel[b]
    if (L_i < athDb[binIdx]) continue
    T_dB_perMasker.push({ z_i, L_i, offset: -0.175 * z_i - 2.025 })
  }

  // ---------- Step 6: sum thresholds (linear power) per bin ----------
  // T_total(j) = sum_i 10^(T_i(j)/10) + 10^(ATH(j)/10)
  // Return amplitude = sqrt(T_total) in same units as input magnitudes.
  const thresholdAmp = new Float64Array(N)
  for (let j = 0; j < N; j++) {
    const z_j = z[j]
    let totalPower = Math.pow(10, athDb[j] / 10)
    for (const m of T_dB_perMasker) {
      const dz = z_j - m.z_i
      const sf = spreadingFunction(dz, m.L_i)
      if (!isFinite(sf)) continue
      const T_dB = m.L_i + m.offset + sf
      totalPower += Math.pow(10, T_dB / 10)
    }
    // Convert dB SPL power → amplitude in the input magnitude scale:
    //   L_dB = refDb + 20*log10(amp) → amp = 10^((L - refDb)/20)
    // totalPower is already a linear power level in the dB-SPL frame.
    const thresholdDb = 10 * Math.log10(totalPower)
    thresholdAmp[j] = Math.pow(10, (thresholdDb - refDb) / 20)
  }
  return thresholdAmp
}

/** Exposed for tests: ATH in dB SPL across a frequency grid. */
export function athCurve(fftSize: number, sampleRate: number): Float64Array {
  const out = new Float64Array(fftSize / 2 + 1)
  for (let k = 0; k <= fftSize / 2; k++) out[k] = ath((k * sampleRate) / fftSize)
  return out
}

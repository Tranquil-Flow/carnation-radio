/**
 * IIR biquad bandpass filter — RBJ Audio EQ Cookbook formulas.
 *
 * Used by the masked-DSSS decoder to isolate the 2-6 kHz carrier band from
 * the wide-spectrum recording. Reduces music interference outside the band
 * (bass + treble) and can help the front-end recover from AGC compression
 * that's dominated by out-of-band energy.
 *
 * A single biquad bandpass gives -6 dB/octave rolloff. Cascading two stages
 * yields ~-12 dB/octave, four stages ~-24 dB/octave. Default is 2 stages.
 *
 * Reference: Robert Bristow-Johnson, "Cookbook formulae for audio EQ biquad
 * filter coefficients", https://www.w3.org/TR/audio-eq-cookbook/
 */

interface BiquadCoefficients {
  b0: number; b1: number; b2: number
  a1: number; a2: number
}

function bandpassCoefficients(f0: number, Q: number, sampleRate: number): BiquadCoefficients {
  const w = 2 * Math.PI * f0 / sampleRate
  const cosW = Math.cos(w)
  const sinW = Math.sin(w)
  const alpha = sinW / (2 * Q)
  const a0 = 1 + alpha
  // Constant 0 dB peak gain BPF (RBJ cookbook).
  return {
    b0: alpha / a0,
    b1: 0,
    b2: -alpha / a0,
    a1: -2 * cosW / a0,
    a2: (1 - alpha) / a0,
  }
}

function applyBiquad(input: Float64Array, c: BiquadCoefficients): Float64Array {
  const n = input.length
  const out = new Float64Array(n)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < n; i++) {
    const x0 = input[i]
    const y0 = c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2
    out[i] = y0
    x2 = x1; x1 = x0
    y2 = y1; y1 = y0
  }
  return out
}

/**
 * Apply a 2-6 kHz bandpass with steep rejection outside the band.
 *
 * @param samples input signal
 * @param sampleRate Hz
 * @param lowHz lower edge (default 2000)
 * @param highHz upper edge (default 6000)
 * @param stages number of cascaded biquads (default 2 = ~-12 dB/octave)
 */
export function bandpass2to6kHz(
  samples: Float64Array,
  sampleRate: number,
  lowHz = 2000,
  highHz = 6000,
  stages = 2,
): Float64Array {
  // Center frequency (geometric mean) and Q derived from band edges.
  const f0 = Math.sqrt(lowHz * highHz)
  const bw = highHz - lowHz
  const Q = f0 / bw
  const coefs = bandpassCoefficients(f0, Q, sampleRate)
  let out = samples
  for (let s = 0; s < stages; s++) out = applyBiquad(out, coefs)
  return out
}

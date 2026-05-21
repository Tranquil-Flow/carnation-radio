/**
 * Psychoacoustic-masked DSSS codec for Carnation Radio (Phase 2 spike).
 *
 * Embeds a payload inside the music's own masking threshold using direct-
 * sequence spread spectrum (DSSS) on multiple sub-carriers within a 2-6 kHz
 * audible band. The per-frame masking threshold T[k] (from the Painter-Spanias
 * PAM1 model) caps the embedded amplitude so the result is — per the model —
 * inaudible.
 *
 * Phase 2 scope:
 *   - File-channel only. No sync preamble; decoder assumes sample 0 is the
 *     start of frame 0. Air-channel sync (chirp-based) lands in Phase 5.
 *   - Single PN code shared across bits on the same subcarrier (reused every
 *     `spreadFactor` chips). Codes across subcarriers are different LFSR
 *     seeds of the same primitive polynomial.
 *   - Real-only spectral additive embedding (preserves real iSTFT output).
 *
 * Wire framing is reused from codec-framing.ts so decoded payloads route
 * through the same `detectVersion` / wallet-decrypt pipeline as the OFDM
 * codec's output.
 *
 * Clean-room implementation per the plan:
 *   - Painter & Spanias (2000) — masking model
 *   - Cox, Kilian, Leighton, Shamoon (1997) — spread-spectrum watermarking
 *   - Garcia (1999) — DSSS for audio
 * Never references audiowmark or any GPL-licensed prior art.
 */

import { stft, istft, frameView, frameMagnitudes, hzToBin, type StftFrames } from './psychoacoustic/stft'
import { computeMaskingThreshold } from './psychoacoustic/masking'
import { makeCodebook } from './psychoacoustic/pn'
import { bandpass2to6kHz } from './psychoacoustic/bandpass'
import {
  generateChirp,
  findChirpStart,
  DEFAULT_CHIRP,
  type ChirpParams,
} from './psychoacoustic/chirp'
import {
  buildPacket,
  verifyAndExtract,
  bytesToBits,
  bitsToBytes,
} from './codec-framing'
import { RS_PARITY_BYTES } from './reed-solomon'

export const MASKED_SAMPLE_RATE = 44100
export const MASKED_FFT_SIZE = 1024
export const MASKED_HOP = 512 // implicit from FFT/2 in stft.ts
export const MASKED_CARRIER_BAND: readonly [number, number] = [2000, 6000]
export const MASKED_NUM_SUBCARRIERS = 4
export const MASKED_DEFAULT_SPREAD_FACTOR = 32
// Validated 2026-05-21 against bella-ciao.wav on MacBook Pro speakers, 3-round
// A/B with original at matched volume: no audible difference. The carrier sits
// exactly at the per-frame Painter-Spanias masking threshold, which the model
// predicts is the just-noticeable-difference boundary.
//
// Phase 5 air-channel testing (built-in laptop speakers + built-in mic):
// at alpha=1.0 / 5.0 / 20.0 the DSSS data did NOT decode (~50% BER, header
// length always garbage). Chirp sync detected reliably (peakRatio 8-278).
// Conclusion: the cheap-laptop speaker→mic coupling is the bottleneck, not
// the codec. External hardware or a neural codec (XAttnMark) would be the
// next experiment. Masked codec ships as FILE-CHANNEL-ONLY for now.
export const MASKED_DEFAULT_ALPHA = 1.0

export interface MaskedEncodeOptions {
  /** Amplitude scale relative to the masking threshold. 1.0 = inaudible per
   *  the PS model; >1.0 trades audibility for SNR. */
  alpha?: number
  /** Carrier band [low, high] Hz. */
  carrierBand?: readonly [number, number]
  /** Number of parallel DSSS sub-carriers in the band. */
  numSubcarriers?: number
  /** PN-code length (chips per bit). */
  spreadFactor?: number
  /** Reed-Solomon parity bytes (32 = standard, 128 = heavy). */
  parityBytes?: number
  /** Override the assumed sample rate (default 44100). */
  sampleRate?: number
  /** Sample value corresponding to "full-scale" (96 dB SPL in the
   *  Painter-Spanias frame). Default 32768 (int16 PCM full-scale). */
  samplePeak?: number
  /**
   * Embed a sync chirp at the start of the encoded output and use cross-
   * correlation to locate it during decode. Required for the air channel
   * (mic recording has unknown offset); harmless but adds CPU for the file
   * channel. Default: true.
   */
  useSync?: boolean
  /**
   * Chirp amplitude as a fraction of the music's actual peak. 0.1 gives ~20
   * dB chirp-to-music ratio at peak, mostly masked. Default 0.1.
   */
  chirpAmplitudeFraction?: number
  /**
   * Apply a 2-6 kHz bandpass to mic input before chirp detection / demod.
   * Helps when out-of-band music energy is causing AGC compression or
   * raising the noise floor. The IIR bandpass distorts phase, which our
   * BPSK demod is sensitive to, so it's OFF by default and the file-channel
   * path doesn't need it. Turn on for live-mic decode. Default false.
   */
  applyBandpass?: boolean
}

interface ResolvedOptions {
  alpha: number
  carrierBand: readonly [number, number]
  numSubcarriers: number
  spreadFactor: number
  parityBytes: number
  sampleRate: number
  samplePeak: number
  refDb: number
  useSync: boolean
  chirpAmplitudeFraction: number
  chirpParams: ChirpParams
  applyBandpass: boolean
}

function resolve(options: MaskedEncodeOptions = {}): ResolvedOptions {
  const samplePeak = options.samplePeak ?? 32768
  // Calibrate the masking model so a full-scale (samplePeak) sine wave reads
  // 96 dB SPL: a pure sine at sample amplitude A has FFT bin magnitude
  // A * fftSize/2 from fft.js's realTransform.
  const fullScaleBinMag = samplePeak * (MASKED_FFT_SIZE / 2)
  const refDb = 96 - 20 * Math.log10(fullScaleBinMag)
  const sampleRate = options.sampleRate ?? MASKED_SAMPLE_RATE
  return {
    alpha: options.alpha ?? MASKED_DEFAULT_ALPHA,
    carrierBand: options.carrierBand ?? MASKED_CARRIER_BAND,
    numSubcarriers: options.numSubcarriers ?? MASKED_NUM_SUBCARRIERS,
    spreadFactor: options.spreadFactor ?? MASKED_DEFAULT_SPREAD_FACTOR,
    parityBytes: options.parityBytes ?? RS_PARITY_BYTES,
    sampleRate,
    samplePeak,
    refDb,
    useSync: options.useSync ?? true,
    chirpAmplitudeFraction: options.chirpAmplitudeFraction ?? 0.1,
    chirpParams: { ...DEFAULT_CHIRP, sampleRate },
    applyBandpass: options.applyBandpass ?? false,
  }
}

/** Evenly spaced carrier bin indices in [lowHz, highHz]. */
function carrierBins(
  numSubcarriers: number,
  carrierBand: readonly [number, number],
  sampleRate: number,
): number[] {
  const [lowHz, highHz] = carrierBand
  const lowBin = hzToBin(lowHz, MASKED_FFT_SIZE, sampleRate)
  const highBin = hzToBin(highHz, MASKED_FFT_SIZE, sampleRate)
  const bins: number[] = []
  for (let s = 0; s < numSubcarriers; s++) {
    const t = numSubcarriers === 1 ? 0.5 : s / (numSubcarriers - 1)
    bins.push(Math.round(lowBin + t * (highBin - lowBin)))
  }
  return bins
}

/**
 * Compute the BPSK symbol stream from a packet's bits: 0 -> -1, 1 -> +1.
 * Pads to a multiple of numSubcarriers so each "symbol time" carries exactly
 * numSubcarriers bits.
 */
function packetToSymbols(packetBits: number[], numSubcarriers: number): Int8Array {
  const padded = packetBits.slice()
  while (padded.length % numSubcarriers !== 0) padded.push(0)
  const out = new Int8Array(padded.length)
  for (let i = 0; i < padded.length; i++) out[i] = padded[i] === 1 ? 1 : -1
  return out
}

export function maskedEncodePayload(
  payload: Uint8Array,
  music: Float64Array,
  options: MaskedEncodeOptions = {},
): Float64Array {
  const opts = resolve(options)
  const fftSize = MASKED_FFT_SIZE

  const packet = buildPacket(payload, opts.parityBytes)
  const packetBits = bytesToBits(packet)
  const symbols = packetToSymbols(packetBits, opts.numSubcarriers)
  const symbolTimes = symbols.length / opts.numSubcarriers
  const dataFrames = symbolTimes * opts.spreadFactor

  // Reserve hop-aligned frames at the start for the sync chirp region so DSSS
  // modulation doesn't overlap chirp samples (avoids correlation pollution).
  const hop = fftSize / 2
  const chirp = opts.useSync ? generateChirp(opts.chirpParams) : new Float64Array(0)
  const chirpFrames = opts.useSync ? Math.ceil(chirp.length / hop) : 0
  const framesNeeded = chirpFrames + dataFrames

  const bins = carrierBins(opts.numSubcarriers, opts.carrierBand, opts.sampleRate)
  const codes = makeCodebook(opts.numSubcarriers, opts.spreadFactor)

  const frames = stft(music, fftSize)
  if (frames.numFrames < framesNeeded) {
    throw new Error(
      `acoustic-masked: music too short — need ${framesNeeded} STFT frames ` +
      `(~${Math.ceil((framesNeeded * frames.params.hop) / opts.sampleRate)}s), ` +
      `got ${frames.numFrames}`,
    )
  }

  for (let t = 0; t < dataFrames; t++) {
    const frameIdx = chirpFrames + t
    const view = frameView(frames, frameIdx)
    const mags = frameMagnitudes(frames, frameIdx)
    const T = computeMaskingThreshold(mags, { sampleRate: opts.sampleRate, refDb: opts.refDb })

    const symbolTime = Math.floor(t / opts.spreadFactor)
    const chipIndex = t % opts.spreadFactor

    for (let s = 0; s < opts.numSubcarriers; s++) {
      const bitIdx = symbolTime * opts.numSubcarriers + s
      if (bitIdx >= symbols.length) continue
      const bit = symbols[bitIdx]
      const chip = codes[s][chipIndex]
      const k = bins[s]
      const delta = bit * chip * opts.alpha * T[k]
      // Real-only additive embedding; mirror to N-k to preserve conjugate
      // symmetry so the iSTFT output stays real.
      view[2 * k] += delta
      if (k > 0 && k < fftSize / 2) {
        view[2 * (fftSize - k)] += delta
      }
    }
  }
  const reconstructed = istft(frames)

  if (opts.useSync) {
    // Add the chirp additively into the first chirp.length samples, scaled to
    // a fraction of the music's actual peak. Music masks most of it; the
    // remainder is brief enough not to dominate perception.
    let musicPeak = 0
    for (let i = 0; i < Math.min(reconstructed.length, hop * 200); i++) {
      const a = Math.abs(reconstructed[i])
      if (a > musicPeak) musicPeak = a
    }
    const chirpAmp = musicPeak * opts.chirpAmplitudeFraction
    for (let i = 0; i < chirp.length && i < reconstructed.length; i++) {
      reconstructed[i] += chirp[i] * chirpAmp
    }
  }
  return reconstructed
}

const MAX_PACKET_BYTES = 16384 // hard cap to avoid pathological scans

/**
 * Decode a masked-DSSS-encoded music signal. Assumes sample 0 = data frame 0
 * (no sync). Returns the inner payload bytes.
 *
 * The decoder reads the same number of frames the encoder produced, by
 * inferring it from a header-first scan: decode just enough symbol-times to
 * read MAGIC + length, validate them, then decode exactly the remaining bits.
 */
export function maskedDecodePayload(
  samples: Float64Array,
  options: MaskedEncodeOptions = {},
): Uint8Array {
  const opts = resolve(options)
  const fftSize = MASKED_FFT_SIZE
  const hop = fftSize / 2

  // With sync, try a small set of sample-level offsets around the chirp peak.
  // Cross-correlation finds chirp position to integer-sample precision; even
  // a 1-sample error rotates high-frequency carrier bins enough to flip BPSK
  // sign. We try ±4 samples; one almost always decodes cleanly.
  if (opts.useSync) {
    if (opts.applyBandpass) {
      // Bandpass-filter the input to the 2-6 kHz carrier band. Removes out-
      // of-band music interference (bass, treble) and improves chirp-
      // detection peak ratio. The IIR bandpass distorts phase, which the
      // BPSK demod is sensitive to, so this is OFF by default — only the
      // live-mic decode path opts in.
      samples = bandpass2to6kHz(samples, opts.sampleRate)
    }

    const chirpTemplate = generateChirp(opts.chirpParams)
    // Cap chirp-search FFT cost. A 30-second window is enough headroom even
    // when music loops every ~2 minutes — the chirp reappears with each
    // loop, and we run multiple decode attempts per minute.
    const maxSearchSamples = Math.floor(30 * opts.sampleRate)
    const result = findChirpStart(samples, chirpTemplate, 4.0, maxSearchSamples)
    if (result.offset < 0) {
      throw new Error('masked: sync chirp not found in input')
    }
    // Slice such that decoder STFT frame index `chirpFrames` aligns with
    // encoder STFT frame `chirpFrames`. STFT applies a hop-long pre-pad of
    // zeros, so decoder frame g's full window covers slice samples
    // [(g-1)*hop, (g-1)*hop + fftSize). To match encoder frame `chirpFrames`
    // (which covers original [(chirpFrames-1)*hop, (chirpFrames-1)*hop+fftSize)),
    // we slice at chirp_offset + (chirpFrames-1)*hop and skip decoder frame 0.
    const chirpFrames = Math.ceil(chirpTemplate.length / hop)
    const baseStart = result.offset + (chirpFrames - 1) * hop
    // Small sample-level offset search for residual sub-hop misalignment
    // (sample-precision chirp detection + clock drift).
    const offsetsToTry: number[] = []
    const deltas: number[] = [0]
    for (let d = 1; d <= 8; d++) { deltas.push(d); deltas.push(-d) }
    for (const d of deltas) {
      const candidate = baseStart + d
      if (candidate >= 0 && candidate < samples.length) offsetsToTry.push(candidate)
    }
    let lastErr: Error | null = null
    for (const dataStart of offsetsToTry) {
      try {
        return decodeAtOffset(samples.subarray(dataStart), opts, /* skipFirstFrame */ true)
      } catch (err: any) {
        lastErr = err
      }
    }
    throw lastErr ?? new Error('masked: decode failed at all offsets')
  }

  return decodeAtOffset(samples, opts, false)
}

function decodeAtOffset(dataSamples: Float64Array, opts: ResolvedOptions, skipFirstFrame: boolean): Uint8Array {
  const fftSize = MASKED_FFT_SIZE
  const bins = carrierBins(opts.numSubcarriers, opts.carrierBand, opts.sampleRate)
  const codes = makeCodebook(opts.numSubcarriers, opts.spreadFactor)
  const frames = stft(dataSamples, fftSize)
  // When sync slicing was used, the first decoder frame is a half-window
  // leading edge that doesn't align with any encoder data frame. Skip it.
  const frameStart = skipFirstFrame ? 1 : 0

  const bitsPerSymbolTime = opts.numSubcarriers
  const framesPerSymbolTime = opts.spreadFactor
  const usableFrames = frames.numFrames - frameStart
  const maxSymbolTimes = Math.floor(usableFrames / framesPerSymbolTime)

  // First-pass: decode enough symbol-times to recover MAGIC + length (10 bytes
  // = 80 bits). Read more bytes than strictly needed so we can confirm we have
  // enough frames for the full packet before doing the heavy decode loop.
  const headerSymbolTimes = Math.ceil(80 / bitsPerSymbolTime)
  if (maxSymbolTimes < headerSymbolTimes) {
    throw new Error('masked: input too short to contain a packet header')
  }
  const headerBits = decodeBits(frames, codes, bins, opts, headerSymbolTimes, frameStart)
  const headerBytes = bitsToBytes(headerBits.slice(0, 80))
  const length = (headerBytes[4] << 8) | headerBytes[5]
  if (length === 0 || length > MAX_PACKET_BYTES) {
    throw new Error(`masked: implausible packet length ${length}`)
  }
  const totalPacketBytes = 10 + length
  const totalPacketBits = totalPacketBytes * 8
  const requiredSymbolTimes = Math.ceil(totalPacketBits / bitsPerSymbolTime)
  if (requiredSymbolTimes > maxSymbolTimes) {
    throw new Error(
      `masked: input too short — need ${requiredSymbolTimes} symbol times, ` +
      `got ${maxSymbolTimes}`,
    )
  }
  const allBits = decodeBits(frames, codes, bins, opts, requiredSymbolTimes, frameStart)
  const packet = bitsToBytes(allBits.slice(0, totalPacketBits))
  const payload = verifyAndExtract(packet, opts.parityBytes)
  if (!payload) throw new Error('masked: packet failed RS / CRC check')
  return payload
}

function decodeBits(
  frames: StftFrames,
  codes: Int8Array[],
  bins: number[],
  opts: ResolvedOptions,
  symbolTimes: number,
  frameStart: number,
): number[] {
  const out: number[] = []
  for (let symbolTime = 0; symbolTime < symbolTimes; symbolTime++) {
    for (let s = 0; s < opts.numSubcarriers; s++) {
      let acc = 0
      for (let c = 0; c < opts.spreadFactor; c++) {
        const t = frameStart + symbolTime * opts.spreadFactor + c
        if (t >= frames.numFrames) break
        const view = frameView(frames, t)
        const re = view[2 * bins[s]]
        acc += re * codes[s][c]
      }
      out.push(acc > 0 ? 1 : 0)
    }
  }
  return out
}

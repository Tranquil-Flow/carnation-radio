/**
 * Multi-tone FSK (4-band parallel BFSK) — a.k.a. "OFDM-lite" for Carnation Radio.
 *
 * Where the single-pair FSK in acoustic.ts modulates ONE bit per symbol time using
 * two tones (FREQ_ZERO / FREQ_ONE), this module modulates FOUR bits per symbol by
 * running four independent BFSK pairs in parallel sub-bands:
 *
 *   Band 0:  14500 / 15000 Hz  → bit 0 of each nibble
 *   Band 1:  15500 / 16000 Hz  → bit 1
 *   Band 2:  16500 / 17000 Hz  → bit 2
 *   Band 3:  17500 / 18000 Hz  → bit 3
 *
 * Each transmitted symbol = sum of 4 tones (one per band) at amplitude AMPLITUDE/4.
 * Decoder runs 8 Goertzel filters per symbol and picks the active tone per band.
 *
 * Why this beats single-pair FSK in noisy environments:
 *   - Narrowband interference (e.g. a fluorescent light buzz, traffic at 1 kHz) only
 *     hits one or two bands at most. The other bands still decode cleanly. Reed-Solomon
 *     absorbs the corrupted-band byte errors.
 *   - 4x more data per symbol → 4x shorter packet → 4x less time for any single
 *     interference event to corrupt the whole transmission.
 *
 * Wire format above the modulation (preamble + magic + length + crc + RS payload) is
 * IDENTICAL to acoustic.ts. Only the bit-to-audio mapping changes. The same payload
 * encrypted with password or wallet mode still works.
 */

import { rsEncodeShortened, rsDecodeShortened, RS_PARITY_BYTES_HEAVY } from './reed-solomon'

// OFDM uses HEAVY RS parity (128 bytes) to tolerate the ~25% byte error rate
// that broadband noise produces when it hits all 4 OFDM bands simultaneously.
const OFDM_RS_PARITY = RS_PARITY_BYTES_HEAVY

export const OFDM_SAMPLE_RATE = 44100
export const OFDM_BIT_SAMPLES = 200 // samples per symbol = ~4.5ms
export const OFDM_REPEATS = 3
export const OFDM_BITS_PER_SYMBOL = 4

// Four BFSK pairs in 14.5-18 kHz. Above the dominant spectral content of speech
// and most music (which drops sharply above 8 kHz), giving a relatively clear
// band for the carrier. Tested cheaper bands (9-13 kHz) where the music itself
// has high energy — those failed because in-band music content drowns the
// carrier at the mic. Trade-off: this band rolls off on cheap consumer speakers,
// limiting cross-device range, but the SNR vs music interference is better.
const BAND_FREQS: ReadonlyArray<readonly [number, number]> = [
  [14500, 15000],
  [15500, 16000],
  [16500, 17000],
  [17500, 18000],
]
// Per-tone amplitude. Total peak amplitude at in-phase alignment of all 4 tones
// would be 4 * PER_TONE = 16000 = -6 dBFS, matching the single-FSK config.
const PER_TONE_AMPLITUDE = 4000

const MAGIC = [0x43, 0x52, 0x41, 0x43] // CRAC — same wire-level magic as single-FSK
const MAGIC_BIT_TOLERANCE = 4
const PREAMBLE_BIT_TOLERANCE = 6

// Preamble bit sequence (48 bits) — kept identical to the single-FSK module so
// payload tooling (detectVersion, walletDecrypt, etc.) doesn't care which
// modulation produced the bytes.
const PREAMBLE_BITS = [
  ...Array.from({ length: 32 }, (_, i) => i % 2),
  1, 1, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0,
]

export type OfdmDecodeOptions = {
  sampleRate?: number
  bitSamples?: number
  repeats?: number
  channels?: number
}

// ---------- packet building (identical to single-FSK) ----------

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let byteIndex = 0; byteIndex < bytes.length; byteIndex++) {
    crc ^= bytes[byteIndex]
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function bytesToBits(bytes: Uint8Array): number[] {
  const bits: number[] = []
  for (let byteIndex = 0; byteIndex < bytes.length; byteIndex++) {
    const byte = bytes[byteIndex]
    for (let bit = 7; bit >= 0; bit--) bits.push((byte >> bit) & 1)
  }
  return bits
}

function bitsToBytes(bits: number[]): Uint8Array {
  const bytes = new Uint8Array(Math.floor(bits.length / 8))
  for (let i = 0; i < bytes.length; i++) {
    let value = 0
    for (let bit = 0; bit < 8; bit++) value = (value << 1) | (bits[i * 8 + bit] & 1)
    bytes[i] = value
  }
  return bytes
}

function buildPacket(payload: Uint8Array): Uint8Array {
  const rsEncoded = rsEncodeShortened(payload, OFDM_RS_PARITY)
  if (rsEncoded.length > 0xffff) throw new Error('Acoustic payload too long')
  const packet = new Uint8Array(MAGIC.length + 2 + 4 + rsEncoded.length)
  packet.set(MAGIC, 0)
  packet[4] = (rsEncoded.length >> 8) & 0xff
  packet[5] = rsEncoded.length & 0xff
  const checksum = crc32(payload)
  packet[6] = (checksum >>> 24) & 0xff
  packet[7] = (checksum >>> 16) & 0xff
  packet[8] = (checksum >>> 8) & 0xff
  packet[9] = checksum & 0xff
  packet.set(rsEncoded, 10)
  return packet
}

// ---------- encoder ----------

export function ofdmEncodePayload(payload: Uint8Array, options: OfdmDecodeOptions = {}): Float64Array {
  const sampleRate = options.sampleRate ?? OFDM_SAMPLE_RATE
  const bitSamples = options.bitSamples ?? OFDM_BIT_SAMPLES
  const repeats = options.repeats ?? OFDM_REPEATS

  const packetBits = bytesToBits(buildPacket(payload))

  // Preamble: each preamble bit is replicated across all 4 bands within one symbol.
  // This costs 4x more time on the preamble (48 symbols vs 12), but means any single
  // band being jammed by narrowband interference still leaves 3 clean bands to vote
  // with — preamble lock survives 1-band corruption. Data symbols below retain
  // 4 independent bits per symbol for full throughput.
  const symbolPlans: number[][] = []
  for (const pBit of PREAMBLE_BITS) {
    const sym = new Array(OFDM_BITS_PER_SYMBOL).fill(pBit)
    symbolPlans.push(sym)
  }
  // Data symbols: pack OFDM_BITS_PER_SYMBOL packet bits per symbol, one per band.
  const dataBitsPadded = [...packetBits]
  while (dataBitsPadded.length % OFDM_BITS_PER_SYMBOL !== 0) dataBitsPadded.push(0)
  for (let i = 0; i < dataBitsPadded.length; i += OFDM_BITS_PER_SYMBOL) {
    const sym: number[] = []
    for (let b = 0; b < OFDM_BITS_PER_SYMBOL; b++) sym.push(dataBitsPadded[i + b])
    symbolPlans.push(sym)
  }

  const samples = new Float64Array(symbolPlans.length * repeats * bitSamples)

  for (let symbol = 0; symbol < symbolPlans.length; symbol++) {
    const symbolBits = symbolPlans[symbol]
    for (let repeat = 0; repeat < repeats; repeat++) {
      const start = (symbol * repeats + repeat) * bitSamples
      for (let i = 0; i < bitSamples; i++) {
        const edge = Math.min(1, i / 80, (bitSamples - 1 - i) / 80)
        let mix = 0
        for (let band = 0; band < BAND_FREQS.length; band++) {
          const freq = symbolBits[band] ? BAND_FREQS[band][1] : BAND_FREQS[band][0]
          const phase = 2 * Math.PI * freq * i / sampleRate
          mix += Math.sin(phase)
        }
        samples[start + i] = mix * PER_TONE_AMPLITUDE * Math.max(0, edge)
      }
    }
  }
  return samples
}

// ---------- decoder ----------

function maybeDownmix(samples: Float64Array, channels: number): Float64Array {
  if (channels <= 1) return samples
  const frames = Math.floor(samples.length / channels)
  const mono = new Float64Array(frames)
  for (let frame = 0; frame < frames; frame++) {
    let sum = 0
    for (let ch = 0; ch < channels; ch++) sum += samples[frame * channels + ch]
    mono[frame] = sum / channels
  }
  return mono
}

function toneEnergy(samples: Float64Array, start: number, length: number, sampleRate: number, freq: number): number {
  const omega = 2 * Math.PI * freq / sampleRate
  const coeff = 2 * Math.cos(omega)
  let q1 = 0, q2 = 0
  for (let i = 0; i < length; i++) {
    const idx = start + i
    const sample = idx < samples.length ? samples[idx] : 0
    const q0 = coeff * q1 - q2 + sample
    q2 = q1
    q1 = q0
  }
  return q1 * q1 + q2 * q2 - coeff * q1 * q2
}

function decodeSymbolBands(
  samples: Float64Array, offset: number, symbolCount: number,
  options: Required<Pick<OfdmDecodeOptions, 'sampleRate' | 'bitSamples' | 'repeats'>>,
  clockRatio = 1,
): number[][] {
  // Returns an array of symbols, each symbol being an array of OFDM_BITS_PER_SYMBOL bits.
  const windowSamples = Math.max(64, Math.round(options.bitSamples * clockRatio))
  const symbols: number[][] = []
  for (let symbol = 0; symbol < symbolCount; symbol++) {
    const symbolBits: number[] = []
    for (let band = 0; band < BAND_FREQS.length; band++) {
      let lowVotes = 0, highVotes = 0
      for (let repeat = 0; repeat < options.repeats; repeat++) {
        const start = offset + Math.round(
          (symbol * options.repeats + repeat) * options.bitSamples * clockRatio,
        )
        const low = toneEnergy(samples, start, windowSamples, options.sampleRate, BAND_FREQS[band][0])
        const high = toneEnergy(samples, start, windowSamples, options.sampleRate, BAND_FREQS[band][1])
        if (high > low) highVotes++; else lowVotes++
      }
      symbolBits.push(highVotes > lowVotes ? 1 : 0)
    }
    symbols.push(symbolBits)
  }
  return symbols
}

/** Majority vote across all 4 bands → 1 bit per symbol. Used for preamble search:
 * if narrowband interference kills one band, the majority of the remaining 3 still
 * carries the (replicated) preamble bit. */
function symbolsToMajorityBits(symbols: number[][]): number[] {
  const out: number[] = []
  for (const sym of symbols) {
    let ones = 0
    for (const b of sym) ones += b
    out.push(ones > sym.length / 2 ? 1 : 0)
  }
  return out
}

/** Per-band flatten → OFDM_BITS_PER_SYMBOL bits per symbol. Used for packet data. */
function symbolsToDataBits(symbols: number[][], fromSymbol: number): number[] {
  const out: number[] = []
  for (let i = fromSymbol; i < symbols.length; i++) {
    for (const b of symbols[i]) out.push(b)
  }
  return out
}

function findPreamble(bits: number[], from = 0): number {
  for (let i = from; i <= bits.length - PREAMBLE_BITS.length; i++) {
    let mismatches = 0
    for (let j = 0; j < PREAMBLE_BITS.length; j++) {
      if (bits[i + j] !== PREAMBLE_BITS[j]) {
        mismatches++
        if (mismatches > PREAMBLE_BIT_TOLERANCE) break
      }
    }
    if (mismatches <= PREAMBLE_BIT_TOLERANCE) return i
  }
  return -1
}

function verifyAndExtract(packet: Uint8Array): Uint8Array | null {
  if (packet.length < 10) return null
  const length = (packet[4] << 8) | packet[5]
  if (length < OFDM_RS_PARITY) return null
  if (packet.length < 10 + length) return null
  const expected = ((packet[6] << 24) | (packet[7] << 16) | (packet[8] << 8) | packet[9]) >>> 0
  const rsEncoded = packet.slice(10, 10 + length)
  let payload: Uint8Array
  try {
    payload = rsDecodeShortened(rsEncoded, OFDM_RS_PARITY)
  } catch {
    return null
  }
  if (crc32(payload) !== expected) return null
  return payload
}

const ERROR_TIERS: Record<string, number> = {
  'OFDM preamble not found': 0,
  'OFDM packet header incomplete': 1,
  'OFDM packet incomplete': 1,
  'OFDM packet magic mismatch': 2,
  'OFDM packet checksum mismatch': 3,
}

export function ofdmDecodePayload(samples: Float64Array, options: OfdmDecodeOptions = {}): Uint8Array {
  const decodeOptions = {
    sampleRate: options.sampleRate ?? OFDM_SAMPLE_RATE,
    bitSamples: options.bitSamples ?? OFDM_BIT_SAMPLES,
    repeats: options.repeats ?? OFDM_REPEATS,
  }
  const mono = maybeDownmix(samples, options.channels ?? 1)
  const symbolSamples = decodeOptions.bitSamples * decodeOptions.repeats
  const clockRatios = [1, 0.996, 0.997, 0.998, 0.999, 1.001, 1.002, 1.003, 1.004]
  const maxSymbolsForRatio = (clockRatio: number) =>
    Math.floor(mono.length / (symbolSamples * clockRatio))
  const offsetStep = Math.max(10, Math.floor(decodeOptions.bitSamples / 49))
  let firstSignal = 0
  while (firstSignal < mono.length && Math.abs(mono[firstSignal]) < 1) firstSignal++
  const alignedSignal = firstSignal % symbolSamples
  const offsets = new Set<number>()
  if (firstSignal < mono.length) {
    for (let delta = -180; delta <= 180; delta += 5) {
      const candidate = alignedSignal + delta
      if (candidate >= 0 && candidate < symbolSamples && candidate < mono.length) offsets.add(candidate)
    }
  } else {
    for (let offset = 0; offset < symbolSamples && offset < mono.length; offset += offsetStep) offsets.add(offset)
  }
  let bestError = 'OFDM preamble not found'
  const recordError = (err: string) => {
    if ((ERROR_TIERS[err] ?? -1) > (ERROR_TIERS[bestError] ?? -1)) bestError = err
  }

  for (const offset of Array.from(offsets).sort((a, b) => a - b)) {
    for (const clockRatio of clockRatios) {
      const maxSymbols = maxSymbolsForRatio(clockRatio)
      const symbols = decodeSymbolBands(mono, offset, maxSymbols, decodeOptions, clockRatio)
      // Preamble search uses majority-vote-per-symbol so a single jammed band
      // doesn't break pattern lock. Data extraction uses per-band bits for
      // OFDM_BITS_PER_SYMBOL throughput.
      const preambleStream = symbolsToMajorityBits(symbols)
      let preambleSymbol = findPreamble(preambleStream)
      while (preambleSymbol >= 0) {
        const dataStartSymbol = preambleSymbol + PREAMBLE_BITS.length
        const bits = symbolsToDataBits(symbols, dataStartSymbol)
        const headerBits = bits.slice(0, 80)
        if (headerBits.length < 80) {
          recordError('OFDM packet header incomplete')
          break
        }
        const header = bitsToBytes(headerBits)
        let magicBitErrors = 0
        for (let i = 0; i < MAGIC.length; i++) {
          let diff = (header[i] ^ MAGIC[i]) & 0xff
          while (diff) { magicBitErrors++; diff &= diff - 1 }
          if (magicBitErrors > MAGIC_BIT_TOLERANCE) break
        }
        if (magicBitErrors > MAGIC_BIT_TOLERANCE) {
          recordError('OFDM packet magic mismatch')
          preambleSymbol = findPreamble(preambleStream, preambleSymbol + 1)
          continue
        }
        const payloadLength = (header[4] << 8) | header[5]
        const totalPacketBits = (10 + payloadLength) * 8
        const packetBits = bits.slice(0, totalPacketBits)
        if (packetBits.length < totalPacketBits) {
          recordError('OFDM packet incomplete')
          break
        }
        const payload = verifyAndExtract(bitsToBytes(packetBits))
        if (payload) return payload
        recordError('OFDM packet checksum mismatch')
        preambleSymbol = findPreamble(preambleStream, preambleSymbol + 1)
      }
    }
  }

  throw new Error(bestError)
}

/**
 * Mix the OFDM carrier additively into a music signal, scaling music down if needed
 * to leave headroom. Same shape as the single-FSK mixCarrier in acoustic.ts.
 */
export function mixOfdmCarrier(
  music: Float64Array,
  carrier: Float64Array,
  options: { carrierHeadroom?: number; maxInt16?: number } = {},
): Float64Array {
  // Headroom budget: peak sum of all 4 tones at full amplitude is 4*PER_TONE = 16000.
  const carrierHeadroom = options.carrierHeadroom ?? PER_TONE_AMPLITUDE * BAND_FREQS.length
  const maxInt16 = options.maxInt16 ?? 32767
  let musicPeak = 0
  for (let i = 0; i < music.length; i++) {
    const a = Math.abs(music[i])
    if (a > musicPeak) musicPeak = a
  }
  const allowedMusicPeak = maxInt16 - carrierHeadroom
  const scale = musicPeak > allowedMusicPeak ? allowedMusicPeak / musicPeak : 1
  const out = new Float64Array(Math.max(music.length, carrier.length))
  for (let i = 0; i < music.length; i++) out[i] = music[i] * scale
  for (let i = 0; i < carrier.length; i++) out[i] += carrier[i]
  return out
}

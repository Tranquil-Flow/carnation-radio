export type AcousticDecodeOptions = {
  sampleRate?: number
  bitSamples?: number
  repeats?: number
  channels?: number
}

import { rsEncodeShortened, rsDecodeShortened, RS_PARITY_BYTES } from './reed-solomon'

export const DEFAULT_SAMPLE_RATE = 44100
export const DEFAULT_BIT_SAMPLES = 735 // 16.67ms at 44.1kHz; 1200Hz=20 cycles, 1800Hz=30 cycles
// 3 repetitions × Reed-Solomon: bit-level redundancy handles raw symbol noise, RS(255,223)
// then corrects up to 16 byte errors per block. 5x rep + RS is robust but adds 40% to WAV
// duration; in practice 3x + RS holds up well at SNR > +5 dB and keeps packets compact.
export const DEFAULT_REPEATS = 3
// Ultrasonic FSK band (18.5 / 19.5 kHz). Above the audible range for most adults
// (~70% of people 25+ can't hear 18 kHz; ~90% can't hear 19 kHz). Below the 22.05 kHz
// Nyquist limit at 44.1 kHz sample rate. Consumer MacBook/iPhone speakers and mics
// reproduce this band cleanly. Cats, dogs, and some children CAN hear it.
const FREQ_ZERO = 18500
const FREQ_ONE = 19500
// Lower amplitude for ultrasonic mixed-with-music mode: we add this signal on top of
// the music waveform, so we need headroom for music peaks. 8000 ≈ -12 dBFS, well above
// the hearing threshold at 18+ kHz for adults but easily resolved by the Goertzel decoder
// at the mic (RMS roughly 25–80 in observed physical tests).
const AMPLITUDE = 8000
const MAGIC = [0x43, 0x52, 0x41, 0x43] // CRAC: Carnation Radio Acoustic Codec
// Allow up to this many bit-mismatches in the 32-bit magic before rejecting. CRC32 on payload
// is the actual integrity check; magic just needs to be "close enough" to confirm packet shape.
const MAGIC_BIT_TOLERANCE = 4
const PREAMBLE_BITS = [
  ...Array.from({ length: 32 }, (_, i) => i % 2),
  1, 1, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0,
]

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let byteIndex = 0; byteIndex < bytes.length; byteIndex++) {
    const byte = bytes[byteIndex]
    crc ^= byte
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
  // Apply shortened RS(255, 223) to the payload — 32 parity bytes appended.
  // The length field below records the FULL RS-coded length (payload + 32).
  const rsEncoded = rsEncodeShortened(payload)
  if (rsEncoded.length > 0xffff) throw new Error('Acoustic payload too long')
  const packet = new Uint8Array(MAGIC.length + 2 + 4 + rsEncoded.length)
  packet.set(MAGIC, 0)
  packet[4] = (rsEncoded.length >> 8) & 0xff
  packet[5] = rsEncoded.length & 0xff
  // CRC32 is computed over the ORIGINAL payload, not the RS-encoded one — that way
  // a successful RS-decode followed by CRC match cross-validates both layers.
  const checksum = crc32(payload)
  packet[6] = (checksum >>> 24) & 0xff
  packet[7] = (checksum >>> 16) & 0xff
  packet[8] = (checksum >>> 8) & 0xff
  packet[9] = checksum & 0xff
  packet.set(rsEncoded, 10)
  return packet
}

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
  let q0 = 0
  let q1 = 0
  let q2 = 0
  for (let i = 0; i < length; i++) {
    const idx = start + i
    const sample = idx < samples.length ? samples[idx] : 0
    q0 = coeff * q1 - q2 + sample
    q2 = q1
    q1 = q0
  }
  return q1 * q1 + q2 * q2 - coeff * q1 * q2
}

function decodeToneBit(samples: Float64Array, start: number, bitSamples: number, sampleRate: number): number {
  const zero = toneEnergy(samples, start, bitSamples, sampleRate, FREQ_ZERO)
  const one = toneEnergy(samples, start, bitSamples, sampleRate, FREQ_ONE)
  return one > zero ? 1 : 0
}

function decodeSymbolBits(samples: Float64Array, offset: number, symbolCount: number, options: Required<Pick<AcousticDecodeOptions, 'sampleRate' | 'bitSamples' | 'repeats'>>, clockRatio = 1): number[] {
  const bits: number[] = []
  const windowSamples = Math.max(64, Math.round(options.bitSamples * clockRatio))
  for (let symbol = 0; symbol < symbolCount; symbol++) {
    let votes = 0
    for (let repeat = 0; repeat < options.repeats; repeat++) {
      const start = offset + Math.round((symbol * options.repeats + repeat) * options.bitSamples * clockRatio)
      votes += decodeToneBit(samples, start, windowSamples, options.sampleRate)
    }
    bits.push(votes > options.repeats / 2 ? 1 : 0)
  }
  return bits
}

function findPreamble(bits: number[], from = 0): number {
  outer: for (let i = from; i <= bits.length - PREAMBLE_BITS.length; i++) {
    for (let j = 0; j < PREAMBLE_BITS.length; j++) {
      if (bits[i + j] !== PREAMBLE_BITS[j]) continue outer
    }
    return i
  }
  return -1
}

function verifyAndExtract(packet: Uint8Array): Uint8Array | null {
  if (packet.length < 10) return null
  // Magic byte check is intentionally lenient here — the per-iteration tolerant check
  // in acousticDecodePayload already filtered, so packet has the right shape.
  const length = (packet[4] << 8) | packet[5]
  if (length < RS_PARITY_BYTES) return null
  if (packet.length < 10 + length) return null
  const expected = ((packet[6] << 24) | (packet[7] << 16) | (packet[8] << 8) | packet[9]) >>> 0
  const rsEncoded = packet.slice(10, 10 + length)
  // Run RS decode to correct up to 16 byte errors. Failures throw — caller treats as null.
  let payload: Uint8Array
  try {
    payload = rsDecodeShortened(rsEncoded)
  } catch {
    return null
  }
  if (crc32(payload) !== expected) return null
  return payload
}

/**
 * Mixes the FSK carrier additively into a music signal. Music is scaled down if needed
 * so peak(music) + peak(carrier) stays under int16 range. Output is the longer of the
 * two; if the carrier extends past the music, trailing carrier samples are emitted with
 * silence as the music portion (and vice versa).
 *
 * Use this together with acousticEncodePayload to produce a song with a barely-audible
 * ultrasonic data signal added on top — the human listener hears music; the decoder
 * hears the FSK at 18.5/19.5 kHz.
 */
export function mixCarrier(
  music: Float64Array,
  carrier: Float64Array,
  options: { carrierHeadroom?: number; maxInt16?: number } = {},
): Float64Array {
  const carrierHeadroom = options.carrierHeadroom ?? AMPLITUDE
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

export function acousticEncodePayload(payload: Uint8Array, options: AcousticDecodeOptions = {}): Float64Array {
  const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE
  const bitSamples = options.bitSamples ?? DEFAULT_BIT_SAMPLES
  const repeats = options.repeats ?? DEFAULT_REPEATS
  const packetBits = bytesToBits(buildPacket(payload))
  const bits = [...PREAMBLE_BITS, ...packetBits]
  const samples = new Float64Array(bits.length * repeats * bitSamples)

  for (let symbol = 0; symbol < bits.length; symbol++) {
    const freq = bits[symbol] ? FREQ_ONE : FREQ_ZERO
    for (let repeat = 0; repeat < repeats; repeat++) {
      const start = (symbol * repeats + repeat) * bitSamples
      for (let i = 0; i < bitSamples; i++) {
        const phase = 2 * Math.PI * freq * i / sampleRate
        // Short raised-cosine edges reduce clicks while keeping bit energy concentrated.
        const edge = Math.min(1, i / 80, (bitSamples - 1 - i) / 80)
        samples[start + i] = Math.sin(phase) * AMPLITUDE * Math.max(0, edge)
      }
    }
  }
  return samples
}

// Higher tier = more useful diagnostic, kept in preference to lower-tier errors.
// 0: nothing detected → preamble not found
// 1: short packet/incomplete data
// 2: preamble matched some garbage → magic mismatch
// 3: preamble + magic + length all decoded, but payload corrupted → checksum mismatch
const ERROR_TIERS: Record<string, number> = {
  'Acoustic preamble not found': 0,
  'Acoustic packet header incomplete': 1,
  'Acoustic packet incomplete': 1,
  'Acoustic packet magic mismatch': 2,
  'Acoustic packet checksum mismatch': 3,
}

export function acousticDecodePayload(samples: Float64Array, options: AcousticDecodeOptions = {}): Uint8Array {
  const decodeOptions = {
    sampleRate: options.sampleRate ?? DEFAULT_SAMPLE_RATE,
    bitSamples: options.bitSamples ?? DEFAULT_BIT_SAMPLES,
    repeats: options.repeats ?? DEFAULT_REPEATS,
  }
  const mono = maybeDownmix(samples, options.channels ?? 1)
  const symbolSamples = decodeOptions.bitSamples * decodeOptions.repeats
  const clockRatios = [
    1,
    0.996, 0.997, 0.998, 0.999,
    1.001, 1.002, 1.003, 1.004,
  ]
  const maxSymbolsForRatio = (clockRatio: number) => Math.floor(mono.length / (symbolSamples * clockRatio))
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
  let bestError = 'Acoustic preamble not found'
  const recordError = (err: string) => {
    if ((ERROR_TIERS[err] ?? -1) > (ERROR_TIERS[bestError] ?? -1)) bestError = err
  }

  for (const offset of Array.from(offsets).sort((a, b) => a - b)) {
    for (const clockRatio of clockRatios) {
      const maxSymbols = maxSymbolsForRatio(clockRatio)
      const bits = decodeSymbolBits(mono, offset, maxSymbols, decodeOptions, clockRatio)
      let preambleAt = findPreamble(bits)
      while (preambleAt >= 0) {
        const packetStart = preambleAt + PREAMBLE_BITS.length
        const headerBits = bits.slice(packetStart, packetStart + 80)
        if (headerBits.length < 80) {
          recordError('Acoustic packet header incomplete')
          break
        }
        const header = bitsToBytes(headerBits)
        // Hamming distance over the 32-bit magic. Allow up to MAGIC_BIT_TOLERANCE flips:
        // CRC32 on the payload is the real integrity check, magic just confirms packet shape.
        let magicBitErrors = 0
        for (let i = 0; i < MAGIC.length; i++) {
          let diff = (header[i] ^ MAGIC[i]) & 0xff
          while (diff) { magicBitErrors++; diff &= diff - 1 }
          if (magicBitErrors > MAGIC_BIT_TOLERANCE) break
        }
        if (magicBitErrors > MAGIC_BIT_TOLERANCE) {
          recordError('Acoustic packet magic mismatch')
          preambleAt = findPreamble(bits, preambleAt + 1)
          continue
        }
        const payloadLength = (header[4] << 8) | header[5]
        const totalPacketBits = (10 + payloadLength) * 8
        const packetBits = bits.slice(packetStart, packetStart + totalPacketBits)
        if (packetBits.length < totalPacketBits) {
          recordError('Acoustic packet incomplete')
          break
        }
        const payload = verifyAndExtract(bitsToBytes(packetBits))
        if (payload) return payload
        recordError('Acoustic packet checksum mismatch')
        preambleAt = findPreamble(bits, preambleAt + 1)
      }
    }
  }

  throw new Error(bestError)
}

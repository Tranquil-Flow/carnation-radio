export type AcousticDecodeOptions = {
  sampleRate?: number
  bitSamples?: number
  repeats?: number
  channels?: number
}

const DEFAULT_SAMPLE_RATE = 44100
const DEFAULT_BIT_SAMPLES = 735 // 16.67ms at 44.1kHz; 1200Hz=20 cycles, 1800Hz=30 cycles
const DEFAULT_REPEATS = 3
const FREQ_ZERO = 1200
const FREQ_ONE = 1800
const AMPLITUDE = 9000
const MAGIC = [0x43, 0x52, 0x41, 0x43] // CRAC: Carnation Radio Acoustic Codec
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
  if (payload.length > 0xffff) throw new Error('Acoustic payload too long')
  const packet = new Uint8Array(MAGIC.length + 2 + 4 + payload.length)
  packet.set(MAGIC, 0)
  packet[4] = (payload.length >> 8) & 0xff
  packet[5] = payload.length & 0xff
  const checksum = crc32(payload)
  packet[6] = (checksum >>> 24) & 0xff
  packet[7] = (checksum >>> 16) & 0xff
  packet[8] = (checksum >>> 8) & 0xff
  packet[9] = checksum & 0xff
  packet.set(payload, 10)
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
  for (let i = 0; i < MAGIC.length; i++) if (packet[i] !== MAGIC[i]) return null
  const length = (packet[4] << 8) | packet[5]
  if (packet.length < 10 + length) return null
  const expected = ((packet[6] << 24) | (packet[7] << 16) | (packet[8] << 8) | packet[9]) >>> 0
  const payload = packet.slice(10, 10 + length)
  if (crc32(payload) !== expected) return null
  return payload
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

  for (const offset of Array.from(offsets).sort((a, b) => a - b)) {
    for (const clockRatio of clockRatios) {
      const maxSymbols = maxSymbolsForRatio(clockRatio)
      const bits = decodeSymbolBits(mono, offset, maxSymbols, decodeOptions, clockRatio)
      let preambleAt = findPreamble(bits)
      while (preambleAt >= 0) {
        const packetStart = preambleAt + PREAMBLE_BITS.length
        const headerBits = bits.slice(packetStart, packetStart + 80)
        if (headerBits.length < 80) {
          bestError = 'Acoustic packet header incomplete'
          break
        }
        const header = bitsToBytes(headerBits)
        let magicMatches = true
        for (let i = 0; i < MAGIC.length; i++) {
          if (header[i] !== MAGIC[i]) {
            magicMatches = false
            break
          }
        }
        if (!magicMatches) {
          bestError = 'Acoustic packet magic mismatch'
          preambleAt = findPreamble(bits, preambleAt + 1)
          continue
        }
        const payloadLength = (header[4] << 8) | header[5]
        const totalPacketBits = (10 + payloadLength) * 8
        const packetBits = bits.slice(packetStart, packetStart + totalPacketBits)
        if (packetBits.length < totalPacketBits) {
          bestError = 'Acoustic packet incomplete'
          break
        }
        const payload = verifyAndExtract(bitsToBytes(packetBits))
        if (payload) return payload
        bestError = 'Acoustic packet checksum mismatch'
        preambleAt = findPreamble(bits, preambleAt + 1)
      }
    }
  }

  throw new Error(bestError)
}

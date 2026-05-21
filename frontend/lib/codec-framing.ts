/**
 * Shared wire-format primitives for Carnation Radio's TS acoustic codecs.
 *
 * Both the OFDM codec (acoustic-ofdm.ts) and the psychoacoustic-masked codec
 * (acoustic-masked.ts) put bytes on the wire using the same envelope:
 *
 *   MAGIC (4) || length (2 BE) || crc32 (4 BE) || RS-encoded payload (length)
 *
 * Only the bit-to-audio mapping differs between codecs. By centralizing the
 * envelope here, decoded bytes are codec-agnostic — the same `detectVersion`,
 * `walletDecrypt`, etc. consume the output of whichever modulation actually
 * carried the packet.
 *
 * The preamble bit sequence is also shared so codecs that produce different
 * carrier audio (e.g. masked-spectrum payload) can still emit and look for the
 * same canonical "this is a Carnation packet" prefix in whatever modulation
 * domain they choose.
 */

import { rsEncodeShortened, rsDecodeShortened } from './reed-solomon'

/** "CRAC" — same on-air magic across all Carnation acoustic codecs. */
export const MAGIC = [0x43, 0x52, 0x41, 0x43] as const

/** How many bit errors we tolerate in the 32-bit MAGIC after demod (per codec). */
export const MAGIC_BIT_TOLERANCE = 4

/**
 * Preamble bit pattern transmitted ahead of every packet. 32 bits of
 * alternating 0/1 (squarewave for clock recovery) followed by a 16-bit Barker-
 * like sync word. Total length = 48 bits.
 */
export const PREAMBLE_BITS: ReadonlyArray<number> = [
  ...Array.from({ length: 32 }, (_, i) => i % 2),
  1, 1, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0,
]

/** How many of the 48 preamble bits may differ from the canonical pattern. */
export const PREAMBLE_BIT_TOLERANCE = 6

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let byteIndex = 0; byteIndex < bytes.length; byteIndex++) {
    crc ^= bytes[byteIndex]
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

export function bytesToBits(bytes: Uint8Array): number[] {
  const bits: number[] = []
  for (let byteIndex = 0; byteIndex < bytes.length; byteIndex++) {
    const byte = bytes[byteIndex]
    for (let bit = 7; bit >= 0; bit--) bits.push((byte >> bit) & 1)
  }
  return bits
}

export function bitsToBytes(bits: number[]): Uint8Array {
  const bytes = new Uint8Array(Math.floor(bits.length / 8))
  for (let i = 0; i < bytes.length; i++) {
    let value = 0
    for (let bit = 0; bit < 8; bit++) value = (value << 1) | (bits[i * 8 + bit] & 1)
    bytes[i] = value
  }
  return bytes
}

/**
 * Build a Carnation acoustic packet: MAGIC + length + CRC32 + RS-encoded
 * payload. The RS parity-byte count is codec-specific (32 for light, 128 for
 * heavy), so the caller passes it in.
 */
export function buildPacket(payload: Uint8Array, parityBytes: number): Uint8Array {
  const rsEncoded = rsEncodeShortened(payload, parityBytes)
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

/**
 * Parse a candidate packet (assumed to start at MAGIC). Returns the inner
 * payload bytes on success, or null on any structural / CRC / RS-decode failure.
 */
export function verifyAndExtract(packet: Uint8Array, parityBytes: number): Uint8Array | null {
  if (packet.length < 10) return null
  const length = (packet[4] << 8) | packet[5]
  if (length < parityBytes) return null
  if (packet.length < 10 + length) return null
  const expected = ((packet[6] << 24) | (packet[7] << 16) | (packet[8] << 8) | packet[9]) >>> 0
  const rsEncoded = packet.slice(10, 10 + length)
  let payload: Uint8Array
  try {
    payload = rsDecodeShortened(rsEncoded, parityBytes)
  } catch {
    return null
  }
  if (crc32(payload) !== expected) return null
  return payload
}

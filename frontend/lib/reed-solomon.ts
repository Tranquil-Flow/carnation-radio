/**
 * Reed-Solomon ECC wrapper over the `reedsolomon` package (ZXing port).
 * Provides shortened RS(255, 223) encoding: 32 parity bytes appended to arbitrary-length
 * data (data.length <= 223). Up to 16 byte errors anywhere in the encoded block can be
 * corrected.
 */

// @ts-expect-error — reedsolomon ships CommonJS without type declarations
import { ReedSolomonEncoder, ReedSolomonDecoder, GenericGF } from 'reedsolomon'

// Standard parity for single-FSK / patchwork (~12.5% byte error correction).
export const RS_PARITY_BYTES = 32
// Heavy parity for OFDM / chaotic environments (~25% byte error correction).
// Used when the channel is expected to deliver 20-25% byte error rate from
// broadband noise hitting all OFDM bands at once.
export const RS_PARITY_BYTES_HEAVY = 128
const RS_N = 255
const FIELD = GenericGF.QR_CODE_FIELD_256()
const ENCODER = new ReedSolomonEncoder(FIELD)
const DECODER = new ReedSolomonDecoder(FIELD)

function maxData(parityBytes: number): number {
  return RS_N - parityBytes
}

export function rsEncodeShortened(data: Uint8Array, parityBytes = RS_PARITY_BYTES): Uint8Array {
  const maxK = maxData(parityBytes)
  if (data.length > maxK) {
    throw new Error(`Payload too large for one RS(${RS_N}, ${maxK}) block (${data.length} > ${maxK})`)
  }
  const buf = new Int32Array(data.length + parityBytes)
  for (let i = 0; i < data.length; i++) buf[i] = data[i]
  ENCODER.encode(buf, parityBytes)
  const out = new Uint8Array(data.length + parityBytes)
  for (let i = 0; i < out.length; i++) out[i] = buf[i] & 0xff
  return out
}

export function rsDecodeShortened(input: Uint8Array, parityBytes = RS_PARITY_BYTES): Uint8Array {
  if (input.length < parityBytes + 1) {
    throw new Error(`RS input too short (${input.length} < ${parityBytes + 1})`)
  }
  const buf = new Int32Array(input.length)
  for (let i = 0; i < input.length; i++) buf[i] = input[i]
  DECODER.decode(buf, parityBytes)
  const dataLen = input.length - parityBytes
  const out = new Uint8Array(dataLen)
  for (let i = 0; i < dataLen; i++) out[i] = buf[i] & 0xff
  return out
}

/**
 * Reed-Solomon ECC wrapper over the `reedsolomon` package (ZXing port).
 * Provides shortened RS(255, 223) encoding: 32 parity bytes appended to arbitrary-length
 * data (data.length <= 223). Up to 16 byte errors anywhere in the encoded block can be
 * corrected.
 */

// @ts-expect-error — reedsolomon ships CommonJS without type declarations
import { ReedSolomonEncoder, ReedSolomonDecoder, GenericGF } from 'reedsolomon'

export const RS_PARITY_BYTES = 32
const RS_K = 223
const FIELD = GenericGF.QR_CODE_FIELD_256()
const ENCODER = new ReedSolomonEncoder(FIELD)
const DECODER = new ReedSolomonDecoder(FIELD)

export function rsEncodeShortened(data: Uint8Array): Uint8Array {
  if (data.length > RS_K) {
    throw new Error(`Payload too large for one RS block (${data.length} > ${RS_K})`)
  }
  const buf = new Int32Array(data.length + RS_PARITY_BYTES)
  for (let i = 0; i < data.length; i++) buf[i] = data[i]
  ENCODER.encode(buf, RS_PARITY_BYTES)
  const out = new Uint8Array(data.length + RS_PARITY_BYTES)
  for (let i = 0; i < out.length; i++) out[i] = buf[i] & 0xff
  return out
}

export function rsDecodeShortened(input: Uint8Array): Uint8Array {
  if (input.length < RS_PARITY_BYTES + 1) {
    throw new Error(`RS input too short (${input.length} < ${RS_PARITY_BYTES + 1})`)
  }
  const buf = new Int32Array(input.length)
  for (let i = 0; i < input.length; i++) buf[i] = input[i]
  DECODER.decode(buf, RS_PARITY_BYTES)
  const dataLen = input.length - RS_PARITY_BYTES
  const out = new Uint8Array(dataLen)
  for (let i = 0; i < dataLen; i++) out[i] = buf[i] & 0xff
  return out
}

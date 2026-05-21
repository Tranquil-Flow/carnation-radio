import { getAddress } from 'viem'

export const VERSION = {
  LEGACY: 'legacy',
  PASSWORD_REPETITION: 'password_repetition',
  WALLET_REPETITION: 'wallet_repetition',
  PASSWORD_BCH: 'password_bch',
  WALLET_BCH: 'wallet_bch',
  CLAIM: 'claim',
} as const

export type VersionType = typeof VERSION[keyof typeof VERSION]

const VERSION_MAP: Record<number, VersionType> = {
  0x01: VERSION.PASSWORD_REPETITION,
  0x02: VERSION.WALLET_REPETITION,
  0x03: VERSION.CLAIM,
  0x11: VERSION.PASSWORD_BCH,
  0x12: VERSION.WALLET_BCH,
}

export function detectVersion(payload: Uint8Array): { version: VersionType; data: Uint8Array } {
  if (payload.length === 0) throw new Error('Empty payload')
  const version = VERSION_MAP[payload[0]]
  if (version) return { version, data: payload.slice(1) }
  return { version: VERSION.LEGACY, data: payload }
}

export function isPasswordMode(version: VersionType): boolean {
  return version === VERSION.LEGACY ||
         version === VERSION.PASSWORD_REPETITION ||
         version === VERSION.PASSWORD_BCH
}

export function isClaimMode(version: VersionType): boolean {
  return version === VERSION.CLAIM
}

/**
 * Parse a CLAIM payload (version byte already stripped by detectVersion).
 *
 * Wire layout (after 0x03 version byte):
 *   [recipientAddress: 20 bytes] [nonce: 12 bytes] [ciphertext + GCM tag: rest]
 *
 * @param data - Payload bytes with the version byte removed.
 * @returns Parsed fields: checksummed recipient address, AES-GCM nonce, ciphertext+tag.
 */
export function parseClaimPayload(data: Uint8Array): {
  recipientAddress: string
  nonce: Uint8Array
  ciphertext: Uint8Array
} {
  const ADDRESS_SIZE = 20
  const NONCE_SIZE = 12
  const TAG_SIZE = 16
  const MIN_SIZE = ADDRESS_SIZE + NONCE_SIZE + TAG_SIZE

  if (data.length < MIN_SIZE) {
    throw new Error(
      `CLAIM payload too short: expected at least ${MIN_SIZE} bytes, got ${data.length}`,
    )
  }

  // First 20 bytes → Ethereum address with EIP-55 checksum
  const addrBytes = data.slice(0, ADDRESS_SIZE)
  const addrHex = `0x${Array.from(addrBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}` as `0x${string}`
  const recipientAddress = getAddress(addrHex)

  // Next 12 bytes → AES-GCM nonce
  const nonce = data.slice(ADDRESS_SIZE, ADDRESS_SIZE + NONCE_SIZE)

  // Remainder → ciphertext (includes 16-byte GCM tag appended by SubtleCrypto)
  const ciphertext = data.slice(ADDRESS_SIZE + NONCE_SIZE)

  return { recipientAddress, nonce, ciphertext }
}

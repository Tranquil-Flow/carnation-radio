export const VERSION = {
  LEGACY: 'legacy',
  PASSWORD_REPETITION: 'password_repetition',
  WALLET_REPETITION: 'wallet_repetition',
  PASSWORD_BCH: 'password_bch',
  WALLET_BCH: 'wallet_bch',
} as const

export type VersionType = typeof VERSION[keyof typeof VERSION]

const VERSION_MAP: Record<number, VersionType> = {
  0x01: VERSION.PASSWORD_REPETITION,
  0x02: VERSION.WALLET_REPETITION,
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

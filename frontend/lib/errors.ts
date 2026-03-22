/**
 * Convert technical stego/encode errors into user-friendly messages.
 * Returns a short message and optional technical details.
 */
export function formatEncodeError(raw: string): { message: string; details: string | null } {
  // "Message too long: need X bit slots but only Y available (Z frames x 6 pairs). Max message: ~N bytes"
  const tooLongMatch = raw.match(/Message too long.*Max message: ~(\d+) bytes/)
  if (tooLongMatch) {
    const maxBytes = parseInt(tooLongMatch[1], 10)
    if (maxBytes <= 0) {
      return {
        message: 'This audio file is too short to hide a message. Use a longer track (at least 30 seconds).',
        details: raw,
      }
    }
    return {
      message: `Your message is too long for this audio file. Maximum ~${maxBytes} characters. Use a longer track or a shorter message.`,
      details: raw,
    }
  }

  // Wallet-mode payload too short
  if (raw.includes('Wallet-mode payload too short')) {
    return {
      message: 'Could not decrypt — the file may not contain a wallet-mode message, or the wrong wallet is connected.',
      details: raw,
    }
  }

  // AES-GCM decryption failure (wrong key)
  if (raw.includes('OperationError') || raw.includes('The operation failed')) {
    return {
      message: 'Decryption failed — wrong passphrase or wallet, or the file does not contain a hidden message.',
      details: raw,
    }
  }

  // Generic fallback
  return { message: raw, details: null }
}

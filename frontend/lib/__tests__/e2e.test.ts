import { describe, it, expect } from 'vitest'
import { encryptMessage, decryptMessage } from '../crypto'
import { detectVersion, VERSION } from '../wire'
import cryptoVector from '../../../carnation-stego/testdata/crypto_vector.json'

describe('e2e pipeline', () => {
  it('encrypt + version prefix + decrypt', async () => {
    const message = new TextEncoder().encode('End-to-end test!')
    const passphrase = 'test-pass'

    const encrypted = await encryptMessage(message, passphrase)
    const payload = new Uint8Array(1 + encrypted.length)
    payload[0] = 0x01
    payload.set(encrypted, 1)

    const parsed = detectVersion(payload)
    expect(parsed.version).toBe(VERSION.PASSWORD_REPETITION)

    const decrypted = await decryptMessage(parsed.data, passphrase)
    expect(new TextDecoder().decode(decrypted)).toBe('End-to-end test!')
  })

  it('decrypts Python-encrypted ciphertext', async () => {
    const ciphertext = Uint8Array.from(
      cryptoVector.ciphertext_hex.match(/.{2}/g)!.map((b: string) => parseInt(b, 16))
    )
    const decrypted = await decryptMessage(ciphertext, cryptoVector.passphrase)
    expect(new TextDecoder().decode(decrypted)).toBe(cryptoVector.plaintext)
  })
})

import { describe, it, expect } from 'vitest'
import { encryptMessage, decryptMessage } from '../crypto'

describe('crypto', () => {
  it('round-trips encrypt and decrypt', async () => {
    const message = new TextEncoder().encode('Hello, Carnation!')
    const passphrase = 'test-password-123'
    const encrypted = await encryptMessage(message, passphrase)
    const decrypted = await decryptMessage(encrypted, passphrase)
    expect(new TextDecoder().decode(decrypted)).toBe('Hello, Carnation!')
  })

  it('wrong passphrase fails', async () => {
    const message = new TextEncoder().encode('Secret')
    const encrypted = await encryptMessage(message, 'right-key')
    await expect(decryptMessage(encrypted, 'wrong-key')).rejects.toThrow()
  })

  it('produces correct wire format length', async () => {
    const message = new TextEncoder().encode('test')
    const encrypted = await encryptMessage(message, 'password')
    // salt(16) + nonce(16) + tag(16) + ciphertext(4) = 52
    expect(encrypted.byteLength).toBe(52)
  })
})

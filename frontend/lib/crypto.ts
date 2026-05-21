import { scrypt } from '@noble/hashes/scrypt.js'

const SALT_SIZE = 16
const NONCE_SIZE = 16
const TAG_SIZE = 16
const SCRYPT_N = 2 ** 14
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_SIZE = 32

export function deriveKey(passphrase: string, salt: Uint8Array): Uint8Array {
  return scrypt(new TextEncoder().encode(passphrase), salt, {
    N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, dkLen: KEY_SIZE,
  })
}

export async function encryptMessage(plaintext: Uint8Array, passphrase: string): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_SIZE))
  const keyBytes = deriveKey(passphrase, salt)
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_SIZE))

  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt'])
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: 128 },
    key, plaintext,
  )
  const encArr = new Uint8Array(encrypted)

  // Web Crypto appends tag. Rearrange to: salt + nonce + tag + ciphertext
  const ciphertext = encArr.slice(0, encArr.length - TAG_SIZE)
  const tag = encArr.slice(encArr.length - TAG_SIZE)

  const result = new Uint8Array(SALT_SIZE + NONCE_SIZE + TAG_SIZE + ciphertext.length)
  result.set(salt, 0)
  result.set(nonce, SALT_SIZE)
  result.set(tag, SALT_SIZE + NONCE_SIZE)
  result.set(ciphertext, SALT_SIZE + NONCE_SIZE + TAG_SIZE)
  return result
}

export async function decryptMessage(payload: Uint8Array, passphrase: string): Promise<Uint8Array> {
  if (payload.length < SALT_SIZE + NONCE_SIZE + TAG_SIZE)
    throw new Error('Payload too short')

  const salt = payload.slice(0, SALT_SIZE)
  const nonce = payload.slice(SALT_SIZE, SALT_SIZE + NONCE_SIZE)
  const tag = payload.slice(SALT_SIZE + NONCE_SIZE, SALT_SIZE + NONCE_SIZE + TAG_SIZE)
  const ciphertext = payload.slice(SALT_SIZE + NONCE_SIZE + TAG_SIZE)

  const keyBytes = deriveKey(passphrase, salt)
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt'])

  // Web Crypto expects tag appended to ciphertext
  const combined = new Uint8Array(ciphertext.length + TAG_SIZE)
  combined.set(ciphertext)
  combined.set(tag, ciphertext.length)

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: 128 },
    key, combined,
  )
  return new Uint8Array(decrypted)
}

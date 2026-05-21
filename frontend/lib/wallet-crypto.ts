/**
 * Wallet-mode encryption: ECDH key agreement with signature-derived keypairs.
 *
 * Flow:
 * 1. Both parties sign canonical message → SHA-256(signature) → secp256k1 private key
 * 2. Sender: ECDH(sender_derived_priv, recipient_derived_pub) → shared secret
 * 3. Recipient: ECDH(recipient_derived_priv, sender_derived_pub) → same shared secret
 * 4. Shared secret → AES-256-GCM key
 *
 * Payload format: [sender_compressed_pub: 33 bytes] [nonce: 12] [ciphertext + tag]
 * Total overhead: 33 + 12 + 16 (tag) = 61 bytes
 */
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { secp256k1 } from '@noble/curves/secp256k1'

/**
 * Canonical message signed by the user's wallet to derive their Carnation Radio keypair.
 *
 * This is deterministic via RFC 6979 — the same wallet will always produce the same
 * signature for this message, which means the same derived secp256k1 keypair every time.
 * The signature never leaves the device. No transaction is created.
 */
export const CARNATION_DERIVE_MESSAGE = `Carnation Radio: derive encryption identity

Sign this to generate your Carnation Radio public key.
This signature is used locally and never leaves your device.`

/** @deprecated Use CARNATION_DERIVE_MESSAGE instead */
export const WALLET_SIGN_MESSAGE = CARNATION_DERIVE_MESSAGE

const SENDER_PUB_SIZE = 33 // compressed secp256k1 public key
const NONCE_SIZE = 12       // AES-GCM standard nonce
const TAG_SIZE = 16         // AES-GCM tag

/** Total bytes added by wallet-mode encryption (sender pub + nonce + tag). */
export const WALLET_OVERHEAD = SENDER_PUB_SIZE + NONCE_SIZE + TAG_SIZE // 61

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(h.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(h.substr(i * 2, 2), 16)
  }
  return bytes
}

/**
 * Derive a secp256k1 private key from a wallet signature.
 * Deterministic: same wallet + same message → same key (RFC 6979).
 */
export function derivePrivateKeyHex(signature: string): string {
  return bytesToHex(sha256(hexToBytes(signature)))
}

/**
 * Get the compressed secp256k1 public key for a private key.
 * This is the "Carnation Radio ID" that recipients share with senders.
 */
export function getPublicKeyHex(privateKeyHex: string): string {
  return bytesToHex(secp256k1.getPublicKey(hexToBytes(privateKeyHex), true))
}

/**
 * Compute ECDH shared secret from my private key and their public key.
 * Returns a 32-byte AES key (SHA-256 of the shared point).
 */
function ecdhSharedKey(myPrivHex: string, theirPubHex: string): Uint8Array {
  const sharedPoint = secp256k1.getSharedSecret(
    hexToBytes(myPrivHex),
    hexToBytes(theirPubHex),
  )
  return sha256(sharedPoint)
}

/**
 * Encrypt a message for a recipient using ECDH + AES-256-GCM.
 * Returns packed payload: [sender_pub: 33] [nonce: 12] [ciphertext + tag]
 */
export async function walletEncrypt(
  senderPrivHex: string,
  senderPubHex: string,
  recipientPubHex: string,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const aesKey = ecdhSharedKey(senderPrivHex, recipientPubHex)

  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_SIZE))
  const cryptoKey = await crypto.subtle.importKey('raw', aesKey, 'AES-GCM', false, ['encrypt'])
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: 128 },
    cryptoKey, plaintext,
  )

  const senderPubBytes = hexToBytes(senderPubHex)
  const encryptedBytes = new Uint8Array(encrypted)

  // Pack: sender_pub (33) + nonce (12) + ciphertext+tag
  const result = new Uint8Array(SENDER_PUB_SIZE + NONCE_SIZE + encryptedBytes.length)
  result.set(senderPubBytes, 0)
  result.set(nonce, SENDER_PUB_SIZE)
  result.set(encryptedBytes, SENDER_PUB_SIZE + NONCE_SIZE)
  return result
}

/**
 * Decrypt a wallet-mode payload using ECDH + AES-256-GCM.
 * Extracts sender's public key from payload, computes shared secret, decrypts.
 */
export async function walletDecrypt(
  recipientPrivHex: string,
  payload: Uint8Array,
): Promise<Uint8Array> {
  if (payload.length < SENDER_PUB_SIZE + NONCE_SIZE + TAG_SIZE) {
    throw new Error('Wallet-mode payload too short')
  }

  const senderPubHex = bytesToHex(payload.slice(0, SENDER_PUB_SIZE))
  const nonce = payload.slice(SENDER_PUB_SIZE, SENDER_PUB_SIZE + NONCE_SIZE)
  const ciphertextAndTag = payload.slice(SENDER_PUB_SIZE + NONCE_SIZE)

  const aesKey = ecdhSharedKey(recipientPrivHex, senderPubHex)

  const cryptoKey = await crypto.subtle.importKey('raw', aesKey, 'AES-GCM', false, ['decrypt'])
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: 128 },
    cryptoKey, ciphertextAndTag,
  )
  return new Uint8Array(decrypted)
}

/**
 * Validate a Carnation Radio public key (compressed secp256k1, 33 bytes).
 */
export function isValidPubKey(hex: string): boolean {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  if (clean.length !== 66 || !/^[0-9a-fA-F]+$/.test(clean)) return false
  return clean.startsWith('02') || clean.startsWith('03')
}

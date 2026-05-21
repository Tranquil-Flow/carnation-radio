import { lookupRegistry } from './registry'
import { walletEncrypt } from './wallet-crypto'
import { getAddress } from 'viem'

const CLAIM_NONCE_SIZE = 12
const RECIPIENT_ADDR_SIZE = 20

/**
 * Encrypt a message to a recipient address.
 *
 * Mode A (Direct): If recipient is registered in CarnationRegistry,
 * uses ECDH with their derived pubkey. No claim link needed.
 *
 * Mode B (Claim): If recipient is NOT registered, generates a random
 * AES-256-GCM key and creates a claim link containing the key in the
 * URL fragment (never sent to any server).
 *
 * @returns payload (Uint8Array to embed in audio) and claimLink (string or null)
 */
export async function encryptToAddress(
  recipientAddress: string,
  message: Uint8Array,
  senderPrivHex: string,
  senderPubHex: string,
): Promise<{ payload: Uint8Array; claimLink: string | null }> {
  const checksumAddr = getAddress(recipientAddress)

  // 1. Check registry for recipient's derived pubkey
  const derivedPubkey = await lookupRegistry(checksumAddr)

  if (derivedPubkey) {
    // Mode A — Direct ECDH
    // walletEncrypt prepends sender pub (33 bytes) + nonce (12) + ciphertext+tag
    const innerPayload = await walletEncrypt(senderPrivHex, senderPubHex, derivedPubkey, message)

    // Prepend version byte 0x02 (WALLET_REPETITION/ECDH)
    const payload = new Uint8Array(1 + innerPayload.length)
    payload[0] = 0x02
    payload.set(innerPayload, 1)

    return { payload, claimLink: null }
  }

  // Mode B — Ephemeral/Claim
  // Generate random 32-byte AES key
  const aesKey = crypto.getRandomValues(new Uint8Array(32))
  const nonce = crypto.getRandomValues(new Uint8Array(CLAIM_NONCE_SIZE))

  // AES-256-GCM encrypt
  const cryptoKey = await crypto.subtle.importKey('raw', aesKey, 'AES-GCM', false, ['encrypt'])
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: 128 },
    cryptoKey,
    message,
  )
  const ciphertextAndTag = new Uint8Array(encrypted)

  // Build payload: [version: 1 = 0x03] [recipientAddress: 20] [nonce: 12] [ciphertext+tag]
  const addrBytes = hexToBytes(checksumAddr) // 20 bytes
  const payload = new Uint8Array(
    1 + RECIPIENT_ADDR_SIZE + CLAIM_NONCE_SIZE + ciphertextAndTag.length,
  )
  payload[0] = 0x03 // VERSION.CLAIM
  payload.set(addrBytes, 1)
  payload.set(nonce, 1 + RECIPIENT_ADDR_SIZE)
  payload.set(ciphertextAndTag, 1 + RECIPIENT_ADDR_SIZE + CLAIM_NONCE_SIZE)

  // Generate claim link — key in URL fragment, never hits server
  const keyBase64 = base64urlEncode(aesKey)
  const claimLink = `https://carnation.radio/#claim&key=${keyBase64}&for=${checksumAddr}`

  return { payload, claimLink }
}

// Helper: hex string to bytes (address is 20 bytes)
function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(h.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(h.substr(i * 2, 2), 16)
  }
  return bytes
}

// Base64url encoding (RFC 4648 §5, no padding)
function base64urlEncode(data: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i])
  const base64 = btoa(binary)
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Parse a claim link and extract the AES key and recipient address.
 * @param url The full claim link URL or just the fragment
 * @returns The 32-byte AES key and checksummed recipient address, or null if invalid
 */
export function parseClaimLink(url: string): { key: Uint8Array; forAddress: string } | null {
  try {
    const fragment = url.includes('#') ? url.split('#')[1] : url
    const params = new URLSearchParams(fragment.replace(/^claim&/, ''))
    const keyB64 = params.get('key')
    const forAddr = params.get('for')

    if (!keyB64 || !forAddr) return null

    const key = base64urlDecode(keyB64)
    if (key.length !== 32) return null

    const address = getAddress(forAddr) // validates + checksums
    return { key, forAddress: address }
  } catch {
    return null
  }
}

function base64urlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

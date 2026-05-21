import { encrypt, decrypt } from 'eciesjs'
import { createPublicClient, http } from 'viem'
import { mainnet } from 'viem/chains'
import { normalize } from 'viem/ens'

const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(),
})

export async function encryptToPublicKey(publicKeyHex: string, plaintext: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(encrypt(publicKeyHex, Buffer.from(plaintext)))
}

export async function decryptWithPrivateKey(privateKeyHex: string, ciphertext: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(decrypt(privateKeyHex, Buffer.from(ciphertext)))
}

export async function resolveENS(nameOrAddress: string): Promise<{
  address: string; name: string | null; avatar: string | null
}> {
  if (nameOrAddress.endsWith('.eth')) {
    const address = await publicClient.getEnsAddress({ name: normalize(nameOrAddress) })
    if (!address) throw new Error(`ENS name not found: ${nameOrAddress}`)
    const avatar = await publicClient.getEnsAvatar({ name: normalize(nameOrAddress) }).catch(() => null)
    return { address, name: nameOrAddress, avatar }
  }
  const name = await publicClient.getEnsName({ address: nameOrAddress as `0x${string}` }).catch(() => null)
  const avatar = name ? await publicClient.getEnsAvatar({ name: normalize(name) }).catch(() => null) : null
  return { address: nameOrAddress, name, avatar }
}

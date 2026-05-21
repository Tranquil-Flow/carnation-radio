import { createPublicClient, http, type WalletClient, type Hash } from 'viem'
import { mainnet, sepolia } from 'viem/chains'

// Deployed contract addresses
const REGISTRY_ADDRESSES: Record<number, `0x${string}`> = {
  [mainnet.id]: '0x0000000000000000000000000000000000000000',     // Ethereum mainnet — TBD
  [sepolia.id]: '0x80634dE8ddb230dA28241f0656f4c127A4c7566F',  // Sepolia testnet — deployed 2026-03-27
}

const REGISTRY_ABI = [
  {
    name: 'lookup',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'bytes' }],
  },
  {
    name: 'register',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'compressedPubkey', type: 'bytes' }],
    outputs: [],
  },
  {
    name: 'Registered',
    type: 'event',
    inputs: [
      { name: 'account', type: 'address', indexed: true },
      { name: 'pubkey', type: 'bytes', indexed: false },
    ],
  },
] as const

// Session cache
const _cache = new Map<string, string | null>()

export function clearRegistryCache(): void {
  _cache.clear()
}

/**
 * Look up a Carnation-derived pubkey from the on-chain registry.
 * Tries Ethereum mainnet first (if deployed), falls back to Sepolia for testing.
 * Returns compressed pubkey hex (66 chars with 0x prefix) or null if not registered.
 */
export async function lookupRegistry(address: string): Promise<string | null> {
  const normalizedAddr = address.toLowerCase()
  if (_cache.has(normalizedAddr)) return _cache.get(normalizedAddr)!

  const chains = [mainnet, sepolia]

  for (const chain of chains) {
    const registryAddr = REGISTRY_ADDRESSES[chain.id]
    if (!registryAddr || registryAddr === '0x0000000000000000000000000000000000000000') continue

    try {
      const client = createPublicClient({ chain, transport: http() })
      const result = await client.readContract({
        address: registryAddr,
        abi: REGISTRY_ABI,
        functionName: 'lookup',
        args: [address as `0x${string}`],
      })

      const bytes = result as `0x${string}`
      if (bytes && bytes !== '0x' && bytes.length > 2) {
        _cache.set(normalizedAddr, bytes)
        return bytes
      }
    } catch {
      // Chain unavailable, try next
      continue
    }
  }

  _cache.set(normalizedAddr, null)
  return null
}

/**
 * Register the caller's Carnation-derived pubkey on-chain.
 * Sends a transaction to the CarnationRegistry contract.
 * Recipient pays gas (minimal, ~30k gas).
 */
export async function registerSelf(
  walletClient: WalletClient,
  derivedPubkeyHex: string,
): Promise<Hash> {
  const chain = walletClient.chain
  if (!chain) throw new Error('WalletClient has no chain configured')

  const registryAddr = REGISTRY_ADDRESSES[chain.id]
  if (!registryAddr || registryAddr === '0x0000000000000000000000000000000000000000') {
    throw new Error(`CarnationRegistry not deployed on chain ${chain.id}`)
  }

  const pubkeyBytes = derivedPubkeyHex.startsWith('0x')
    ? derivedPubkeyHex as `0x${string}`
    : `0x${derivedPubkeyHex}` as `0x${string}`

  const [account] = await walletClient.getAddresses()

  return walletClient.writeContract({
    address: registryAddr,
    abi: REGISTRY_ABI,
    functionName: 'register',
    args: [pubkeyBytes],
    account,
    chain,
  })
}

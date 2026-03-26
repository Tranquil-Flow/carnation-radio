import { createPublicClient, http } from 'viem'
import { mainnet, sepolia } from 'viem/chains'

const _cache = new Map<string, boolean>()

/**
 * Check if an address has on-chain transaction history.
 * Used for identity display — informing the sender whether
 * the recipient address exists on-chain.
 * NOT used for encryption (encryption uses registry derived pubkey or ephemeral key).
 *
 * @returns true if the address has sent at least one transaction, false otherwise
 */
export async function hasOnChainHistory(address: string): Promise<boolean> {
  const normalized = address.toLowerCase()
  if (_cache.has(normalized)) return _cache.get(normalized)!

  const chains = [mainnet, sepolia]

  for (const chain of chains) {
    try {
      const client = createPublicClient({ chain, transport: http() })
      const count = await client.getTransactionCount({
        address: address as `0x${string}`,
      })
      if (count > 0) {
        _cache.set(normalized, true)
        return true
      }
    } catch {
      continue
    }
  }

  _cache.set(normalized, false)
  return false
}

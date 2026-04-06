import { describe, it, expect, vi, beforeEach } from 'vitest'
// We test the module's exported functions by mocking viem
vi.mock('viem', async () => {
  const actual = await vi.importActual('viem')
  return {
    ...actual,
    createPublicClient: vi.fn(),
  }
})

import { lookupRegistry, clearRegistryCache } from '../registry'
import { createPublicClient } from 'viem'

const mockedCreatePublicClient = vi.mocked(createPublicClient)

describe('lookupRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Clear the module-level cache between tests
    clearRegistryCache()
  })

  it('returns null for unregistered address (queries deployed chains only)', async () => {
    // Sepolia is deployed, mainnet is zero — should skip mainnet, query Sepolia
    const mockReadContract = vi.fn().mockResolvedValue('0x')
    mockedCreatePublicClient.mockReturnValue({ readContract: mockReadContract } as any)

    const result = await lookupRegistry('0x1234567890123456789012345678901234567890')
    expect(result).toBeNull()
    // Should call createPublicClient for Sepolia (deployed) but NOT mainnet (zero address)
    expect(mockedCreatePublicClient).toHaveBeenCalledTimes(1)
    expect(mockReadContract).toHaveBeenCalledTimes(1)
  })

  it('returns pubkey when address is registered on Sepolia', async () => {
    const fakePubkey = '0x02abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab'
    const mockReadContract = vi.fn().mockResolvedValue(fakePubkey)
    mockedCreatePublicClient.mockReturnValue({ readContract: mockReadContract } as any)

    const result = await lookupRegistry('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    expect(result).toBe(fakePubkey)
    expect(mockedCreatePublicClient).toHaveBeenCalledTimes(1)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>()
  return {
    ...actual,
    createPublicClient: vi.fn(),
    http: vi.fn(),
  }
})

import { hasOnChainHistory, clearHistoryCache } from '../tx-pubkey'
import { createPublicClient } from 'viem'

const mockedCreatePublicClient = vi.mocked(createPublicClient)

describe('hasOnChainHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearHistoryCache()
  })

  it('returns false when getTransactionCount returns 0', async () => {
    const mockGetTransactionCount = vi.fn().mockResolvedValue(0)
    mockedCreatePublicClient.mockReturnValue({
      getTransactionCount: mockGetTransactionCount,
    } as any)

    const result = await hasOnChainHistory('0x1111111111111111111111111111111111111111')
    expect(result).toBe(false)
  })

  it('returns true when getTransactionCount returns 5', async () => {
    const mockGetTransactionCount = vi.fn().mockResolvedValue(5)
    mockedCreatePublicClient.mockReturnValue({
      getTransactionCount: mockGetTransactionCount,
    } as any)

    const result = await hasOnChainHistory('0x2222222222222222222222222222222222222222')
    expect(result).toBe(true)
  })

  it('returns false gracefully when getTransactionCount throws (network error)', async () => {
    const mockGetTransactionCount = vi.fn().mockRejectedValue(new Error('network error'))
    mockedCreatePublicClient.mockReturnValue({
      getTransactionCount: mockGetTransactionCount,
    } as any)

    // Should not throw — should catch the error and return false
    const result = await hasOnChainHistory('0x3333333333333333333333333333333333333333')
    expect(result).toBe(false)
  })

  it('session cache: calling twice with same address only calls viem once', async () => {
    const mockGetTransactionCount = vi.fn().mockResolvedValue(3)
    mockedCreatePublicClient.mockReturnValue({
      getTransactionCount: mockGetTransactionCount,
    } as any)

    const address = '0x4444444444444444444444444444444444444444'

    const result1 = await hasOnChainHistory(address)
    expect(result1).toBe(true)

    const result2 = await hasOnChainHistory(address)
    expect(result2).toBe(true)

    // Should only call createPublicClient (and thus getTransactionCount) once
    expect(mockedCreatePublicClient).toHaveBeenCalledTimes(1)
    expect(mockGetTransactionCount).toHaveBeenCalledTimes(1)
  })
})
import { describe, it, expect, vi, beforeEach } from 'vitest'

// We test the module's exported functions by mocking viem
vi.mock('viem', async () => {
  const actual = await vi.importActual('viem')
  return {
    ...actual,
    createPublicClient: vi.fn(),
  }
})

import { lookupRegistry } from '../registry'
import { createPublicClient } from 'viem'

const mockedCreatePublicClient = vi.mocked(createPublicClient)

describe('lookupRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when all registry addresses are zero (not deployed)', async () => {
    // Default state: all addresses are 0x000...000, so lookupRegistry should skip them
    const result = await lookupRegistry('0x1234567890123456789012345678901234567890')
    expect(result).toBeNull()
    // createPublicClient should NOT be called since addresses are zero
    expect(mockedCreatePublicClient).not.toHaveBeenCalled()
  })
})

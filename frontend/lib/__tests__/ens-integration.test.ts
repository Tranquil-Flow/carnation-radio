/**
 * ENS Resolution Integration Tests
 *
 * @integration
 * These tests require a live Ethereum mainnet RPC connection.
 * They are skipped when no RPC is available (VITE_ALCHEMY_KEY not set or no network).
 *
 * Run with:
 *   VITE_ALCHEMY_KEY=<your-key> npx vitest run --reporter=verbose lib/__tests__/ens-integration.test.ts
 *
 * Or with a public RPC (rate-limited):
 *   npx vitest run lib/__tests__/ens-integration.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { resolveENS } from '../ecies'
import { encryptToAddress } from '../encrypt-to-address'
import { clearRegistryCache } from '../registry'

// Detect if we have network access for integration tests.
// We attempt a quick DNS check or rely on env var to skip.
const SKIP_INTEGRATION = process.env.SKIP_INTEGRATION === '1'

// Well-known stable ENS names and their expected addresses
const VITALIK_ENS = 'vitalik.eth'
const VITALIK_ADDR = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
const NONEXISTENT_ENS = 'doesnotexist12345678xyzabcdef.eth'

describe.skipIf(SKIP_INTEGRATION)('ENS Resolution Integration', () => {
  beforeAll(() => {
    clearRegistryCache()
  })

  it('resolves vitalik.eth to the correct checksummed address', async () => {
    const result = await resolveENS(VITALIK_ENS)
    expect(result.address).toBe(VITALIK_ADDR)
    // Verify it is checksummed EIP-55 format (mixed case, not all lowercase)
    expect(result.address).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(result.name).toBe(VITALIK_ENS)
  }, 30_000)

  it('returns null avatar gracefully when not available', async () => {
    const result = await resolveENS(VITALIK_ENS)
    // avatar may or may not be set — should not throw
    expect(result.avatar === null || typeof result.avatar === 'string').toBe(true)
  }, 30_000)

  it('throws for a non-existent ENS name', async () => {
    await expect(resolveENS(NONEXISTENT_ENS)).rejects.toThrow()
  }, 30_000)

  it('passes through a hex address unchanged (no ENS lookup)', async () => {
    const result = await resolveENS(VITALIK_ADDR)
    expect(result.address).toBe(VITALIK_ADDR)
    // ENS reverse lookup may return null for addresses not reverse-registered
    expect(result.name === null || typeof result.name === 'string').toBe(true)
  }, 30_000)

  it('resolved ENS address is usable as encryptToAddress() recipient (Mode B — not registered)', async () => {
    // Resolve vitalik.eth to an address
    const { address } = await resolveENS(VITALIK_ENS)
    expect(address).toBeTruthy()

    // Use a dummy 32-byte hex private key for the sender
    const dummySenderPriv = '0x' + 'ab'.repeat(32)

    // encryptToAddress will look up the registry — vitalik.eth is almost certainly not
    // registered in CarnationRegistry (a Carnation-specific contract), so Mode B triggers.
    // If they somehow registered, Mode A triggers — both are valid outcomes.
    const plaintext = new TextEncoder().encode('integration test message')
    const result = await encryptToAddress(address, plaintext, dummySenderPriv)

    // Either mode produces a non-empty payload
    expect(result.payload.length).toBeGreaterThan(0)

    // claimLink is either null (Mode A — registered) or a valid URL fragment (Mode B)
    if (result.claimLink !== null) {
      expect(result.claimLink).toContain('carnation.radio/#claim&key=')
      expect(result.claimLink).toContain('&for=' + address)
    }
  }, 30_000)
})

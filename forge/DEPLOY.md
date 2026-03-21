# CarnationRegistry — Deployment Guide

## Prerequisites

- Foundry installed (`foundryup`)
- A funded deployer wallet (EOA)
- RPC endpoints for Base mainnet and Sepolia
- (Optional) Block-explorer API keys for contract verification

## Environment Setup

Create `forge/.env` (never commit):

```bash
PRIVATE_KEY=0x...               # deployer private key
BASE_RPC_URL=https://mainnet.base.org
SEPOLIA_RPC_URL=https://rpc.sepolia.org
BASESCAN_API_KEY=...            # from https://basescan.org/myapikey
ETHERSCAN_API_KEY=...           # from https://etherscan.io/myapikey
```

Load it:

```bash
cd forge
source .env
```

## Dry-Run (no broadcast)

Simulate deployment on Base mainnet without spending gas:

```bash
forge script script/DeployCarnationRegistry.s.sol \
  --rpc-url $BASE_RPC_URL \
  -vvvv
```

## Deploy to Sepolia

```bash
forge script script/DeployCarnationRegistry.s.sol \
  --rpc-url $SEPOLIA_RPC_URL \
  --private-key $PRIVATE_KEY \
  --broadcast \
  --verify \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  -vvvv
```

## Deploy to Base Mainnet

```bash
forge script script/DeployCarnationRegistry.s.sol \
  --rpc-url $BASE_RPC_URL \
  --private-key $PRIVATE_KEY \
  --broadcast \
  --verify \
  --etherscan-api-key $BASESCAN_API_KEY \
  -vvvv
```

## After Deployment

Copy the logged address (`CarnationRegistry deployed to: 0x...`) into
`frontend/lib/registry.ts`, replacing the `0x0000...` placeholder for
the appropriate chain ID:

```typescript
const REGISTRY_ADDRESSES: Record<number, `0x${string}`> = {
  [base.id]:    '0x<BASE_ADDRESS_HERE>',
  [sepolia.id]: '0x<SEPOLIA_ADDRESS_HERE>',
}
```

Then update CLAUDE.md with the deployed addresses under
"Smart Contracts → Deployed addresses".

## Verification (post-deploy)

Confirm the registry is live:

```bash
cast call <DEPLOYED_ADDRESS> "lookup(address)(bytes)" <ANY_ADDRESS> \
  --rpc-url $BASE_RPC_URL
# Expected: 0x (empty bytes — unregistered address)
```

## Gas Estimate

Deployment costs approximately **~350 000 gas** (~$0.04 on Base at 0.1 gwei).
Each `register()` call costs ~**52 000–93 000 gas** depending on storage slot.

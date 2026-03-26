// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {CarnationRegistry} from "../src/CarnationRegistry.sol";

/// @notice Deployment script for CarnationRegistry.
///
/// Usage (dry-run, no broadcast):
///   forge script script/DeployCarnationRegistry.s.sol --rpc-url $RPC_URL
///
/// Usage (live broadcast + verify):
///   forge script script/DeployCarnationRegistry.s.sol \
///     --rpc-url $RPC_URL \
///     --private-key $PRIVATE_KEY \
///     --broadcast \
///     --verify \
///     --etherscan-api-key $ETHERSCAN_KEY \
///     -vvvv
///
/// Recommended RPC vars:
///   Ethereum mainnet:  RPC_URL=https://eth.llamarpc.com  (or any Ethereum mainnet RPC)
///   Sepolia:           RPC_URL=https://rpc.sepolia.org
///
/// After deployment, copy the logged address into frontend/lib/registry.ts.
contract DeployCarnationRegistry is Script {
    function run() external {
        vm.startBroadcast();

        CarnationRegistry registry = new CarnationRegistry();

        console.log("CarnationRegistry deployed to:", address(registry));

        vm.stopBroadcast();
    }
}

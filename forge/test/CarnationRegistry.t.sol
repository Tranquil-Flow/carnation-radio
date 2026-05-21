// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Test, console} from "forge-std/Test.sol";
import {CarnationRegistry} from "../src/CarnationRegistry.sol";

contract CarnationRegistryTest is Test {
    CarnationRegistry public registry;

    // Mirror the contract event so we can use it in vm.expectEmit checks
    event Registered(address indexed account, bytes pubkey);

    // Valid 33-byte compressed pubkey — prefix 0x02 (even Y parity)
    // This is the secp256k1 generator point G in compressed form.
    bytes internal validPubkey02 =
        hex"0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";

    // Valid 33-byte compressed pubkey — prefix 0x03 (odd Y parity)
    bytes internal validPubkey03 =
        hex"0300000000000000000000000000000000000000000000000000000000000000aa";

    // Replacement key used in the overwrite test (33 bytes, prefix 0x02)
    bytes internal replacementPubkey =
        hex"02bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    address internal alice = makeAddr("alice");
    address internal bob   = makeAddr("bob");

    function setUp() public {
        registry = new CarnationRegistry();
    }

    // -------------------------------------------------------------------------
    // Test 1 — register + lookup round trip
    // -------------------------------------------------------------------------

    /// @notice Registering a valid key and looking it up returns the same key
    function test_RegisterAndLookup() public {
        vm.prank(alice);
        registry.register(validPubkey02);

        bytes memory stored = registry.lookup(alice);
        assertEq(stored, validPubkey02);
    }

    // -------------------------------------------------------------------------
    // Test 2 — overwrite
    // -------------------------------------------------------------------------

    /// @notice Re-registering with a new key replaces the previous one
    function test_Overwrite() public {
        vm.prank(alice);
        registry.register(validPubkey02);

        vm.prank(alice);
        registry.register(replacementPubkey);

        bytes memory stored = registry.lookup(alice);
        assertEq(stored, replacementPubkey);
    }

    // -------------------------------------------------------------------------
    // Test 3 — lookup unregistered address
    // -------------------------------------------------------------------------

    /// @notice Looking up an address that has never registered returns empty bytes
    function test_LookupUnregistered() public view {
        bytes memory stored = registry.lookup(bob);
        assertEq(stored.length, 0);
    }

    // -------------------------------------------------------------------------
    // Test 4 — event emission
    // -------------------------------------------------------------------------

    /// @notice register() emits the Registered event with the correct arguments
    function test_EmitsRegisteredEvent() public {
        vm.expectEmit(true, false, false, true);
        emit Registered(alice, validPubkey02);

        vm.prank(alice);
        registry.register(validPubkey02);
    }

    // -------------------------------------------------------------------------
    // Test 5 — reject wrong-length pubkeys
    // -------------------------------------------------------------------------

    /// @notice A 32-byte pubkey is rejected with InvalidPubkeyLength
    function test_RevertOnTooShortPubkey() public {
        // 32 bytes = 64 hex nibbles; drop the last byte ("98") from the 33-byte key
        bytes memory short32 =
            hex"0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f817";
        assertEq(short32.length, 32);

        vm.expectRevert(
            abi.encodeWithSelector(CarnationRegistry.InvalidPubkeyLength.selector, uint256(32))
        );
        vm.prank(alice);
        registry.register(short32);
    }

    /// @notice A 34-byte pubkey is rejected with InvalidPubkeyLength
    function test_RevertOnTooLongPubkey() public {
        // 34 bytes = 68 hex nibbles; append one extra byte ("00") to the 33-byte key
        bytes memory long34 =
            hex"0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f8179800";
        assertEq(long34.length, 34);

        vm.expectRevert(
            abi.encodeWithSelector(CarnationRegistry.InvalidPubkeyLength.selector, uint256(34))
        );
        vm.prank(alice);
        registry.register(long34);
    }

    // -------------------------------------------------------------------------
    // Test 6 — reject invalid prefix bytes
    // -------------------------------------------------------------------------

    /// @notice A 33-byte key starting with 0x04 (uncompressed point marker) is rejected
    function test_RevertOnPrefix04() public {
        // 33 bytes, prefix 0x04
        bytes memory prefix04 =
            hex"0479be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
        assertEq(prefix04.length, 33);

        vm.expectRevert(
            abi.encodeWithSelector(CarnationRegistry.InvalidPubkeyPrefix.selector, bytes1(0x04))
        );
        vm.prank(alice);
        registry.register(prefix04);
    }

    /// @notice A 33-byte key starting with 0x00 is rejected
    function test_RevertOnPrefix00() public {
        // 33 bytes, prefix 0x00
        bytes memory prefix00 =
            hex"0079be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
        assertEq(prefix00.length, 33);

        vm.expectRevert(
            abi.encodeWithSelector(CarnationRegistry.InvalidPubkeyPrefix.selector, bytes1(0x00))
        );
        vm.prank(alice);
        registry.register(prefix00);
    }
}

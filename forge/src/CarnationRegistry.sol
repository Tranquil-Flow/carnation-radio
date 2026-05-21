// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @title CarnationRegistry
/// @author Tranquil-Flow
/// @notice A permissionless public registry mapping Ethereum addresses to compressed secp256k1 public keys.
///         Any address may self-register or overwrite their own entry. There is no owner, admin, or
///         upgradeability — this contract is an immutable public utility.
contract CarnationRegistry {

    /// @notice Stores the compressed secp256k1 public key (33 bytes) for each registered address
    mapping(address => bytes) public keys;

    /// @notice Emitted when an address registers or updates its public key
    /// @param account The address that performed the registration
    /// @param pubkey  The 33-byte compressed public key that was stored
    event Registered(address indexed account, bytes pubkey);

    /// @notice Reverted when the supplied pubkey is not exactly 33 bytes
    /// @param length The actual length that was provided
    error InvalidPubkeyLength(uint256 length);

    /// @notice Reverted when the first byte of the pubkey is not 0x02 or 0x03
    /// @param prefix The invalid prefix byte that was provided
    error InvalidPubkeyPrefix(bytes1 prefix);

    /// @notice Registers the caller's compressed secp256k1 public key
    /// @dev Calling again overwrites any previously stored key for msg.sender.
    ///      Validation enforces that the input is a well-formed compressed EC point:
    ///      exactly 33 bytes with a prefix of 0x02 (even Y) or 0x03 (odd Y).
    /// @param compressedPubkey The 33-byte compressed secp256k1 public key to register
    function register(bytes calldata compressedPubkey) external {
        if (compressedPubkey.length != 33) {
            revert InvalidPubkeyLength(compressedPubkey.length);
        }
        if (compressedPubkey[0] != 0x02 && compressedPubkey[0] != 0x03) {
            revert InvalidPubkeyPrefix(compressedPubkey[0]);
        }

        keys[msg.sender] = compressedPubkey;
        emit Registered(msg.sender, compressedPubkey);
    }

    /// @notice Returns the registered public key for a given address
    /// @dev Returns empty bytes if the address has never registered
    /// @param account The address to look up
    /// @return The stored 33-byte compressed public key, or empty bytes if not registered
    function lookup(address account) external view returns (bytes memory) {
        return keys[account];
    }
}

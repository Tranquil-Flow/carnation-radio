"""
Carnation Radio - High-Level API

Combines the patchwork steganography engine with AES-256-GCM encryption.
This is the main entry point for encoding and decoding secret messages.

Usage:
    from carnation import hide_message, reveal_message

    # Encode: encrypt + embed into audio
    hide_message("input.wav", "output.wav", "secret message", passphrase="password123")

    # Decode: extract + decrypt from audio
    message = reveal_message("output.wav", passphrase="password123")
"""

import hashlib

from crypto import encrypt_message, decrypt_message
from patchwork import encode as steg_encode, decode as steg_decode


def hide_message(audio_path: str, output_path: str, message: str,
                 passphrase: str, **kwargs) -> dict:
    """
    Hide an encrypted message inside a WAV audio file.

    Args:
        audio_path: Path to input WAV file
        output_path: Path to write watermarked WAV
        message: The secret message (text)
        passphrase: Passphrase for encryption + embedding key
        **kwargs: Additional args passed to patchwork encoder (delta, etc.)

    Returns:
        Dict with encoding stats
    """
    # Encrypt the message
    plaintext = message.encode("utf-8")
    ciphertext = encrypt_message(plaintext, passphrase)

    # Derive embedding key from passphrase
    embed_key = hashlib.sha256(b"carnation-embed:" + passphrase.encode("utf-8")).digest()

    # Embed encrypted payload into audio
    stats = steg_encode(audio_path, output_path, ciphertext, embed_key, **kwargs)
    stats["encrypted_size"] = len(ciphertext)
    stats["plaintext_size"] = len(plaintext)
    return stats


def reveal_message(audio_path: str, passphrase: str, **kwargs) -> str:
    """
    Extract and decrypt a hidden message from a watermarked WAV file.

    Args:
        audio_path: Path to watermarked WAV file
        passphrase: Same passphrase used during encoding

    Returns:
        The decrypted message text

    Raises:
        ValueError: If passphrase is wrong, key is wrong, or no message found
    """
    # Derive the same embedding key
    embed_key = hashlib.sha256(b"carnation-embed:" + passphrase.encode("utf-8")).digest()

    # Extract encrypted payload
    ciphertext = steg_decode(audio_path, embed_key, **kwargs)

    # Decrypt
    plaintext = decrypt_message(ciphertext, passphrase)
    return plaintext.decode("utf-8")

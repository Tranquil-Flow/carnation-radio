"""
Carnation Radio - Encryption Layer

Provides AES-256-GCM encryption for the steganography payload.
Key is derived from a user passphrase using scrypt (memory-hard KDF).

Usage:
    from crypto import encrypt_message, decrypt_message

    ciphertext = encrypt_message(b"secret message", passphrase="my password")
    plaintext = decrypt_message(ciphertext, passphrase="my password")

Wire format of encrypted payload:
    [salt:16][nonce:16][tag:16][ciphertext:N]
    Total overhead: 48 bytes
"""

import os

from Crypto.Cipher import AES
from Crypto.Protocol.KDF import scrypt


SALT_SIZE = 16
NONCE_SIZE = 16  # AES-GCM recommended nonce size
TAG_SIZE = 16
SCRYPT_N = 2**14  # CPU/memory cost (lower for speed; increase for production)
SCRYPT_R = 8
SCRYPT_P = 1
KEY_SIZE = 32  # AES-256


def derive_key(passphrase: str, salt: bytes) -> bytes:
    """Derive a 256-bit key from passphrase using scrypt."""
    return scrypt(passphrase.encode("utf-8"), salt, KEY_SIZE,
                  N=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P)


def encrypt_message(plaintext: bytes, passphrase: str) -> bytes:
    """
    Encrypt a message with AES-256-GCM using a passphrase.

    Returns: salt + nonce + tag + ciphertext
    """
    salt = os.urandom(SALT_SIZE)
    key = derive_key(passphrase, salt)

    cipher = AES.new(key, AES.MODE_GCM, nonce=os.urandom(NONCE_SIZE))
    ciphertext, tag = cipher.encrypt_and_digest(plaintext)

    return salt + cipher.nonce + tag + ciphertext


def decrypt_message(payload: bytes, passphrase: str) -> bytes:
    """
    Decrypt a message encrypted with encrypt_message().

    Raises ValueError if passphrase is wrong or data is corrupted.
    """
    min_size = SALT_SIZE + NONCE_SIZE + TAG_SIZE
    if len(payload) < min_size:
        raise ValueError(f"Payload too short: {len(payload)} < {min_size}")

    salt = payload[:SALT_SIZE]
    nonce = payload[SALT_SIZE:SALT_SIZE + NONCE_SIZE]
    tag = payload[SALT_SIZE + NONCE_SIZE:SALT_SIZE + NONCE_SIZE + TAG_SIZE]
    ciphertext = payload[SALT_SIZE + NONCE_SIZE + TAG_SIZE:]

    key = derive_key(passphrase, salt)
    cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)

    try:
        return cipher.decrypt_and_verify(ciphertext, tag)
    except ValueError:
        raise ValueError("Decryption failed - wrong passphrase or corrupted data")

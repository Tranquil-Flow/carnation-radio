---
title: CarnationFM_Explainations

---

# CLI

This CLI implements a steganography program called "whistle" that hides and retrieves encrypted messages within WAV audio files. Here's a comprehensive overview of its functionality:

1. Encryption:
    - It takes a message file, an input WAV file, and creates an output WAV file.
    - The message is encrypted using AES-128 in CBC mode.
    - The encrypted data is embedded into the least significant bits of the first audio channel.
    - The program targets 16-bit (CD quality) WAV files.
    - The message is placed at a random location, starting somewhere in the first 15 seconds of audio.
2. Message Structure:
The encoded message consists of:
    - A 128-bit handshake pattern (random bits)
    - A 128-bit blinded AES key
    - A 128-bit random initialization vector (IV)
    - The augmented message encrypted with AES-128 using the unblinded key and IV
3. Augmented Message:
    - Metadata containing the message length and original file name
    - The actual message content
4. Decryption:
    - It requires a 256-bit key (concatenation of the handshake pattern and blinding key)
    - The program searches for the handshake pattern to locate the hidden message
    - Once found, it extracts the encrypted data, unblinds the AES key, and decrypts the message

Key features:

- Uses SHA-256 for key derivation and randomization
- Employs AES-128 in CBC mode for message encryption
- Hides data in the least significant bits of audio samples in the first channel
- The resulting low bits are statistically random, providing plausible deniability
- After encoding, the modified bits represent white noise at around -90 dB
- Supports 16-bit PCM WAV files
- Has a maximum message size limit of 256KB
- Uses random offsets to make detection more difficult

Usage remains the same as previously described. The program still uses a 33MB buffer (BUFSIZE) for processing audio data.

This implementation provides strong security through:

1. The need for a 128-bit handshake pattern to even detect a hidden message
2. An additional 128-bit blinding key to decode the message
3. AES-128 encryption of the actual message
4. Statistical indistinguishability of the modified bits from random noise

This approach makes the steganography highly resistant to detection and decryption without the correct keys, while maintaining plausible deniability due to the randomization of all low bits in the resulting file.
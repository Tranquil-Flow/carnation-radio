"""
Carnation Radio - Patchwork Steganography Engine

Clean-room implementation of a Modified Patchwork Algorithm for audio
steganography. Embeds hidden messages in the DCT domain of audio signals
using key-seeded pseudo-random frequency bin pairing.

The approach:
  1. Divide audio into frames of N samples
  2. Compute DCT of each frame
  3. Use a PRNG seeded with a key to select pairs of frequency bins
  4. Embed one bit per pair by adjusting relative magnitudes
  5. IDCT to reconstruct the audio frame
  6. Extraction: re-select same pairs, check sign of difference
  7. Interleaved repetition coding with majority vote for error correction

Survives MP3 compression because:
  - Modifications are in the audible frequency range (preserved by codecs)
  - Relative amplitude relationships are maintained by perceptual codecs
  - Interleaved repetition spreads each bit across entire audio duration
  - Majority vote corrects remaining errors (handles ~15% raw BER)
"""

import hashlib
import struct
import wave

import numpy as np
from scipy.fft import dct, idct


# --- Constants ---
FRAME_SIZE = 1024          # samples per frame (~23ms at 44100Hz)
PAIRS_PER_FRAME = 6        # frequency bin pairs used per frame (= bits per frame)
FREQ_BIN_LOW = 40          # lowest DCT bin index (~1.7kHz) - above MP3's lossy bass region
FREQ_BIN_HIGH = 350        # highest DCT bin index (~15kHz) - below MP3's cutoff
DELTA_STRENGTH = 200.0     # embedding strength (higher = more robust but more audible)
SYNC_PATTERN = b"\xCA\xFE\xBA\xBE"  # 4-byte sync marker for frame alignment
REPETITION = 17            # each bit embedded this many times for error correction


def _derive_prng_seed(key: bytes, frame_idx: int) -> int:
    """Derive a deterministic PRNG seed from key + frame index."""
    h = hashlib.sha256(key + struct.pack(">I", frame_idx))
    return int.from_bytes(h.digest()[:8], "big")


def _select_bin_pairs(key: bytes, frame_idx: int, n_pairs: int,
                      bin_low: int, bin_high: int) -> list[tuple[int, int]]:
    """Select n_pairs of distinct frequency bin indices using key-seeded PRNG."""
    seed = _derive_prng_seed(key, frame_idx)
    rng = np.random.RandomState(seed % (2**31))
    available = list(range(bin_low, bin_high))
    rng.shuffle(available)
    pairs = []
    for i in range(0, min(n_pairs * 2, len(available) - 1), 2):
        pairs.append((available[i], available[i + 1]))
    return pairs[:n_pairs]


def _embed_bit_in_pair(coeffs: np.ndarray, bin_a: int, bin_b: int,
                       bit: int, delta: float) -> np.ndarray:
    """Embed a single bit by adjusting the relative magnitude of two DCT bins."""
    a_val = coeffs[bin_a]
    b_val = coeffs[bin_b]
    avg = (abs(a_val) + abs(b_val)) / 2.0

    # Adaptive delta: proportional to signal energy, with a minimum floor
    adaptive_delta = max(delta, delta * avg / 500.0)

    sign_a = np.sign(a_val) if a_val != 0 else 1.0
    sign_b = np.sign(b_val) if b_val != 0 else 1.0
    mid = (abs(a_val) + abs(b_val)) / 2.0

    if bit == 1:
        coeffs[bin_a] = sign_a * (mid + adaptive_delta / 2.0)
        coeffs[bin_b] = sign_b * max(mid - adaptive_delta / 2.0, 1.0)
    else:
        coeffs[bin_a] = sign_a * max(mid - adaptive_delta / 2.0, 1.0)
        coeffs[bin_b] = sign_b * (mid + adaptive_delta / 2.0)
    return coeffs


def _extract_bit_from_pair(coeffs: np.ndarray, bin_a: int, bin_b: int) -> int:
    """Extract a single bit by checking relative magnitude of two DCT bins."""
    return 1 if abs(coeffs[bin_a]) >= abs(coeffs[bin_b]) else 0


def _bits_to_bytes(bits: list[int]) -> bytes:
    """Convert a list of bits (MSB first) to bytes."""
    result = bytearray()
    for i in range(0, len(bits) - 7, 8):
        byte = 0
        for j in range(8):
            byte = (byte << 1) | bits[i + j]
        result.append(byte)
    return bytes(result)


def _bytes_to_bits(data: bytes) -> list[int]:
    """Convert bytes to a list of bits (MSB first)."""
    bits = []
    for byte in data:
        for i in range(7, -1, -1):
            bits.append((byte >> i) & 1)
    return bits


def _interleave_bits(bits: list[int], repetition: int, total_slots: int) -> list[int]:
    """Interleave repeated bits across the full slot space.

    Instead of [b0 b0 b0 b1 b1 b1], produces [b0 b1 ... bN b0 b1 ... bN ...]
    This spreads each bit's copies across different frames, ensuring that
    quiet frames (with higher error rates) don't cluster on the same logical bit.

    Uses stride = total_slots // repetition so the decoder can deinterleave
    without knowing the message length.
    """
    stride = total_slots // repetition  # same stride decoder will use
    slots = [0] * total_slots

    for rep_i in range(repetition):
        offset = rep_i * stride
        for bit_i, bit in enumerate(bits):
            slot_idx = offset + bit_i
            if slot_idx < total_slots:
                slots[slot_idx] = bit

    return slots


def _deinterleave_vote(raw_bits: list[int], repetition: int) -> list[int]:
    """Deinterleave and apply majority vote to recover logical bits."""
    total = len(raw_bits)
    stride = total // repetition  # must match encoder's stride
    votes = [[] for _ in range(stride)]

    for rep_i in range(repetition):
        offset = rep_i * stride
        for bit_i in range(stride):
            slot_idx = offset + bit_i
            if slot_idx < total:
                votes[bit_i].append(raw_bits[slot_idx])

    # Majority vote
    decoded = []
    for bit_votes in votes:
        if not bit_votes:
            decoded.append(0)
        else:
            ones = sum(bit_votes)
            decoded.append(1 if ones > len(bit_votes) // 2 else 0)
    return decoded


def read_wav(path: str) -> tuple[np.ndarray, int, int, int]:
    """Read a WAV file. Returns (samples, sample_rate, n_channels, sample_width)."""
    with wave.open(path, "rb") as wf:
        n_channels = wf.getnchannels()
        sample_width = wf.getsampwidth()
        sample_rate = wf.getframerate()
        n_frames = wf.getnframes()
        raw = wf.readframes(n_frames)

    if sample_width == 2:
        dtype = np.int16
    elif sample_width == 4:
        dtype = np.int32
    else:
        raise ValueError(f"Unsupported sample width: {sample_width}")

    samples = np.frombuffer(raw, dtype=dtype).astype(np.float64)
    if n_channels > 1:
        samples = samples.reshape(-1, n_channels)
    return samples, sample_rate, n_channels, sample_width


def write_wav(path: str, samples: np.ndarray, sample_rate: int,
              n_channels: int, sample_width: int) -> None:
    """Write samples to a WAV file."""
    if sample_width == 2:
        dtype = np.int16
        max_val = 32767
    elif sample_width == 4:
        dtype = np.int32
        max_val = 2147483647
    else:
        raise ValueError(f"Unsupported sample width: {sample_width}")

    clipped = np.clip(samples, -max_val - 1, max_val)
    raw = clipped.astype(dtype).tobytes()

    with wave.open(path, "wb") as wf:
        wf.setnchannels(n_channels)
        wf.setsampwidth(sample_width)
        wf.setframerate(sample_rate)
        wf.writeframes(raw)


def encode(audio_path: str, output_path: str, message: bytes,
           key: bytes, delta: float = DELTA_STRENGTH,
           pairs_per_frame: int = PAIRS_PER_FRAME,
           repetition: int = REPETITION) -> dict:
    """
    Encode a hidden message into a WAV audio file.

    Args:
        audio_path: Path to input WAV file
        output_path: Path to write watermarked WAV file
        message: The secret message bytes to embed
        key: Encryption/embedding key (any bytes, will be hashed)
        delta: Embedding strength (default 200.0)
        pairs_per_frame: Number of frequency bin pairs per frame
        repetition: Error correction repetition factor

    Returns:
        Dict with encoding stats
    """
    samples, sr, n_ch, sw = read_wav(audio_path)

    if n_ch > 1:
        mono = samples[:, 0].copy()
    else:
        mono = samples.copy()

    # Build payload: sync + length (4 bytes big-endian) + message
    payload = SYNC_PATTERN + struct.pack(">I", len(message)) + message
    logical_bits = _bytes_to_bits(payload)

    n_frames = len(mono) // FRAME_SIZE
    total_slots = n_frames * pairs_per_frame
    needed_slots = len(logical_bits) * repetition

    if needed_slots > total_slots:
        max_msg = (total_slots // repetition - 64) // 8
        raise ValueError(
            f"Message too long: need {needed_slots} bit slots but only "
            f"{total_slots} available ({n_frames} frames x {pairs_per_frame} pairs). "
            f"Max message: ~{max_msg} bytes"
        )

    # Interleave bits across all available slots
    slot_bits = _interleave_bits(logical_bits, repetition, total_slots)

    key_hash = hashlib.sha256(key).digest()

    bit_idx = 0
    frames_used = 0

    for frame_i in range(n_frames):
        start = frame_i * FRAME_SIZE
        end = start + FRAME_SIZE
        frame = mono[start:end]

        coeffs = dct(frame, type=2, norm="ortho")

        pairs = _select_bin_pairs(key_hash, frame_i, pairs_per_frame,
                                  FREQ_BIN_LOW, FREQ_BIN_HIGH)

        for bin_a, bin_b in pairs:
            if bit_idx < len(slot_bits):
                bit = slot_bits[bit_idx]
                coeffs = _embed_bit_in_pair(coeffs, bin_a, bin_b, bit, delta)
                bit_idx += 1

        modified = idct(coeffs, type=2, norm="ortho")
        mono[start:end] = modified
        frames_used += 1

    if n_ch > 1:
        samples[:, 0] = mono
        write_wav(output_path, samples, sr, n_ch, sw)
    else:
        write_wav(output_path, mono, sr, n_ch, sw)

    return {
        "bits_embedded": bit_idx,
        "message_bytes": len(message),
        "frames_used": frames_used,
        "capacity_remaining": total_slots - needed_slots,
        "sample_rate": sr,
    }


def decode(audio_path: str, key: bytes,
           pairs_per_frame: int = PAIRS_PER_FRAME,
           repetition: int = REPETITION) -> bytes:
    """
    Decode a hidden message from a watermarked WAV audio file.

    Args:
        audio_path: Path to watermarked WAV file
        key: The same key used during encoding
        pairs_per_frame: Must match encoding parameter
        repetition: Must match encoding parameter

    Returns:
        The decoded message bytes

    Raises:
        ValueError: If sync pattern not found or decoding fails
    """
    samples, sr, n_ch, sw = read_wav(audio_path)

    if n_ch > 1:
        mono = samples[:, 0].copy()
    else:
        mono = samples.copy()

    key_hash = hashlib.sha256(key).digest()
    n_frames = len(mono) // FRAME_SIZE

    # Extract all raw bits from all frames
    all_raw_bits = []

    for frame_i in range(n_frames):
        start = frame_i * FRAME_SIZE
        end = start + FRAME_SIZE
        frame = mono[start:end]

        coeffs = dct(frame, type=2, norm="ortho")
        pairs = _select_bin_pairs(key_hash, frame_i, pairs_per_frame,
                                  FREQ_BIN_LOW, FREQ_BIN_HIGH)

        for bin_a, bin_b in pairs:
            bit = _extract_bit_from_pair(coeffs, bin_a, bin_b)
            all_raw_bits.append(bit)

    # Deinterleave and majority vote
    # (stride = total_slots // repetition, matching encoder)
    decoded_bits = _deinterleave_vote(all_raw_bits, repetition)

    # Convert to bytes and find sync pattern
    decoded_bytes = _bits_to_bytes(decoded_bits)

    sync_idx = decoded_bytes.find(SYNC_PATTERN)
    if sync_idx == -1:
        raise ValueError("Sync pattern not found - wrong key or corrupted audio")

    length_start = sync_idx + len(SYNC_PATTERN)
    if length_start + 4 > len(decoded_bytes):
        raise ValueError("Truncated header - not enough data after sync")

    msg_len = struct.unpack(">I", decoded_bytes[length_start:length_start + 4])[0]

    msg_start = length_start + 4
    if msg_start + msg_len > len(decoded_bytes):
        raise ValueError(
            f"Message truncated: expected {msg_len} bytes but only "
            f"{len(decoded_bytes) - msg_start} available"
        )

    return decoded_bytes[msg_start:msg_start + msg_len]

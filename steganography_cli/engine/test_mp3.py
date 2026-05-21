"""
MP3 Compression Survivability Test

THE critical test for Carnation Radio: can our hidden message survive
MP3 compression at various bitrates?

Tests:
  1. WAV -> MP3 (128kbps) -> WAV -> decode
  2. WAV -> MP3 (192kbps) -> WAV -> decode
  3. WAV -> MP3 (256kbps) -> WAV -> decode
  4. WAV -> MP3 (320kbps) -> WAV -> decode
  5. WAV -> OGG (128kbps) -> WAV -> decode
  6. Full pipeline: encrypt + embed + MP3 compress + decode + decrypt
"""

import os
import subprocess
import sys
import tempfile

import numpy as np

from patchwork import encode, decode, read_wav, FRAME_SIZE, DELTA_STRENGTH
from carnation import hide_message, reveal_message
from test_patchwork import generate_test_wav


def compress_and_decompress(input_wav: str, output_wav: str,
                            codec: str = "mp3", bitrate: str = "128k") -> None:
    """Compress WAV to lossy format and back to WAV using ffmpeg."""
    tmpdir = os.path.dirname(output_wav)

    if codec == "mp3":
        compressed = os.path.join(tmpdir, "compressed.mp3")
        # WAV -> MP3
        subprocess.run(
            ["ffmpeg", "-y", "-i", input_wav, "-codec:a", "libmp3lame",
             "-b:a", bitrate, compressed],
            capture_output=True, check=True
        )
    elif codec == "ogg":
        compressed = os.path.join(tmpdir, "compressed.ogg")
        subprocess.run(
            ["ffmpeg", "-y", "-i", input_wav, "-codec:a", "libvorbis",
             "-b:a", bitrate, compressed],
            capture_output=True, check=True
        )
    elif codec == "aac":
        compressed = os.path.join(tmpdir, "compressed.m4a")
        subprocess.run(
            ["ffmpeg", "-y", "-i", input_wav, "-codec:a", "aac",
             "-b:a", bitrate, compressed],
            capture_output=True, check=True
        )
    else:
        raise ValueError(f"Unknown codec: {codec}")

    # Compressed -> WAV (back to PCM for our decoder)
    subprocess.run(
        ["ffmpeg", "-y", "-i", compressed, "-codec:a", "pcm_s16le",
         "-ar", "44100", output_wav],
        capture_output=True, check=True
    )


def test_mp3_roundtrip(bitrate: str = "128k", delta: float = DELTA_STRENGTH):
    """Test steganography survives MP3 compression at given bitrate."""
    print(f"\n  MP3 {bitrate}...", end=" ", flush=True)

    with tempfile.TemporaryDirectory() as tmpdir:
        input_wav = os.path.join(tmpdir, "input.wav")
        encoded_wav = os.path.join(tmpdir, "encoded.wav")
        decoded_wav = os.path.join(tmpdir, "decoded.wav")

        generate_test_wav(input_wav, duration_sec=30.0)
        message = b"Carnation Radio survives compression!"
        key = b"mp3-test-key"

        encode(input_wav, encoded_wav, message, key, delta=delta)
        compress_and_decompress(encoded_wav, decoded_wav, "mp3", bitrate)

        try:
            result = decode(decoded_wav, key)
            if result == message:
                print("PASS")
                return True
            else:
                print(f"FAIL (decoded wrong: {result[:20]!r}...)")
                return False
        except ValueError as e:
            print(f"FAIL ({e})")
            return False


def test_ogg_roundtrip(bitrate: str = "128k", delta: float = DELTA_STRENGTH):
    """Test steganography survives OGG Vorbis compression."""
    print(f"\n  OGG {bitrate}...", end=" ", flush=True)

    with tempfile.TemporaryDirectory() as tmpdir:
        input_wav = os.path.join(tmpdir, "input.wav")
        encoded_wav = os.path.join(tmpdir, "encoded.wav")
        decoded_wav = os.path.join(tmpdir, "decoded.wav")

        generate_test_wav(input_wav, duration_sec=30.0)
        message = b"Carnation Radio survives OGG too!"
        key = b"ogg-test-key"

        encode(input_wav, encoded_wav, message, key, delta=delta)
        compress_and_decompress(encoded_wav, decoded_wav, "ogg", bitrate)

        try:
            result = decode(decoded_wav, key)
            if result == message:
                print("PASS")
                return True
            else:
                print(f"FAIL (decoded wrong: {result[:20]!r}...)")
                return False
        except ValueError as e:
            print(f"FAIL ({e})")
            return False


def test_full_pipeline_mp3():
    """Full pipeline: encrypt + embed + MP3 + extract + decrypt."""
    print("\n  Full pipeline (encrypt + embed + MP3 128k + extract + decrypt)...",
          end=" ", flush=True)

    with tempfile.TemporaryDirectory() as tmpdir:
        input_wav = os.path.join(tmpdir, "input.wav")
        encoded_wav = os.path.join(tmpdir, "encoded.wav")
        decoded_wav = os.path.join(tmpdir, "decoded.wav")

        generate_test_wav(input_wav, duration_sec=60.0)
        message = "The revolution will not be televised."
        passphrase = "solidarity-forever"

        hide_message(input_wav, encoded_wav, message, passphrase)
        compress_and_decompress(encoded_wav, decoded_wav, "mp3", "128k")

        try:
            result = reveal_message(decoded_wav, passphrase)
            if result == message:
                print("PASS")
                return True
            else:
                print(f"FAIL (got: {result[:30]!r})")
                return False
        except ValueError as e:
            print(f"FAIL ({e})")
            return False


def measure_bit_error_rate(bitrate="128k"):
    """Measure raw BER after MP3 compression to understand the damage."""
    print(f"\n  Measuring BER after MP3 {bitrate}...")

    from scipy.fft import dct
    from patchwork import (_select_bin_pairs, _extract_bit_from_pair,
                           PAIRS_PER_FRAME, FREQ_BIN_LOW, FREQ_BIN_HIGH)
    import hashlib

    with tempfile.TemporaryDirectory() as tmpdir:
        input_wav = os.path.join(tmpdir, "input.wav")
        encoded_wav = os.path.join(tmpdir, "encoded.wav")
        decoded_wav = os.path.join(tmpdir, "decoded.wav")

        generate_test_wav(input_wav, duration_sec=30.0)
        message = b"BER test"
        key = b"ber-key"
        key_hash = hashlib.sha256(key).digest()

        encode(input_wav, encoded_wav, message, key)
        compress_and_decompress(encoded_wav, decoded_wav, "mp3", bitrate)

        clean, _, _, _ = read_wav(encoded_wav)
        compressed, _, _, _ = read_wav(decoded_wav)

        # Align lengths
        min_len = min(len(clean), len(compressed))
        n_frames = min_len // FRAME_SIZE

        errors = 0
        total = 0
        for frame_i in range(min(n_frames, 500)):
            start = frame_i * FRAME_SIZE
            end = start + FRAME_SIZE

            c_coeffs = dct(clean[start:end], type=2, norm="ortho")
            m_coeffs = dct(compressed[start:end], type=2, norm="ortho")

            pairs = _select_bin_pairs(key_hash, frame_i, PAIRS_PER_FRAME,
                                      FREQ_BIN_LOW, FREQ_BIN_HIGH)
            for bin_a, bin_b in pairs:
                c_bit = _extract_bit_from_pair(c_coeffs, bin_a, bin_b)
                m_bit = _extract_bit_from_pair(m_coeffs, bin_a, bin_b)
                if c_bit != m_bit:
                    errors += 1
                total += 1

        ber = errors / total * 100
        print(f"    Raw BER: {errors}/{total} = {ber:.1f}%")
        return ber


if __name__ == "__main__":
    print("=" * 60)
    print("Carnation Radio - MP3 Compression Survivability Tests")
    print("=" * 60)

    # First, measure the damage
    print("\nPhase 1: Measuring bit error rates...")
    ber_128 = measure_bit_error_rate("128k")
    ber_192 = measure_bit_error_rate("192k")
    ber_320 = measure_bit_error_rate("320k")

    # Then test actual decode
    print("\nPhase 2: Steganography round-trip through MP3...")
    results = {}
    for bitrate in ["320k", "256k", "192k", "128k"]:
        results[f"mp3_{bitrate}"] = test_mp3_roundtrip(bitrate)

    print("\nPhase 3: OGG Vorbis test...")
    try:
        results["ogg_128k"] = test_ogg_roundtrip("128k")
    except subprocess.CalledProcessError:
        print("\n  OGG 128k... SKIP (libvorbis not available)")
        results["ogg_128k"] = None

    print("\nPhase 4: Full encrypted pipeline through MP3...")
    results["full_pipeline"] = test_full_pipeline_mp3()

    print("\n" + "=" * 60)
    print("RESULTS SUMMARY")
    print("=" * 60)
    for name, passed in results.items():
        if passed is None:
            status = "SKIP"
        elif passed:
            status = "PASS"
        else:
            status = "FAIL"
        print(f"  {name:30s} {status}")

    all_pass = all(v for v in results.values() if v is not None)
    print(f"\n{'ALL TESTS PASSED' if all_pass else 'SOME TESTS FAILED'}")
    print("=" * 60)

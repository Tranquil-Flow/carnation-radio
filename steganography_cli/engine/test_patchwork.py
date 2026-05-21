"""
Tests for the patchwork steganography engine.

Tests:
  1. Round-trip encode/decode on synthetic audio
  2. Round-trip on synthetic audio with various message sizes
  3. Robustness after adding noise
  4. Wrong key fails gracefully
  5. Capacity limits
"""

import os
import struct
import tempfile

import numpy as np

from patchwork import encode, decode, read_wav, write_wav, FRAME_SIZE


def generate_test_wav(path: str, duration_sec: float = 10.0,
                      sample_rate: int = 44100) -> None:
    """Generate a synthetic WAV with music-like content (multiple sine waves + noise)."""
    n_samples = int(duration_sec * sample_rate)
    t = np.linspace(0, duration_sec, n_samples, endpoint=False)

    # Simulate music: multiple harmonics + noise
    signal = np.zeros(n_samples, dtype=np.float64)
    freqs = [261.63, 329.63, 392.00, 440.00, 523.25, 659.25, 784.00]  # C major scale
    for i, f in enumerate(freqs):
        amp = 3000.0 / (i + 1)
        signal += amp * np.sin(2 * np.pi * f * t + np.random.uniform(0, 2 * np.pi))

    # Add some noise for realism
    signal += np.random.normal(0, 200, n_samples)

    # Add amplitude envelope (fade in/out)
    envelope = np.ones(n_samples)
    fade = int(0.5 * sample_rate)
    envelope[:fade] = np.linspace(0, 1, fade)
    envelope[-fade:] = np.linspace(1, 0, fade)
    signal *= envelope

    write_wav(path, signal, sample_rate, 1, 2)


def test_basic_roundtrip():
    """Test: encode a message, decode it back, verify identical."""
    print("Test 1: Basic round-trip encode/decode...")

    with tempfile.TemporaryDirectory() as tmpdir:
        input_wav = os.path.join(tmpdir, "input.wav")
        output_wav = os.path.join(tmpdir, "output.wav")

        generate_test_wav(input_wav, duration_sec=60.0)

        message = b"Hello, Carnation Radio! This is a secret message."
        key = b"test-key-12345"

        stats = encode(input_wav, output_wav, message, key)
        print(f"  Encoded: {stats['message_bytes']} bytes, "
              f"{stats['bits_embedded']} bits, "
              f"{stats['frames_used']} frames used")

        decoded = decode(output_wav, key)
        assert decoded == message, f"FAIL: got {decoded!r}, expected {message!r}"
        print(f"  Decoded: {decoded!r}")
        print("  PASS")


def test_various_sizes():
    """Test with different message sizes."""
    print("\nTest 2: Various message sizes...")

    with tempfile.TemporaryDirectory() as tmpdir:
        input_wav = os.path.join(tmpdir, "input.wav")
        generate_test_wav(input_wav, duration_sec=120.0)
        key = b"size-test-key"

        for size in [1, 10, 50, 100]:
            output_wav = os.path.join(tmpdir, f"output_{size}.wav")
            message = bytes(range(256))[:size] if size <= 256 else os.urandom(size)

            stats = encode(input_wav, output_wav, message, key)
            decoded = decode(output_wav, key)
            assert decoded == message, f"FAIL at size {size}: mismatch"
            print(f"  {size:4d} bytes: PASS ({stats['frames_used']} frames)")

    print("  All sizes PASS")


def test_noise_robustness():
    """Test that embedding survives added white noise."""
    print("\nTest 3: Noise robustness...")

    with tempfile.TemporaryDirectory() as tmpdir:
        input_wav = os.path.join(tmpdir, "input.wav")
        output_wav = os.path.join(tmpdir, "output.wav")
        noisy_wav = os.path.join(tmpdir, "noisy.wav")

        generate_test_wav(input_wav, duration_sec=60.0)
        message = b"Noise test message!"
        key = b"noise-key"

        encode(input_wav, output_wav, message, key)

        # Add white noise
        samples, sr, nch, sw = read_wav(output_wav)
        noise_level = 50  # moderate noise
        noise = np.random.normal(0, noise_level, samples.shape)
        noisy = samples + noise
        write_wav(noisy_wav, noisy, sr, nch, sw)

        decoded = decode(noisy_wav, key)
        assert decoded == message, f"FAIL: got {decoded!r}"
        print(f"  Added noise (stddev={noise_level}): PASS")


def test_wrong_key():
    """Test that wrong key fails to decode."""
    print("\nTest 4: Wrong key rejection...")

    with tempfile.TemporaryDirectory() as tmpdir:
        input_wav = os.path.join(tmpdir, "input.wav")
        output_wav = os.path.join(tmpdir, "output.wav")

        generate_test_wav(input_wav, duration_sec=60.0)
        message = b"Secret!"
        key = b"correct-key"
        wrong_key = b"wrong-key"

        encode(input_wav, output_wav, message, key)

        try:
            decoded = decode(output_wav, wrong_key)
            # If it decodes without error, the message should be wrong
            assert decoded != message, "FAIL: wrong key produced correct message"
            print(f"  Wrong key decoded garbage: PASS (got {len(decoded)} bytes of garbage)")
        except ValueError as e:
            print(f"  Wrong key raised ValueError: {e}")
            print("  PASS")


def test_audio_quality():
    """Measure the signal-to-noise ratio of the watermarking."""
    print("\nTest 5: Audio quality (SNR)...")

    with tempfile.TemporaryDirectory() as tmpdir:
        input_wav = os.path.join(tmpdir, "input.wav")
        output_wav = os.path.join(tmpdir, "output.wav")

        generate_test_wav(input_wav, duration_sec=60.0)
        message = b"Quality test message for SNR measurement."
        key = b"snr-key"

        encode(input_wav, output_wav, message, key)

        orig, _, _, _ = read_wav(input_wav)
        wm, _, _, _ = read_wav(output_wav)

        diff = orig.astype(np.float64) - wm.astype(np.float64)
        signal_power = np.mean(orig.astype(np.float64) ** 2)
        noise_power = np.mean(diff ** 2)

        if noise_power > 0:
            snr_db = 10 * np.log10(signal_power / noise_power)
        else:
            snr_db = float("inf")

        print(f"  SNR: {snr_db:.1f} dB")
        print(f"  Max sample diff: {np.max(np.abs(diff)):.1f}")
        print(f"  Mean sample diff: {np.mean(np.abs(diff)):.1f}")
        assert snr_db > 20, f"FAIL: SNR too low ({snr_db:.1f} dB)"
        print("  PASS (SNR > 20 dB)")


def test_capacity():
    """Test encoding near capacity limit."""
    print("\nTest 6: Capacity limit...")

    with tempfile.TemporaryDirectory() as tmpdir:
        input_wav = os.path.join(tmpdir, "input.wav")
        generate_test_wav(input_wav, duration_sec=120.0)
        key = b"capacity-key"

        # Calculate capacity (all frames used with interleaved coding)
        from patchwork import PAIRS_PER_FRAME as ppf, REPETITION as rep
        samples, sr, _, _ = read_wav(input_wav)
        n_frames = len(samples) // FRAME_SIZE
        total_bit_slots = n_frames * ppf
        max_bytes = total_bit_slots // rep // 8 - 8
        print(f"  Audio: {len(samples)} samples, {n_frames} frames")
        print(f"  Max message: ~{max_bytes} bytes")

        # Try 80% of actual max
        test_size = int(max_bytes * 0.8)
        if test_size > 0:
            output_wav = os.path.join(tmpdir, "output_cap.wav")
            message = os.urandom(test_size)
            stats = encode(input_wav, output_wav, message, key)
            decoded = decode(output_wav, key)
            assert decoded == message, f"FAIL: mismatch at {test_size} bytes"
            print(f"  Encoded {test_size} bytes: PASS")
        else:
            print("  SKIP: audio too short")


if __name__ == "__main__":
    print("=" * 60)
    print("Carnation Radio - Patchwork Steganography Tests")
    print("=" * 60)

    test_basic_roundtrip()
    test_various_sizes()
    test_noise_robustness()
    test_wrong_key()
    test_audio_quality()
    test_capacity()

    print("\n" + "=" * 60)
    print("ALL TESTS PASSED")
    print("=" * 60)

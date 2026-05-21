"""Generate cross-compat test fixtures: encode with Python, verify Rust can decode."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../steganography_cli/engine"))

import numpy as np
import hashlib
import json
from patchwork import encode, decode, write_wav, read_wav

# Generate a test WAV file (30 seconds, 44100Hz, mono, 16-bit)
sr = 44100
duration = 30
t = np.arange(sr * duration) / sr
audio = (np.sin(2 * np.pi * 440 * t) * 8000 +
         np.sin(2 * np.pi * 880 * t) * 4000 +
         np.sin(2 * np.pi * 220 * t) * 6000).astype(np.float64)

write_wav("testdata/test_input.wav", audio, sr, 1, 2)

# Encode with known key and message (using carnation.py's key derivation)
passphrase = "test-password-123"
embed_key = hashlib.sha256(b"carnation-embed:" + passphrase.encode()).digest()
message = b"Cross-compat test!"

stats = encode("testdata/test_input.wav", "testdata/test_encoded.wav",
               message, embed_key)
print(f"Encoded: {stats}")

# Verify Python can decode
decoded = decode("testdata/test_encoded.wav", embed_key)
assert decoded == message, f"Python self-check failed: got {decoded!r}"
print("Python self-check passed")

# Save raw f64 samples for Rust
samples, _, _, _ = read_wav("testdata/test_encoded.wav")
if len(samples.shape) > 1:
    samples = samples[:, 0]
samples.astype(np.float64).tofile("testdata/test_encoded_raw.f64")

meta = {
    "embed_key_hex": embed_key.hex(),
    "message": message.decode(),
    "sample_rate": sr,
    "n_samples": len(samples),
}
with open("testdata/cross_compat_meta.json", "w") as f:
    json.dump(meta, f, indent=2)

print(f"Saved {len(samples)} samples to test_encoded_raw.f64")

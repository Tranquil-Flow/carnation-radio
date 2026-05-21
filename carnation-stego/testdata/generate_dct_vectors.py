"""Generate DCT test vectors for Rust cross-compat testing."""
from scipy.fft import dct, idct
import numpy as np
import json

dct_vectors = []
rng = np.random.RandomState(12345)
for i in range(5):
    frame = rng.randn(1024).astype(np.float64) * 10000
    coeffs = dct(frame, type=2, norm="ortho")
    reconstructed = idct(coeffs, type=2, norm="ortho")
    dct_vectors.append({
        "input": frame.tolist(),
        "output": coeffs.tolist(),
        "round_trip_max_error": float(np.max(np.abs(frame - reconstructed))),
    })

with open("carnation-stego/testdata/dct_vectors.json", "w") as f:
    json.dump(dct_vectors, f)

print(f"Generated {len(dct_vectors)} DCT test vectors")

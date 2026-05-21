"""Generate PRNG test vectors for Rust cross-compat testing."""
import hashlib
import struct
import json
import numpy as np

def derive_seed(key: bytes, frame_idx: int) -> int:
    h = hashlib.sha256(key + struct.pack(">I", frame_idx))
    return int.from_bytes(h.digest()[:8], "big")

vectors = []
test_key = hashlib.sha256(b"test-key").digest()

for frame_idx in [0, 1, 42, 100, 9999]:
    seed = derive_seed(test_key, frame_idx)
    rng = np.random.RandomState(seed % (2**31))
    available = list(range(40, 350))
    rng.shuffle(available)
    pairs = [(available[i], available[i+1]) for i in range(0, 12, 2)]
    vectors.append({
        "frame_idx": frame_idx,
        "raw_seed": seed,
        "truncated_seed": seed % (2**31),
        "shuffled_first_20": available[:20],
        "pairs": pairs,
    })

with open("carnation-stego/testdata/prng_vectors.json", "w") as f:
    json.dump({"key_hash_hex": test_key.hex(), "vectors": vectors}, f, indent=2)

print(f"Generated {len(vectors)} test vectors")

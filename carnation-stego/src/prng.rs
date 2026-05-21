use rand_mt::Mt19937GenRand32;
use sha2::{Sha256, Digest};

/// Derive a deterministic PRNG seed from key + frame index.
/// Matches Python: SHA256(key + big_endian_u32(frame_idx)), take first 8 bytes as u64.
pub fn derive_prng_seed(key: &[u8], frame_idx: u32) -> u64 {
    let mut hasher = Sha256::new();
    hasher.update(key);
    hasher.update(frame_idx.to_be_bytes());
    let hash = hasher.finalize();
    u64::from_be_bytes(hash[..8].try_into().unwrap())
}

/// Generate a random integer in [0, max] matching numpy's RandomKit rk_interval.
/// Uses rejection sampling with bitmask (NOT modulo) to match numpy exactly.
fn numpy_randint(rng: &mut Mt19937GenRand32, max: u32) -> u32 {
    if max == 0 {
        return 0;
    }
    // Compute mask: smallest (2^k - 1) >= max
    let mut mask = max;
    mask |= mask >> 1;
    mask |= mask >> 2;
    mask |= mask >> 4;
    mask |= mask >> 8;
    mask |= mask >> 16;
    loop {
        let val = rng.next_u32() & mask;
        if val <= max {
            return val;
        }
    }
}

/// Select n_pairs of distinct frequency bin pairs using key-seeded MT19937.
/// Matches Python's numpy.random.RandomState shuffle exactly.
pub fn select_bin_pairs(
    key: &[u8],
    frame_idx: u32,
    n_pairs: usize,
    bin_low: usize,
    bin_high: usize,
) -> Vec<(usize, usize)> {
    let raw_seed = derive_prng_seed(key, frame_idx);
    let truncated = (raw_seed % (1u64 << 31)) as u32;
    let mut rng = Mt19937GenRand32::new(truncated);

    let mut available: Vec<usize> = (bin_low..bin_high).collect();

    // Fisher-Yates shuffle matching numpy's RandomState.shuffle()
    // numpy uses rk_interval (rejection sampling) for index generation
    let n = available.len();
    for i in (1..n).rev() {
        let j = numpy_randint(&mut rng, i as u32) as usize;
        available.swap(i, j);
    }

    let mut pairs = Vec::with_capacity(n_pairs);
    for i in (0..std::cmp::min(n_pairs * 2, available.len() - 1)).step_by(2) {
        pairs.push((available[i], available[i + 1]));
    }
    pairs.truncate(n_pairs);
    pairs
}

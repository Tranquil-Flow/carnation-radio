use carnation_stego::prng::select_bin_pairs;
use std::fs;

#[derive(serde::Deserialize)]
struct TestVectors {
    key_hash_hex: String,
    vectors: Vec<Vector>,
}

#[derive(serde::Deserialize)]
struct Vector {
    frame_idx: u32,
    #[allow(dead_code)]
    raw_seed: u64,
    #[allow(dead_code)]
    truncated_seed: u32,
    #[allow(dead_code)]
    shuffled_first_20: Vec<usize>,
    pairs: Vec<(usize, usize)>,
}

#[test]
fn test_prng_matches_numpy() {
    let data = fs::read_to_string("testdata/prng_vectors.json").unwrap();
    let tv: TestVectors = serde_json::from_str(&data).unwrap();
    let key = hex::decode(&tv.key_hash_hex).unwrap();

    for v in &tv.vectors {
        let pairs = select_bin_pairs(&key, v.frame_idx, 6, 40, 350);
        assert_eq!(
            pairs, v.pairs,
            "Bin pairs mismatch for frame_idx={}",
            v.frame_idx
        );
    }
}

use carnation_stego::dct::{dct_ii, idct_ii};
use approx::assert_relative_eq;

#[test]
fn test_dct_round_trip() {
    let input: Vec<f64> = (0..1024).map(|i| (i as f64).sin() * 10000.0).collect();
    let coeffs = dct_ii(&input);
    let output = idct_ii(&coeffs);
    for (a, b) in input.iter().zip(output.iter()) {
        assert_relative_eq!(a, b, epsilon = 1e-6);
    }
}

#[test]
fn test_dct_matches_scipy() {
    let data = std::fs::read_to_string("testdata/dct_vectors.json").unwrap();
    let vectors: Vec<serde_json::Value> = serde_json::from_str(&data).unwrap();

    for (idx, v) in vectors.iter().enumerate() {
        let input: Vec<f64> = v["input"].as_array().unwrap()
            .iter().map(|x| x.as_f64().unwrap()).collect();
        let expected: Vec<f64> = v["output"].as_array().unwrap()
            .iter().map(|x| x.as_f64().unwrap()).collect();

        let result = dct_ii(&input);
        assert_eq!(result.len(), expected.len());

        for (i, (r, e)) in result.iter().zip(expected.iter()).enumerate() {
            assert!((r - e).abs() < 1e-6,
                "DCT mismatch at vector {}, index {}: got {} expected {}", idx, i, r, e);
        }
    }
}

#[test]
fn test_idct_matches_scipy() {
    let data = std::fs::read_to_string("testdata/dct_vectors.json").unwrap();
    let vectors: Vec<serde_json::Value> = serde_json::from_str(&data).unwrap();

    for (idx, v) in vectors.iter().enumerate() {
        let input: Vec<f64> = v["input"].as_array().unwrap()
            .iter().map(|x| x.as_f64().unwrap()).collect();
        let coeffs: Vec<f64> = v["output"].as_array().unwrap()
            .iter().map(|x| x.as_f64().unwrap()).collect();

        let reconstructed = idct_ii(&coeffs);

        for (i, (r, e)) in reconstructed.iter().zip(input.iter()).enumerate() {
            assert!((r - e).abs() < 1e-6,
                "IDCT mismatch at vector {}, index {}: got {} expected {}", idx, i, r, e);
        }
    }
}

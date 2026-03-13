/// Embed a single bit by adjusting relative magnitude of two DCT bins.
pub fn embed_bit_in_pair(coeffs: &mut [f64], bin_a: usize, bin_b: usize, bit: u8, delta: f64) {
    let a_val = coeffs[bin_a];
    let b_val = coeffs[bin_b];
    let avg = (a_val.abs() + b_val.abs()) / 2.0;
    let adaptive_delta = delta.max(delta * avg / 500.0);
    let sign_a = if a_val != 0.0 { a_val.signum() } else { 1.0 };
    let sign_b = if b_val != 0.0 { b_val.signum() } else { 1.0 };
    let mid = (a_val.abs() + b_val.abs()) / 2.0;

    if bit == 1 {
        coeffs[bin_a] = sign_a * (mid + adaptive_delta / 2.0);
        coeffs[bin_b] = sign_b * (mid - adaptive_delta / 2.0).max(1.0);
    } else {
        coeffs[bin_a] = sign_a * (mid - adaptive_delta / 2.0).max(1.0);
        coeffs[bin_b] = sign_b * (mid + adaptive_delta / 2.0);
    }
}

/// Extract a single bit by checking relative magnitude of two DCT bins.
pub fn extract_bit_from_pair(coeffs: &[f64], bin_a: usize, bin_b: usize) -> u8 {
    if coeffs[bin_a].abs() >= coeffs[bin_b].abs() {
        1
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_embed_extract_bit_1() {
        let mut coeffs = vec![0.0f64; 512];
        coeffs[100] = 500.0;
        coeffs[200] = 500.0;
        embed_bit_in_pair(&mut coeffs, 100, 200, 1, 200.0);
        assert!(
            coeffs[100].abs() > coeffs[200].abs(),
            "bit 1: bin_a should be larger"
        );
        let extracted = extract_bit_from_pair(&coeffs, 100, 200);
        assert_eq!(extracted, 1);
    }

    #[test]
    fn test_embed_extract_bit_0() {
        let mut coeffs = vec![0.0f64; 512];
        coeffs[100] = 500.0;
        coeffs[200] = 500.0;
        embed_bit_in_pair(&mut coeffs, 100, 200, 0, 200.0);
        assert!(
            coeffs[200].abs() > coeffs[100].abs(),
            "bit 0: bin_b should be larger"
        );
        let extracted = extract_bit_from_pair(&coeffs, 100, 200);
        assert_eq!(extracted, 0);
    }

    #[test]
    fn test_embed_preserves_sign() {
        let mut coeffs = vec![0.0f64; 512];
        coeffs[100] = -300.0;
        coeffs[200] = 400.0;
        embed_bit_in_pair(&mut coeffs, 100, 200, 1, 200.0);
        assert!(coeffs[100] < 0.0, "sign of bin_a should be preserved");
        assert!(coeffs[200] > 0.0, "sign of bin_b should be preserved");
    }

    #[test]
    fn test_round_trip_multiple_bits() {
        let mut coeffs = vec![0.0f64; 512];
        for i in 0..256 {
            coeffs[i] = (i as f64) * 10.0 + 100.0;
        }
        let test_bits = [1u8, 0, 1, 1, 0, 0];
        let pairs = [(40, 41), (50, 51), (60, 61), (70, 71), (80, 81), (90, 91)];
        for (bit, &(a, b)) in test_bits.iter().zip(pairs.iter()) {
            embed_bit_in_pair(&mut coeffs, a, b, *bit, 200.0);
        }
        for (expected, &(a, b)) in test_bits.iter().zip(pairs.iter()) {
            let extracted = extract_bit_from_pair(&coeffs, a, b);
            assert_eq!(
                extracted, *expected,
                "Bit mismatch at pair ({}, {})",
                a, b
            );
        }
    }
}

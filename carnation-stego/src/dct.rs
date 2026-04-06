use std::f64::consts::PI;
use rustfft::{num_complex::Complex, FftPlanner};

/// DCT-II with orthonormal normalization (matches scipy.fft.dct(type=2, norm="ortho")).
/// Uses FFT-based algorithm: O(N log N).
pub fn dct_ii(input: &[f64]) -> Vec<f64> {
    let n = input.len();
    if n == 0 {
        return vec![];
    }

    // Reorder: y[k] = x[2k] for k < ceil(N/2), y[N-1-k] = x[2k+1] for k < N/2
    let mut y = vec![Complex::new(0.0, 0.0); n];
    for k in 0..n.div_ceil(2) {
        y[k] = Complex::new(input[2 * k], 0.0);
    }
    for k in 0..n / 2 {
        y[n - 1 - k] = Complex::new(input[2 * k + 1], 0.0);
    }

    // N-point FFT
    let mut planner = FftPlanner::new();
    let fft = planner.plan_fft_forward(n);
    fft.process(&mut y);

    // Multiply by twiddle factors and extract real part
    let mut result = vec![0.0f64; n];
    let nf = n as f64;
    for k in 0..n {
        let twiddle = Complex::from_polar(1.0, -PI * k as f64 / (2.0 * nf));
        let val = y[k] * twiddle;
        let norm = if k == 0 {
            (1.0 / nf).sqrt()
        } else {
            (2.0 / nf).sqrt()
        };
        result[k] = val.re * norm;
    }
    result
}

/// IDCT-II (inverse DCT-II = DCT-III) with orthonormal normalization.
/// Matches scipy.fft.idct(type=2, norm="ortho").
pub fn idct_ii(coeffs: &[f64]) -> Vec<f64> {
    let n = coeffs.len();
    if n == 0 {
        return vec![];
    }

    let nf = n as f64;

    // Undo normalization and apply twiddle for DCT-III via IFFT
    let mut y = vec![Complex::new(0.0, 0.0); n];
    for k in 0..n {
        let norm = if k == 0 {
            (1.0 / nf).sqrt()
        } else {
            (2.0 / nf).sqrt()
        };
        let scaled = coeffs[k] * norm * nf; // multiply by N because IFFT divides by N
        let twiddle = Complex::from_polar(1.0, PI * k as f64 / (2.0 * nf));
        y[k] = Complex::new(scaled, 0.0) * twiddle;
    }

    // Inverse FFT
    let mut planner = FftPlanner::new();
    let ifft = planner.plan_fft_inverse(n);
    ifft.process(&mut y);

    // rustfft inverse doesn't normalize, so divide by N
    for val in y.iter_mut() {
        *val /= nf;
    }

    // Reverse the reordering: reconstruct x from the reordered sequence
    let mut result = vec![0.0f64; n];
    for k in 0..n.div_ceil(2) {
        result[2 * k] = y[k].re;
    }
    for k in 0..n / 2 {
        result[2 * k + 1] = y[n - 1 - k].re;
    }

    result
}

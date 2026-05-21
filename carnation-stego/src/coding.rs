/// Interleave repeated bits across the full slot space.
pub fn interleave_bits(bits: &[u8], repetition: usize, total_slots: usize) -> Vec<u8> {
    let stride = total_slots / repetition;
    let mut slots = vec![0u8; total_slots];
    for rep_i in 0..repetition {
        let offset = rep_i * stride;
        for (bit_i, &bit) in bits.iter().enumerate() {
            let slot_idx = offset + bit_i;
            if slot_idx < total_slots {
                slots[slot_idx] = bit;
            }
        }
    }
    slots
}

/// Deinterleave and majority vote to recover logical bits.
pub fn deinterleave_vote(raw_bits: &[u8], repetition: usize) -> Vec<u8> {
    let total = raw_bits.len();
    let stride = total / repetition;
    let mut votes: Vec<Vec<u8>> = vec![Vec::new(); stride];
    for rep_i in 0..repetition {
        let offset = rep_i * stride;
        for (bit_i, vote) in votes.iter_mut().enumerate().take(stride) {
            let slot_idx = offset + bit_i;
            if slot_idx < total {
                vote.push(raw_bits[slot_idx]);
            }
        }
    }
    votes.iter().map(|v| {
        if v.is_empty() { 0 }
        else {
            let ones: usize = v.iter().map(|&b| b as usize).sum();
            if ones > v.len() / 2 { 1 } else { 0 }
        }
    }).collect()
}

/// Convert bytes to bits (MSB first).
pub fn bytes_to_bits(data: &[u8]) -> Vec<u8> {
    let mut bits = Vec::with_capacity(data.len() * 8);
    for &byte in data {
        for i in (0..8).rev() {
            bits.push((byte >> i) & 1);
        }
    }
    bits
}

/// Convert bits to bytes (MSB first).
pub fn bits_to_bytes(bits: &[u8]) -> Vec<u8> {
    bits.chunks(8)
        .filter(|chunk| chunk.len() == 8)
        .map(|chunk| chunk.iter().fold(0u8, |acc, &bit| (acc << 1) | bit))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_interleave_deinterleave_round_trip() {
        let bits = vec![1, 0, 1, 1, 0, 0, 1, 0];
        let total_slots = 200;
        let repetition = 17;
        let interleaved = interleave_bits(&bits, repetition, total_slots);
        assert_eq!(interleaved.len(), total_slots);
        let recovered = deinterleave_vote(&interleaved, repetition);
        assert_eq!(&recovered[..bits.len()], &bits[..]);
    }

    #[test]
    fn test_survives_10_percent_errors() {
        let bits = vec![1, 0, 1, 1, 0, 0, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1];
        let total_slots = 500;
        let repetition = 17;
        let mut interleaved = interleave_bits(&bits, repetition, total_slots);
        for i in (0..interleaved.len()).step_by(10) {
            interleaved[i] = 1 - interleaved[i];
        }
        let recovered = deinterleave_vote(&interleaved, repetition);
        assert_eq!(&recovered[..bits.len()], &bits[..]);
    }

    #[test]
    fn test_bytes_bits_round_trip() {
        let data = vec![0xCA, 0xFE, 0xBA, 0xBE];
        let bits = bytes_to_bits(&data);
        assert_eq!(bits.len(), 32);
        let recovered = bits_to_bytes(&bits);
        assert_eq!(recovered, data);
    }
}

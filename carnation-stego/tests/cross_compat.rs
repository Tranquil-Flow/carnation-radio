use carnation_stego::decode;

#[test]
fn test_decode_python_encoded_audio() {
    let meta: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string("testdata/cross_compat_meta.json").unwrap()).unwrap();

    let key = hex::decode(meta["embed_key_hex"].as_str().unwrap()).unwrap();
    let expected_message = meta["message"].as_str().unwrap();
    let n_samples = meta["n_samples"].as_u64().unwrap() as usize;

    let raw_bytes = std::fs::read("testdata/test_encoded_raw.f64").unwrap();
    let samples: Vec<f64> = raw_bytes
        .chunks_exact(8)
        .map(|chunk| f64::from_le_bytes(chunk.try_into().unwrap()))
        .collect();
    assert_eq!(samples.len(), n_samples);

    let decoded_payload = decode(&samples, &key, None).unwrap();

    // Python prototype doesn't emit a version byte, so this is a legacy format.
    // The payload from find_sync_and_extract is the raw message bytes directly.
    // However, our decode returns the raw payload from the wire format (after sync+length).
    // Python doesn't use a version byte, so the first byte is part of the message.
    let parsed = carnation_stego::framing::parse_payload(&decoded_payload).unwrap();

    // Python format: no version byte, so parsed.version should be Legacy
    // and parsed.data should be the full payload (which IS the message)
    // But wait - Python embeds: SYNC + LENGTH + MESSAGE (no version byte)
    // Our decode extracts everything after SYNC + LENGTH.
    // So decoded_payload IS the message directly.
    // parse_payload checks byte 0: 'C' (0x43) from "Cross-compat" -> Legacy
    assert_eq!(
        std::str::from_utf8(&decoded_payload).unwrap(),
        expected_message,
        "Rust failed to decode Python-encoded message"
    );
}

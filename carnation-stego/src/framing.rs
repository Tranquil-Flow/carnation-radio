pub const SYNC_PATTERN: [u8; 4] = [0xCA, 0xFE, 0xBA, 0xBE];

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Version {
    Legacy,
    PasswordRepetition,  // 0x01
    WalletRepetition,    // 0x02
    PasswordBch,         // 0x11
    WalletBch,           // 0x12
}

impl Version {
    pub fn to_byte(&self) -> Option<u8> {
        match self {
            Version::Legacy => None,
            Version::PasswordRepetition => Some(0x01),
            Version::WalletRepetition => Some(0x02),
            Version::PasswordBch => Some(0x11),
            Version::WalletBch => Some(0x12),
        }
    }

    pub fn from_byte(b: u8) -> Version {
        match b {
            0x01 => Version::PasswordRepetition,
            0x02 => Version::WalletRepetition,
            0x11 => Version::PasswordBch,
            0x12 => Version::WalletBch,
            _ => Version::Legacy,
        }
    }
}

pub struct ParsedPayload<'a> {
    pub version: Version,
    pub data: &'a [u8],
}

pub fn build_payload(data: &[u8], version: Version) -> Vec<u8> {
    match version.to_byte() {
        Some(b) => {
            let mut out = Vec::with_capacity(1 + data.len());
            out.push(b);
            out.extend_from_slice(data);
            out
        }
        None => data.to_vec(),
    }
}

pub fn parse_payload(payload: &[u8]) -> Option<ParsedPayload<'_>> {
    if payload.is_empty() {
        return None;
    }
    let version = Version::from_byte(payload[0]);
    match version {
        Version::Legacy => Some(ParsedPayload { version, data: payload }),
        _ => Some(ParsedPayload { version, data: &payload[1..] }),
    }
}

pub fn build_frame(payload: &[u8]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(8 + payload.len());
    frame.extend_from_slice(&SYNC_PATTERN);
    frame.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    frame.extend_from_slice(payload);
    frame
}

pub fn find_sync_and_extract(decoded_bytes: &[u8]) -> Option<Vec<u8>> {
    let sync_idx = decoded_bytes.windows(4).position(|w| w == SYNC_PATTERN)?;
    let len_start = sync_idx + 4;
    if len_start + 4 > decoded_bytes.len() {
        return None;
    }
    let msg_len = u32::from_be_bytes(
        decoded_bytes[len_start..len_start + 4]
            .try_into()
            .ok()?,
    ) as usize;
    let msg_start = len_start + 4;
    if msg_start + msg_len > decoded_bytes.len() {
        return None;
    }
    Some(decoded_bytes[msg_start..msg_start + msg_len].to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_and_parse_payload_v1() {
        let message = b"Hello, world!";
        let payload = build_payload(message, Version::PasswordRepetition);
        assert_eq!(payload[0], 0x01);
        let parsed = parse_payload(&payload).unwrap();
        assert_eq!(parsed.version, Version::PasswordRepetition);
        assert_eq!(parsed.data, message);
    }

    #[test]
    fn test_parse_legacy_python_format() {
        let fake_python_payload = vec![0x42; 100];
        let parsed = parse_payload(&fake_python_payload).unwrap();
        assert_eq!(parsed.version, Version::Legacy);
        assert_eq!(parsed.data, &fake_python_payload[..]);
    }

    #[test]
    fn test_sync_pattern_search() {
        let mut data = vec![0u8; 50];
        data[10..14].copy_from_slice(&SYNC_PATTERN);
        data[14..18].copy_from_slice(&5u32.to_be_bytes());
        data[18..23].copy_from_slice(b"Hello");
        let result = find_sync_and_extract(&data).unwrap();
        assert_eq!(result, b"Hello");
    }

    #[test]
    fn test_build_frame_and_extract() {
        let message = b"test message";
        let payload = build_payload(message, Version::PasswordRepetition);
        let frame_data = build_frame(&payload);
        let extracted = find_sync_and_extract(&frame_data).unwrap();
        let parsed = parse_payload(&extracted).unwrap();
        assert_eq!(parsed.version, Version::PasswordRepetition);
        assert_eq!(parsed.data, message);
    }

    #[test]
    fn test_all_version_bytes() {
        assert_eq!(Version::PasswordRepetition.to_byte(), Some(0x01));
        assert_eq!(Version::WalletRepetition.to_byte(), Some(0x02));
        assert_eq!(Version::PasswordBch.to_byte(), Some(0x11));
        assert_eq!(Version::WalletBch.to_byte(), Some(0x12));
        assert_eq!(Version::Legacy.to_byte(), None);

        assert_eq!(Version::from_byte(0x01), Version::PasswordRepetition);
        assert_eq!(Version::from_byte(0x02), Version::WalletRepetition);
        assert_eq!(Version::from_byte(0x11), Version::PasswordBch);
        assert_eq!(Version::from_byte(0x12), Version::WalletBch);
        assert_eq!(Version::from_byte(0x42), Version::Legacy);
    }
}

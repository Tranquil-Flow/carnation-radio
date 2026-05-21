/**
 * Stego capacity calculations matching carnation-stego engine constants.
 */
const FRAME_SIZE = 1024
const PAIRS_PER_FRAME = 6
const REPETITION = 17
const FRAMING_OVERHEAD = 9  // 4 sync + 4 length + 1 version
const SAMPLE_RATE = 44100

// Password mode: salt(16) + nonce(16) + tag(16)
const PASSWORD_OVERHEAD = 48
// Wallet mode: sender_pub(33) + nonce(12) + tag(16)
const WALLET_OVERHEAD = 61

type Mode = 'password' | 'wallet'

function rawCapacity(durationSeconds: number): number {
  const samples = Math.floor(durationSeconds * SAMPLE_RATE)
  const frames = Math.floor(samples / FRAME_SIZE)
  const bitSlots = frames * PAIRS_PER_FRAME
  return Math.floor(bitSlots / REPETITION / 8) - FRAMING_OVERHEAD
}

/** Max plaintext bytes that fit in audio of given duration. */
export function maxMessageBytes(durationSeconds: number, mode: Mode = 'password'): number {
  const overhead = mode === 'wallet' ? WALLET_OVERHEAD : PASSWORD_OVERHEAD
  return Math.max(0, rawCapacity(durationSeconds) - overhead)
}

/** Minimum audio duration (seconds) needed for a message of given byte length. */
export function minDurationSeconds(messageBytes: number, mode: Mode = 'password'): number {
  const overhead = mode === 'wallet' ? WALLET_OVERHEAD : PASSWORD_OVERHEAD
  const payloadBytes = messageBytes + FRAMING_OVERHEAD + overhead
  const bitSlots = payloadBytes * 8 * REPETITION
  const frames = Math.ceil(bitSlots / PAIRS_PER_FRAME)
  const samples = frames * FRAME_SIZE
  return Math.ceil(samples / SAMPLE_RATE)
}

/** Get duration of an audio File via HTML5 Audio element. */
export function getAudioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio()
    const url = URL.createObjectURL(file)
    audio.addEventListener('loadedmetadata', () => {
      URL.revokeObjectURL(url)
      resolve(audio.duration)
    })
    audio.addEventListener('error', () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read audio duration'))
    })
    audio.src = url
  })
}

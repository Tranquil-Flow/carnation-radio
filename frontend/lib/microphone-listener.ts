import { ofdmDecodePayload } from './acoustic-ofdm'

export type DecodeStatus =
  | { kind: 'listening' }
  | { kind: 'preamble-detected'; detail: string }
  | { kind: 'decoded'; payload: Uint8Array }

export type StegoDecodeFn = (samples: Float64Array) => Promise<Uint8Array | null>

export interface ListenerOptions {
  sampleRate?: number
  frameSamples?: number
  rollingWindowSeconds?: number
  decodeIntervalFrames?: number
  minFramesBeforeFirstDecode?: number
}

const DEFAULTS = {
  sampleRate: 44100,
  frameSamples: 1024,
  // ~30s rolling buffer is enough for one acoustic packet at the longest expected message size,
  // and bounds memory at ~10.6MB of Float64Array.
  rollingWindowSeconds: 30,
  // Attempt a decode roughly once per second (44100 / 1024 ≈ 43 frames).
  decodeIntervalFrames: 43,
  // Wait for ~3s of audio before the first attempt — enough samples for a short preamble lock.
  minFramesBeforeFirstDecode: 130,
}

/**
 * Bounded ring buffer over Float64Array frames produced by the AudioWorklet.
 * Concatenates contiguously on demand for the FSK decoder.
 */
export class MicrophoneFrameBuffer {
  private readonly frames: Float64Array[] = []
  private readonly capacityFrames: number
  private totalDropped = 0

  constructor(capacityFrames: number) {
    this.capacityFrames = capacityFrames
  }

  push(frame: Float64Array): void {
    this.frames.push(frame)
    while (this.frames.length > this.capacityFrames) {
      this.frames.shift()
      this.totalDropped++
    }
  }

  size(): number {
    return this.frames.length
  }

  /** Approximate seconds buffered, given the configured frame and sample rate. */
  seconds(frameSamples: number, sampleRate: number): number {
    return (this.frames.length * frameSamples) / sampleRate
  }

  contiguous(): Float64Array {
    if (this.frames.length === 0) return new Float64Array(0)
    const total = this.frames.reduce((sum, f) => sum + f.length, 0)
    const out = new Float64Array(total)
    let offset = 0
    for (const f of this.frames) {
      out.set(f, offset)
      offset += f.length
    }
    return out
  }
}

/**
 * Lightweight scheduler around the acoustic FSK decoder. Tracks the most-informative
 * error so the UI can show "preamble detected" once any reasonable lock occurs.
 */
export class AcousticListener {
  readonly options: Required<ListenerOptions>
  private readonly buffer: MicrophoneFrameBuffer
  private framesSeen = 0
  private nextDecodeAtFrame: number
  private decoding = false
  private lastError: string | null = null
  private preambleEverDetected = false

  constructor(options: ListenerOptions = {}) {
    this.options = { ...DEFAULTS, ...options } as Required<ListenerOptions>
    const capacity = Math.ceil(
      (this.options.rollingWindowSeconds * this.options.sampleRate) / this.options.frameSamples,
    )
    this.buffer = new MicrophoneFrameBuffer(capacity)
    this.nextDecodeAtFrame = this.options.minFramesBeforeFirstDecode
  }

  /** Push a worklet frame; returns true when caller should call tryDecode now. */
  push(frame: Float64Array): boolean {
    this.buffer.push(frame)
    this.framesSeen++
    if (this.decoding) return false
    if (this.framesSeen < this.options.minFramesBeforeFirstDecode) return false
    if (this.framesSeen >= this.nextDecodeAtFrame) {
      this.nextDecodeAtFrame = this.framesSeen + this.options.decodeIntervalFrames
      return true
    }
    return false
  }

  /**
   * Attempt one decode of the current rolling buffer. Returns the decoded payload on
   * success, or a status describing how far the decoder got. Safe to call from a
   * `void` context; the listener will skip overlapping invocations.
   */
  async tryDecode(): Promise<DecodeStatus> {
    if (this.decoding) return { kind: 'listening' }
    this.decoding = true
    try {
      const samples = this.buffer.contiguous()
      if (samples.length === 0) return { kind: 'listening' }
      try {
        const payload = ofdmDecodePayload(samples)
        return { kind: 'decoded', payload }
      } catch (err: any) {
        const message = err?.message || String(err)
        this.lastError = message
        if (!message.includes('preamble not found')) {
          this.preambleEverDetected = true
          return { kind: 'preamble-detected', detail: message }
        }
        return { kind: 'listening' }
      }
    } finally {
      this.decoding = false
    }
  }

  elapsedSeconds(): number {
    return (this.framesSeen * this.options.frameSamples) / this.options.sampleRate
  }

  hadPreamble(): boolean {
    return this.preambleEverDetected
  }

  getLastError(): string | null {
    return this.lastError
  }

  /** Snapshot for test / debug. */
  bufferedSeconds(): number {
    return this.buffer.seconds(this.options.frameSamples, this.options.sampleRate)
  }
}

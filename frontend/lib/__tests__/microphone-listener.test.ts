import { describe, expect, it } from 'vitest'
import { AcousticListener, MicrophoneFrameBuffer } from '../microphone-listener'
import { acousticEncodePayload, DEFAULT_BIT_SAMPLES, DEFAULT_REPEATS } from '../acoustic'

const FRAME_SAMPLES = 1024
const SAMPLE_RATE = 44100

function framesFromSamples(samples: Float64Array, frameSize = FRAME_SAMPLES): Float64Array[] {
  const frames: Float64Array[] = []
  for (let i = 0; i < samples.length; i += frameSize) {
    const slice = new Float64Array(frameSize)
    const end = Math.min(samples.length - i, frameSize)
    slice.set(samples.subarray(i, i + end))
    frames.push(slice)
  }
  return frames
}

describe('MicrophoneFrameBuffer', () => {
  it('keeps only the most recent capacity frames', () => {
    const buf = new MicrophoneFrameBuffer(3)
    for (let i = 0; i < 5; i++) {
      const frame = new Float64Array(FRAME_SAMPLES)
      frame[0] = i
      buf.push(frame)
    }
    expect(buf.size()).toBe(3)
    const contiguous = buf.contiguous()
    // Oldest two dropped; remaining heads should be 2, 3, 4 at frame boundaries.
    expect(contiguous[0]).toBe(2)
    expect(contiguous[FRAME_SAMPLES]).toBe(3)
    expect(contiguous[FRAME_SAMPLES * 2]).toBe(4)
  })

  it('reports buffered seconds correctly', () => {
    const buf = new MicrophoneFrameBuffer(100)
    for (let i = 0; i < 43; i++) buf.push(new Float64Array(FRAME_SAMPLES))
    // 43 frames * 1024 / 44100 ≈ 0.998s
    expect(buf.seconds(FRAME_SAMPLES, SAMPLE_RATE)).toBeCloseTo(0.998, 2)
  })
})

describe('AcousticListener', () => {
  it('does not trigger a decode before minFramesBeforeFirstDecode', () => {
    const listener = new AcousticListener({ minFramesBeforeFirstDecode: 10, decodeIntervalFrames: 5 })
    for (let i = 0; i < 9; i++) {
      const ready = listener.push(new Float64Array(FRAME_SAMPLES))
      expect(ready).toBe(false)
    }
  })

  it('triggers decode at min threshold, then on each interval', () => {
    const listener = new AcousticListener({ minFramesBeforeFirstDecode: 10, decodeIntervalFrames: 5 })
    const triggers: number[] = []
    for (let i = 1; i <= 25; i++) {
      if (listener.push(new Float64Array(FRAME_SAMPLES))) triggers.push(i)
    }
    expect(triggers).toEqual([10, 15, 20, 25])
  })

  it('decodes an FSK payload pushed frame-by-frame', async () => {
    const payload = new TextEncoder().encode('bella ciao physical')
    const encoded = acousticEncodePayload(payload)
    const listener = new AcousticListener({
      // Push every frame; decode once at the end. The full multi-offset/multi-ratio search
      // is O(buffer) per attempt, so we don't run it on every frame in tests.
      minFramesBeforeFirstDecode: 1_000_000,
      decodeIntervalFrames: 1_000_000,
      rollingWindowSeconds: 60,
    })
    for (const frame of framesFromSamples(encoded)) listener.push(frame)
    const status = await listener.tryDecode()
    expect(status.kind).toBe('decoded')
    if (status.kind === 'decoded') {
      expect(new TextDecoder().decode(status.payload)).toBe('bella ciao physical')
    }
  })

  it('reports preamble-detected once acoustic decoder partially locks', async () => {
    const payload = new TextEncoder().encode('partial lock test with extra bytes for damage')
    const encoded = acousticEncodePayload(payload)
    // Zero out 20 payload bytes (160 bits) — beyond RS(255,223)'s 16-byte correction capacity —
    // so RS fails and the listener surfaces "checksum mismatch" (preamble + magic both succeeded).
    const corrupted = new Float64Array(encoded)
    const bitWindow = DEFAULT_REPEATS * DEFAULT_BIT_SAMPLES
    for (let i = 128 * bitWindow; i < (128 + 20 * 8) * bitWindow && i < corrupted.length; i++) corrupted[i] = 0

    const listener = new AcousticListener({
      minFramesBeforeFirstDecode: 1,
      decodeIntervalFrames: 1000, // only the first auto-trigger fires within this test
      rollingWindowSeconds: 120, // packet is ~62s after RS expansion; buffer must hold full preamble + packet
    })
    for (const frame of framesFromSamples(corrupted)) listener.push(frame)
    const status = await listener.tryDecode()
    expect(status.kind).toBe('preamble-detected')
    if (status.kind === 'preamble-detected') {
      expect(status.detail).toMatch(/checksum mismatch/i)
    }
    expect(listener.hadPreamble()).toBe(true)
  })

  it('elapsedSeconds advances with each pushed frame regardless of buffer drop', () => {
    const listener = new AcousticListener({
      rollingWindowSeconds: 0.1, // ~4 frames capacity
      minFramesBeforeFirstDecode: 1000,
    })
    for (let i = 0; i < 100; i++) listener.push(new Float64Array(FRAME_SAMPLES))
    // 100 frames * 1024 / 44100 ≈ 2.32s
    expect(listener.elapsedSeconds()).toBeCloseTo(2.32, 1)
    expect(listener.bufferedSeconds()).toBeLessThan(0.2)
  })
})

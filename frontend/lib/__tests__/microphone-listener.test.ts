import { describe, expect, it } from 'vitest'
import { AcousticListener, MicrophoneFrameBuffer } from '../microphone-listener'
import { ofdmEncodePayload, OFDM_BIT_SAMPLES, OFDM_REPEATS } from '../acoustic-ofdm'

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

  it('decodes an OFDM payload pushed frame-by-frame', async () => {
    const payload = new TextEncoder().encode('bella ciao physical')
    const encoded = ofdmEncodePayload(payload)
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
    const encoded = ofdmEncodePayload(payload)
    // Zero out a span of data symbols past the preamble: 48 preamble symbols
    // (replicated across bands) then ~20 data symbols of corruption. Each symbol
    // is OFDM_REPEATS × OFDM_BIT_SAMPLES samples. Knocking out enough samples
    // forces enough byte errors to defeat RS, exposing the checksum mismatch path.
    const corrupted = new Float64Array(encoded)
    const symbolWindow = OFDM_REPEATS * OFDM_BIT_SAMPLES
    const corruptStart = 48 * symbolWindow
    const corruptEnd = (48 + 30) * symbolWindow
    for (let i = corruptStart; i < corruptEnd && i < corrupted.length; i++) corrupted[i] = 0

    const listener = new AcousticListener({
      minFramesBeforeFirstDecode: 1,
      decodeIntervalFrames: 1000, // only the first auto-trigger fires within this test
      rollingWindowSeconds: 60,
    })
    for (const frame of framesFromSamples(corrupted)) listener.push(frame)
    const status = await listener.tryDecode()
    expect(status.kind).toBe('preamble-detected')
    if (status.kind === 'preamble-detected') {
      expect(status.detail).toMatch(/checksum mismatch|magic mismatch/i)
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

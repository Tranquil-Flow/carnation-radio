import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

let ffmpeg: FFmpeg | null = null

async function loadFFmpeg(): Promise<FFmpeg> {
  if (ffmpeg?.loaded) return ffmpeg
  ffmpeg = new FFmpeg()
  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm'
  await ffmpeg.load({
    // Use standalone worker script to bypass webpack's import() interception.
    // Webpack replaces dynamic import() inside bundled workers with a dummy module
    // that always throws "Cannot find module". Our public/ffmpeg-worker.js runs
    // outside webpack's scope and uses native browser import() for blob URLs.
    classWorkerURL: await toBlobURL('/ffmpeg-worker.js', 'text/javascript'),
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
  })
  return ffmpeg
}

export async function toWav(file: File): Promise<Float64Array> {
  const ff = await loadFFmpeg()
  await ff.writeFile('input', await fetchFile(file))
  await ff.exec(['-i', 'input', '-ar', '44100', '-ac', '1', '-f', 's16le', '-acodec', 'pcm_s16le', 'output.raw'])
  const data = await ff.readFile('output.raw')
  const int16 = new Int16Array((data as Uint8Array).buffer)
  const float64 = new Float64Array(int16.length)
  for (let i = 0; i < int16.length; i++) float64[i] = int16[i]
  return float64
}

export async function toMp3(samples: Float64Array, sampleRate = 44100): Promise<Blob> {
  const ff = await loadFFmpeg()
  const int16 = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++)
    int16[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i])))
  await ff.writeFile('input.raw', new Uint8Array(int16.buffer))
  await ff.exec(['-f', 's16le', '-ar', String(sampleRate), '-ac', '1', '-i', 'input.raw', '-b:a', '320k', '-y', 'output.mp3'])
  const data = await ff.readFile('output.mp3')
  return new Blob([data], { type: 'audio/mpeg' })
}

export async function toWavBlob(samples: Float64Array, sampleRate = 44100): Promise<Blob> {
  const ff = await loadFFmpeg()
  const int16 = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++)
    int16[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i])))
  await ff.writeFile('input.raw', new Uint8Array(int16.buffer))
  await ff.exec(['-f', 's16le', '-ar', String(sampleRate), '-ac', '1', '-i', 'input.raw', '-y', 'output.wav'])
  const data = await ff.readFile('output.wav')
  return new Blob([data], { type: 'audio/wav' })
}

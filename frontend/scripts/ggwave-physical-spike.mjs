#!/usr/bin/env node
// Standalone ggwave feasibility test — bypasses Carnation's UI entirely.
//
// Pipeline:
//   1. Encode "bella ciao physical" via ggwave AUDIBLE_FAST → WAV file
//   2. SCP WAV to m4pro
//   3. ssh m4pro: afplay the WAV
//   4. ffmpeg: record this laptop's mic for ~40 seconds (concurrent with playback)
//   5. Load the recording, feed to ggwave decoder
//   6. Report whether decode matches the original message
//
// Run with:  PLAY_ON=m4pro node scripts/ggwave-physical-spike.mjs
// Or local:  node scripts/ggwave-physical-spike.mjs        (afplay locally)

import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TX_WAV = '/tmp/carnation-ggwave-tx.wav'
const RX_WAV = '/tmp/carnation-ggwave-rx.wav'
const REMOTE_WAV = '/tmp/carnation-ggwave-tx.wav'
const MESSAGE = 'bella ciao physical'
const PLAY_ON = process.env.PLAY_ON || 'local'
const RECORD_SECONDS = 45

const log = (m) => console.log(`[ggwave-spike] ${m}`)

function writeWavInt16Mono(samples, sampleRate, outPath) {
  // Simple WAV file writer for int16 mono PCM
  const dataLen = samples.length * 2
  const buf = Buffer.alloc(44 + dataLen)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataLen, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16) // chunk size
  buf.writeUInt16LE(1, 20)  // PCM
  buf.writeUInt16LE(1, 22)  // mono
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28) // bytes/sec
  buf.writeUInt16LE(2, 32)  // block align
  buf.writeUInt16LE(16, 34) // bits/sample
  buf.write('data', 36)
  buf.writeUInt32LE(dataLen, 40)
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-32768, Math.min(32767, Math.round(samples[i])))
    buf.writeInt16LE(v, 44 + i * 2)
  }
  fsSync.writeFileSync(outPath, buf)
}

function readWavInt16Mono(filePath) {
  const buf = fsSync.readFileSync(filePath)
  // Find data chunk
  let offset = 12
  let sampleRate = 0
  let channels = 1
  let bitsPerSample = 16
  while (offset < buf.length - 8) {
    const chunkId = buf.toString('ascii', offset, offset + 4)
    const chunkSize = buf.readUInt32LE(offset + 4)
    if (chunkId === 'fmt ') {
      channels = buf.readUInt16LE(offset + 10)
      sampleRate = buf.readUInt32LE(offset + 12)
      bitsPerSample = buf.readUInt16LE(offset + 22)
    } else if (chunkId === 'data') {
      const dataStart = offset + 8
      const bytesPerSample = bitsPerSample / 8
      const sampleCount = chunkSize / bytesPerSample
      const samples = new Float32Array(Math.floor(sampleCount / channels))
      for (let i = 0; i < samples.length; i++) {
        // Take first channel only
        if (bitsPerSample === 16) {
          samples[i] = buf.readInt16LE(dataStart + i * channels * 2) / 32768
        } else if (bitsPerSample === 32) {
          // Could be float or int — assume float for safety
          samples[i] = buf.readFloatLE(dataStart + i * channels * 4)
        }
      }
      return { samples, sampleRate, channels: 1 }
    }
    offset += 8 + chunkSize
  }
  throw new Error('No data chunk found in WAV file')
}

async function main() {
  log(`Loading ggwave...`)
  const factory = (await import('ggwave')).default
  const g = await factory()
  const params = g.getDefaultParameters()
  const inst = g.init(params)
  log(`ggwave instance ready, sampleRate=${params.sampleRateInp}`)

  log(`Encoding "${MESSAGE}"`)
  const waveformFloat = g.encode(inst, MESSAGE, g.ProtocolId.GGWAVE_PROTOCOL_AUDIBLE_FAST, 25)
  // ggwave returns Float32Array in [-1, 1]; scale to int16
  const wfInt = new Int16Array(waveformFloat.length)
  for (let i = 0; i < waveformFloat.length; i++) {
    wfInt[i] = Math.max(-32768, Math.min(32767, Math.round(waveformFloat[i] * 32767)))
  }
  log(`Waveform: ${waveformFloat.length} samples = ${(waveformFloat.length / params.sampleRateInp).toFixed(2)}s`)
  writeWavInt16Mono(wfInt, params.sampleRateInp, TX_WAV)
  log(`Wrote TX WAV: ${TX_WAV}`)

  // Start mic recording
  log(`Starting mic recording (${RECORD_SECONDS}s) -> ${RX_WAV}`)
  // Delete prior file
  try { await fs.unlink(RX_WAV) } catch {}
  const rec = spawn('ffmpeg', [
    '-f', 'avfoundation',
    '-i', ':0', // default mic
    '-t', String(RECORD_SECONDS),
    '-ac', '1',
    '-ar', String(params.sampleRateInp),
    '-y',
    RX_WAV,
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  // Slurp stderr to avoid pipe backpressure
  rec.stderr.on('data', () => {})

  // Wait 2s for mic to initialize
  await new Promise((r) => setTimeout(r, 2000))

  // Start playback
  let playProc
  if (PLAY_ON === 'local') {
    log(`afplay loop (local)`)
    playProc = spawn('bash', ['-c', `for i in 1 2 3; do afplay "${TX_WAV}" || break; done`], { stdio: 'inherit' })
  } else {
    log(`SCP to ${PLAY_ON}:${REMOTE_WAV}`)
    execFileSync('scp', ['-q', TX_WAV, `${PLAY_ON}:${REMOTE_WAV}`], { stdio: 'inherit' })
    log(`SSH afplay on ${PLAY_ON}`)
    playProc = spawn('ssh', [PLAY_ON, `for i in 1 2 3; do afplay ${REMOTE_WAV} || break; done`], { stdio: 'inherit' })
  }

  // Wait for recording to finish
  await new Promise((resolve) => rec.on('close', resolve))
  log(`Recording finished`)

  // Stop playback
  if (playProc && !playProc.killed) playProc.kill('SIGTERM')
  if (PLAY_ON !== 'local') {
    try { execFileSync('ssh', [PLAY_ON, 'pkill -9 afplay 2>/dev/null; true'], { stdio: 'ignore' }) } catch {}
  }

  // Load and decode
  log(`Loading recording...`)
  const { samples, sampleRate } = readWavInt16Mono(RX_WAV)
  log(`Recorded: ${samples.length} samples at ${sampleRate}Hz = ${(samples.length / sampleRate).toFixed(2)}s`)

  // ggwave decode expects Float32Array or Int16Array
  // We have Float32 in [-1,1]; ggwave wants int16 PCM
  const rxInt = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    rxInt[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767)))
  }
  log(`Decoding...`)
  const decoded = g.decode(inst, rxInt)
  if (decoded instanceof Uint8Array || decoded instanceof Int8Array) {
    const text = new TextDecoder().decode(decoded)
    log(`✅ DECODED: "${text}"`)
    if (text === MESSAGE) {
      log(`✅ PASS — matches expected "${MESSAGE}"`)
      process.exitCode = 0
    } else {
      log(`❌ FAIL — text mismatch`)
      process.exitCode = 2
    }
  } else if (decoded == null || (decoded.length === 0)) {
    log(`❌ FAIL — no message decoded from recording`)
    process.exitCode = 1
  } else {
    log(`Decoded raw: ${JSON.stringify(decoded).slice(0, 200)}`)
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error(`[ggwave-spike] fatal: ${e?.stack || e}`)
  process.exitCode = 1
})

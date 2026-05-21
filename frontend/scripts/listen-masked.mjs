#!/usr/bin/env node
// Drives the browser to encode bella-ciao.wav using the experimental masked
// (psychoacoustic-DSSS) codec, then plays the encoded WAV through this Mac's
// speakers so the user can A/B against the original.
//
// Usage:
//   node scripts/listen-masked.mjs               # encode at alpha=1.0, play
//   node scripts/listen-masked.mjs original      # just play the original
//   node scripts/listen-masked.mjs both          # alternate: orig 6s, encoded 6s, orig 6s, ...
//
// Assumes the Next.js dev server is already running at http://localhost:3001.

import { chromium, devices } from '@playwright/test'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'

const MUSIC_WAV = path.resolve(process.env.HOME || '', 'Downloads/bella-ciao.wav')
const ENCODED_WAV = '/tmp/carnation-bella-masked-alpha1.wav'
const BASE_URL = 'http://localhost:3001'
const PASSPHRASE = 'test'
const MESSAGE = 'hi'

const log = (m) => console.log(`[listen] ${m}`)
const mode = process.argv[2] || 'encode-and-play'

async function encode() {
  log(`Launching headed Chromium...`)
  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext({ ...devices['Desktop Chrome'], acceptDownloads: true })
  const page = await context.newPage()
  const consoleLogs = []
  page.on('console', (m) => consoleLogs.push(`[${m.type()}] ${m.text()}`))
  page.on('pageerror', (e) => consoleLogs.push(`[pageerror] ${e.message}\n${e.stack || ''}`))

  try {
    log(`Goto ${BASE_URL}`)
    await page.goto(BASE_URL, { timeout: 60_000 })
    await page.locator('header h1', { hasText: 'Carnation Radio' }).waitFor({ timeout: 60_000 })

    log(`Encode tab → upload bella-ciao.wav`)
    await page.getByTestId('tab-encode').click()
    await page.getByTestId('audio-upload-encode').setInputFiles(MUSIC_WAV)
    await page.getByPlaceholder('Type your hidden message...').fill(MESSAGE)
    await page.getByPlaceholder('Enter passphrase...').fill(PASSPHRASE)

    log(`Select 'Masked (experimental)' codec`)
    await page.getByTestId('codec-masked').click()

    log(`Click Encode`)
    await page.getByTestId('btn-encode').click()

    log(`Waiting for download link (encoding can take ~30-60s for a full song)...`)
    const downloadLink = page.getByTestId('download-link')
    await downloadLink.waitFor({ timeout: 240_000 })

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60_000 }),
      downloadLink.click(),
    ])
    await download.saveAs(ENCODED_WAV)
    const stat = await fs.stat(ENCODED_WAV)
    log(`Encoded WAV saved: ${ENCODED_WAV} (${(stat.size / 1048576).toFixed(1)} MB)`)
  } catch (err) {
    log(`ERROR: ${err.message}`)
    log(`--- console logs ---`)
    consoleLogs.forEach((l) => console.log(`  ${l}`))
    throw err
  } finally {
    await browser.close()
  }
}

function afplay(file, label) {
  return new Promise((resolve, reject) => {
    log(`▶ Playing ${label}: ${file}`)
    const p = spawn('afplay', [file], { stdio: 'inherit' })
    p.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`afplay exit ${code}`)))
  })
}

function afplayClip(file, seconds, label) {
  // Use `afplay -t N` to play first N seconds, then stop. macOS afplay supports -t.
  return new Promise((resolve, reject) => {
    log(`▶ ${label} (${seconds}s)`)
    const p = spawn('afplay', ['-t', String(seconds), file], { stdio: 'inherit' })
    p.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`afplay exit ${code}`)))
  })
}

async function main() {
  if (mode === 'original') {
    await afplay(MUSIC_WAV, 'ORIGINAL bella-ciao.wav (full)')
    return
  }
  if (!fsSync.existsSync(ENCODED_WAV) || mode === 'encode-and-play' || mode === 'reencode') {
    await encode()
  } else {
    log(`Re-using cached encoded WAV: ${ENCODED_WAV}`)
  }

  if (mode === 'both') {
    log(``)
    log(`=== A/B comparison (8s clips alternating) ===`)
    log(`Listen for hiss or shimmer in the 2-6 kHz range on the ENCODED clip.`)
    log(``)
    for (let round = 1; round <= 3; round++) {
      log(`--- Round ${round} ---`)
      await afplayClip(MUSIC_WAV, 8, '🅰 ORIGINAL')
      await new Promise(r => setTimeout(r, 500))
      await afplayClip(ENCODED_WAV, 8, '🅱 ENCODED (masked, α=1.0)')
      await new Promise(r => setTimeout(r, 1000))
    }
    log(``)
    log(`Done. Did the ENCODED clip sound different?`)
  } else {
    log(``)
    log(`=== Playing ENCODED WAV in full ===`)
    log(`Listen for hiss / shimmer that wasn't in the original.`)
    await afplay(ENCODED_WAV, 'ENCODED (masked, α=1.0)')
  }
}

main().catch((e) => {
  console.error(`[listen] fatal: ${e?.stack || e}`)
  process.exit(1)
})

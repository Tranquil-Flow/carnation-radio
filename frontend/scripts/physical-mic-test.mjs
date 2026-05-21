#!/usr/bin/env node
// Drives the real getUserMedia → AudioWorklet decode path with the encoded WAV
// played through real speakers into the real microphone.
//
// Run modes:
//   node scripts/physical-mic-test.mjs            # local: this Mac's speakers + mic
//   PLAY_ON=m4pro node scripts/physical-mic-test.mjs   # two-device: m4pro plays, this mic decodes
//
// Assumes the Next.js dev server is already running at http://localhost:3000.

import { chromium, devices } from '@playwright/test'
import { spawn, execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs/promises'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_WAV = path.resolve(__dirname, '../e2e/fixtures/.acoustic-generated.wav')
// Use a real song instead of the engineering 60-second 440 Hz sine wave that ships
// as the unit-test fixture. Bella Ciao is 127s of stereo broadband music — exercises
// the codec against a realistic spectrum.
const MUSIC_WAV = path.resolve(process.env.HOME || '', 'Downloads/bella-ciao.wav')
const PASSPHRASE = 'live-test-2026'
const EXPECTED_MESSAGE = 'bella ciao physical'
const BASE_URL = 'http://localhost:3000'
const DECODE_TIMEOUT_MS = 150_000
const PLAY_ON = process.env.PLAY_ON || 'local' // 'local' or an SSH host like 'm4pro'
const REMOTE_WAV_PATH = '/tmp/carnation-two-device.wav'

const log = (msg) => console.log(`[physical-test] ${msg}`)

async function main() {
  log(`Fixture: ${FIXTURE_WAV}`)
  log(`Launching headed Chromium with mic permission pre-granted`)

  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext({ ...devices['Desktop Chrome'], acceptDownloads: true })
  await context.grantPermissions(['microphone'], { origin: BASE_URL })

  const consoleLogs = []
  const page = await context.newPage()
  page.on('console', (m) => consoleLogs.push(`[${m.type()}] ${m.text()}`))
  page.on('pageerror', (e) => consoleLogs.push(`[pageerror] ${e.message}\n${e.stack || ''}`))

  let afplayProc = null
  try {
    log(`Goto ${BASE_URL}`)
    await page.goto(BASE_URL, { timeout: 60_000 })
    log(`Wait for hydration (header h1)`)
    try {
      await page.locator('header h1', { hasText: 'Carnation Radio' }).waitFor({ timeout: 60_000 })
    } catch (err) {
      log(`Hydration wait failed. Console log dump:`)
      consoleLogs.forEach((l) => console.log(`  ${l}`))
      throw err
    }

    log(`Re-encoding fixture WAV (picks up any acoustic.ts amplitude changes)`)
    await page.getByTestId('tab-encode').click()
    await page.getByTestId('audio-upload-encode').setInputFiles(MUSIC_WAV)
    await page.getByPlaceholder('Type your hidden message...').fill(EXPECTED_MESSAGE)
    await page.getByPlaceholder('Enter passphrase...').fill(PASSPHRASE)
    await page.getByTestId('checkbox-acoustic-carrier').check()
    await page.getByTestId('btn-encode').click()
    const downloadLink = page.getByTestId('download-link')
    await downloadLink.waitFor({ timeout: 90_000 })
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 90_000 }),
      downloadLink.click(),
    ])
    await fs.mkdir(path.dirname(FIXTURE_WAV), { recursive: true })
    await download.saveAs(FIXTURE_WAV)
    const stat = await fs.stat(FIXTURE_WAV)
    log(`Encoded ${stat.size} bytes (${(stat.size / 88200).toFixed(1)}s of 16-bit mono 44.1kHz audio)`)

    log(`Setup decode UI`)
    await page.getByTestId('tab-decode').click()
    await page.getByTestId('decode-method-mic').click()
    await page.getByPlaceholder('Enter passphrase...').fill(PASSPHRASE)

    log(`Start microphone listening`)
    await page.getByTestId('btn-start-microphone').click()
    await page.getByTestId('mic-listening-panel').waitFor({ timeout: 10_000 })

    // Give the worklet 1s to initialize before starting playback so the start of
    // the FSK preamble is actually captured.
    await page.waitForTimeout(1_000)

    // Play the WAV in a loop so multiple full packet copies pass through the mic.
    if (PLAY_ON === 'local') {
      log(`afplay loop starting on LOCAL speakers`)
      afplayProc = spawn(
        'bash',
        ['-c', `for i in 1 2 3; do afplay "${FIXTURE_WAV}" || break; done`],
        { stdio: 'inherit' },
      )
    } else {
      log(`Copying WAV to ${PLAY_ON}:${REMOTE_WAV_PATH}`)
      execFileSync('scp', ['-q', FIXTURE_WAV, `${PLAY_ON}:${REMOTE_WAV_PATH}`], { stdio: 'inherit' })
      log(`afplay loop starting on REMOTE host ${PLAY_ON}`)
      afplayProc = spawn(
        'ssh',
        [PLAY_ON, `for i in 1 2 3; do afplay ${REMOTE_WAV_PATH} || break; done`],
        { stdio: 'inherit' },
      )
    }

    const decodedLocator = page.getByTestId('decoded-message')
    const errorLocator = page.locator('.alert-error')

    log(`Waiting up to ${DECODE_TIMEOUT_MS / 1000}s for decode...`)
    const winner = await Promise.race([
      decodedLocator.waitFor({ state: 'visible', timeout: DECODE_TIMEOUT_MS }).then(() => 'decoded'),
      errorLocator.waitFor({ state: 'visible', timeout: DECODE_TIMEOUT_MS }).then(() => 'error'),
    ]).catch((err) => `timeout: ${err.message}`)

    if (winner === 'decoded') {
      const text = await decodedLocator.textContent()
      const status = await page.getByTestId('mic-status-text').textContent().catch(() => null)
      log(`✅ DECODED: "${text}"`)
      log(`   Status at decode: ${status}`)
      if ((text || '').trim() === EXPECTED_MESSAGE) {
        log(`✅ PASS — matches expected "${EXPECTED_MESSAGE}"`)
        process.exitCode = 0
      } else {
        log(`❌ FAIL — got "${text}", expected "${EXPECTED_MESSAGE}"`)
        process.exitCode = 2
      }
    } else if (winner === 'error') {
      const text = await errorLocator.textContent()
      log(`❌ Decode error: ${text}`)
      process.exitCode = 1
    } else {
      log(`❌ ${winner}`)
      const status = await page.getByTestId('mic-status-text').textContent().catch(() => '<no status>')
      const detail = await page.getByTestId('mic-status-detail').textContent().catch(() => '<no detail>')
      // Fallback: maybe the decoded-message rendered but Playwright's waitFor missed it
      // (this is what the previous run showed — JS console reported full decode success).
      const decodedNow = await page.getByTestId('decoded-message').textContent({ timeout: 2_000 }).catch(() => null)
      log(`   Last UI status: ${status}`)
      log(`   Last UI detail: ${detail}`)
      log(`   Post-timeout decoded-message text: ${JSON.stringify(decodedNow)}`)
      if (decodedNow && decodedNow.trim() === EXPECTED_MESSAGE) {
        log(`✅ PASS (post-timeout) — decoded-message has expected text "${EXPECTED_MESSAGE}"`)
        log(`   This means the codec works end-to-end; only Playwright's waitFor missed the render.`)
        process.exitCode = 0
      } else {
        process.exitCode = 1
      }
    }
  } finally {
    if (afplayProc && !afplayProc.killed) {
      log(`Stopping playback`)
      afplayProc.kill('SIGTERM')
    }
    if (PLAY_ON !== 'local') {
      try {
        execFileSync('ssh', [PLAY_ON, 'pkill -9 afplay 2>/dev/null; true'], { stdio: 'ignore' })
      } catch { /* host might be offline; afplay loop exits on session close anyway */ }
    }
    log(`Browser console lines captured: ${consoleLogs.length}`)
    log(`Last 60 console lines:`)
    consoleLogs.slice(-60).forEach((l) => console.log(`  ${l}`))
    await browser.close()
  }
}

main().catch((err) => {
  console.error(`[physical-test] fatal: ${err?.stack || err}`)
  process.exitCode = 1
})

#!/usr/bin/env node
// Drives the masked DSSS codec through a real speaker → air → mic loop.
//
// Mirrors physical-mic-test.mjs but uses the masked codec end-to-end:
//   1. Encode bella-ciao.wav with the masked codec (3-way selector → 'masked')
//   2. Save encoded WAV
//   3. Start mic listener (decode codec also 'masked')
//   4. Play encoded WAV through local speakers (or SSH to m4pro for two-device)
//   5. Wait for mic decode → reveal the hidden message
//
// Run modes:
//   node scripts/masked-physical-test.mjs              # local speakers + mic
//   PLAY_ON=m4pro node scripts/masked-physical-test.mjs # m4pro plays, this mic decodes
//
// Assumes the Next.js dev server is at http://localhost:3001.

import { chromium, devices } from '@playwright/test'
import { spawn, execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs/promises'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_WAV = path.resolve(__dirname, '../e2e/fixtures/.masked-generated.wav')
const MUSIC_WAV = path.resolve(process.env.HOME || '', 'Downloads/bella-ciao.wav')
const PASSPHRASE = 'live-test-2026'
const EXPECTED_MESSAGE = 'masked physical'
const BASE_URL = 'http://localhost:3001'
const DECODE_TIMEOUT_MS = 240_000
const PLAY_ON = process.env.PLAY_ON || 'local'
const REMOTE_WAV_PATH = '/tmp/carnation-masked-two-device.wav'

const log = (msg) => console.log(`[masked-test] ${msg}`)

async function main() {
  log(`Fixture: ${FIXTURE_WAV}`)
  log(`Music source: ${MUSIC_WAV}`)
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
    await page.locator('header h1', { hasText: 'Carnation Radio' }).waitFor({ timeout: 60_000 })

    log(`Encode tab → bella-ciao + masked codec`)
    await page.getByTestId('tab-encode').click()
    await page.getByTestId('audio-upload-encode').setInputFiles(MUSIC_WAV)
    await page.getByPlaceholder('Type your hidden message...').fill(EXPECTED_MESSAGE)
    await page.getByPlaceholder('Enter passphrase...').fill(PASSPHRASE)
    await page.getByTestId('codec-masked').click()
    await page.getByTestId('btn-encode').click()

    const downloadLink = page.getByTestId('download-link')
    log(`Waiting for encode (this takes ~30-60s)…`)
    await downloadLink.waitFor({ timeout: 240_000 })
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 90_000 }),
      downloadLink.click(),
    ])
    await fs.mkdir(path.dirname(FIXTURE_WAV), { recursive: true })
    await download.saveAs(FIXTURE_WAV)
    const stat = await fs.stat(FIXTURE_WAV)
    log(`Encoded ${stat.size} bytes (~${(stat.size / 88200).toFixed(1)}s mono 44.1k)`)

    log(`Decode tab → mic + masked codec`)
    await page.getByTestId('tab-decode').click()
    await page.getByTestId('decode-method-mic').click()
    await page.getByTestId('dec-codec-masked').click()
    await page.getByPlaceholder('Enter passphrase...').fill(PASSPHRASE)

    log(`Start microphone listening`)
    await page.getByTestId('btn-start-microphone').click()
    await page.getByTestId('mic-listening-panel').waitFor({ timeout: 10_000 })

    // Give the worklet a moment before playback so the chirp's start is captured.
    await page.waitForTimeout(1500)

    if (PLAY_ON === 'local') {
      log(`afplay (LOCAL speakers, 2 loops)`)
      afplayProc = spawn(
        'bash',
        ['-c', `for i in 1 2; do afplay "${FIXTURE_WAV}" || break; done`],
        { stdio: 'inherit' },
      )
    } else {
      log(`SCP fixture to ${PLAY_ON}:${REMOTE_WAV_PATH}`)
      execFileSync('scp', ['-q', FIXTURE_WAV, `${PLAY_ON}:${REMOTE_WAV_PATH}`], { stdio: 'inherit' })
      log(`afplay loop on REMOTE host ${PLAY_ON}`)
      afplayProc = spawn(
        'ssh',
        [PLAY_ON, `for i in 1 2; do afplay ${REMOTE_WAV_PATH} || break; done`],
        { stdio: 'inherit' },
      )
    }

    log(`Waiting for decode (timeout ${DECODE_TIMEOUT_MS / 1000}s)…`)
    try {
      await page.getByTestId('message-revealed').waitFor({ timeout: DECODE_TIMEOUT_MS })
      const revealedText = await page.locator('[data-testid="message-revealed"] code, [data-testid="message-revealed"] pre, [data-testid="message-revealed"]').first().textContent()
      log(`✅ DECODED: "${revealedText?.trim()}"`)
      if (revealedText?.includes(EXPECTED_MESSAGE)) {
        log(`✅ PASS — matches expected "${EXPECTED_MESSAGE}"`)
        process.exitCode = 0
      } else {
        log(`⚠ Text doesn't match expected`)
        process.exitCode = 2
      }
    } catch (e) {
      log(`❌ FAIL — decode timed out`)
      // Dump status for diagnosis
      try {
        const status = await page.locator('[data-testid^="mic-"]').allInnerTexts()
        log(`Mic status: ${JSON.stringify(status)}`)
      } catch {}
      // Pull out masked-decoder lines, which are the most diagnostic
      const decodeLines = consoleLogs.filter((l) => l.includes('masked-decode'))
      log(`--- masked-decode log lines (${decodeLines.length}) ---`)
      decodeLines.slice(-30).forEach((l) => console.log(`  ${l}`))
      log(`--- last 20 other console lines ---`)
      consoleLogs.slice(-20).forEach((l) => console.log(`  ${l}`))
      process.exitCode = 1
    }
  } finally {
    if (afplayProc && !afplayProc.killed) afplayProc.kill('SIGTERM')
    if (PLAY_ON !== 'local') {
      try { execFileSync('ssh', [PLAY_ON, 'pkill -9 afplay 2>/dev/null; true'], { stdio: 'ignore' }) } catch {}
    }
    await browser.close()
  }
}

main().catch((e) => {
  console.error(`[masked-test] fatal: ${e?.stack || e}`)
  process.exitCode = 1
})

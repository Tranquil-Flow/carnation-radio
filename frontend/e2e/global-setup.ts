import { chromium, type FullConfig } from '@playwright/test'
import fs from 'fs/promises'
import path from 'path'

export const ACOUSTIC_FIXTURE_PATH = path.join(__dirname, 'fixtures/.acoustic-generated.wav')
export const ACOUSTIC_FIXTURE_MESSAGE = 'bella ciao physical'
export const ACOUSTIC_FIXTURE_PASSPHRASE = 'live-test-2026'
const MUSIC_FIXTURE = path.join(__dirname, 'fixtures/test_60s.wav')

/**
 * Generates `.acoustic-generated.wav` by driving the running dev server through
 * the encode UI with the "Acoustic proof carrier" checkbox set. The resulting
 * FSK-encoded WAV is what the mic-fake-audio project pipes through Chromium's
 * --use-file-for-fake-audio-capture to exercise the real getUserMedia path.
 */
export default async function globalSetup(config: FullConfig) {
  // Skip regeneration if the file already exists and the test runner is just iterating;
  // playwright clears its results dir, not fixtures.
  try {
    const stat = await fs.stat(ACOUSTIC_FIXTURE_PATH)
    if (stat.size > 0) return
  } catch {
    // not generated yet
  }

  const baseURL = config.projects[0]?.use?.baseURL || 'http://localhost:3001'
  const browser = await chromium.launch()
  try {
    const ctx = await browser.newContext({ acceptDownloads: true })
    const page = await ctx.newPage()
    await page.goto(baseURL, { timeout: 60_000 })
    await page.getByText('Carnation Radio').waitFor({ timeout: 60_000 })
    await page.getByTestId('tab-encode').click()
    await page.getByTestId('audio-upload-encode').setInputFiles(MUSIC_FIXTURE)
    await page.getByPlaceholder('Type your hidden message...').fill(ACOUSTIC_FIXTURE_MESSAGE)
    await page.getByPlaceholder('Enter passphrase...').fill(ACOUSTIC_FIXTURE_PASSPHRASE)
    await page.getByTestId('checkbox-acoustic-carrier').check()
    await page.getByTestId('btn-encode').click()

    const downloadLink = page.getByTestId('download-link')
    await downloadLink.waitFor({ timeout: 90_000 })
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 90_000 }),
      downloadLink.click(),
    ])
    await fs.mkdir(path.dirname(ACOUSTIC_FIXTURE_PATH), { recursive: true })
    await download.saveAs(ACOUSTIC_FIXTURE_PATH)
  } finally {
    await browser.close()
  }
}

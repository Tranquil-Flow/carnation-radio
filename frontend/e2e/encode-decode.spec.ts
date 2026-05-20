import { test, expect } from '@playwright/test'
import path from 'path'

const FIXTURE = path.join(__dirname, 'fixtures', 'test_60s.wav')
const MESSAGE = 'bloom'
const PASSPHRASE = 'test-passphrase-e2e-2024'

test.describe('Carnation Radio E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Wait for Next.js hydration — dev server may need time to compile on first load
    await expect(page.getByText('Carnation Radio')).toBeVisible({ timeout: 60_000 })
  })

  test('encode produces downloadable MP3', async ({ page }) => {
    // Capture browser errors for debugging
    const logs: string[] = []
    page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`))
    page.on('pageerror', err => logs.push(`[pageerror] ${err.message}`))

    await page.getByTestId('tab-encode').click()

    // Upload audio file
    await page.getByTestId('audio-upload-encode').setInputFiles(FIXTURE)
    await expect(page.getByText('test_60s.wav')).toBeVisible()

    // Fill message and passphrase
    await page.getByPlaceholder('Type your hidden message...').fill(MESSAGE)
    await page.getByPlaceholder('Enter passphrase...').fill(PASSPHRASE)

    // Click encode
    const encodeBtn = page.getByTestId('btn-encode')
    await expect(encodeBtn).toBeEnabled()
    await encodeBtn.click()

    // Assert progress stages appear in sequence
    await expect(page.getByText('Transcoding audio')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Encrypting message')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Embedding in audio')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Rendering encoded WAV')).toBeVisible({ timeout: 30_000 })

    // Wait for download link — race with error
    const encError = page.getByText('Encoding failed')
    const downloadLink = page.getByTestId('download-link')

    await Promise.race([
      expect(downloadLink).toBeVisible({ timeout: 60_000 }),
      encError.waitFor({ timeout: 60_000 }).then(async () => {
        const alertText = await page.locator('.alert-error').textContent()
        throw new Error(`Encoding failed: ${alertText}. Console: ${logs.join(' | ')}`)
      }),
    ])

    // Verify download works
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      downloadLink.click(),
    ])
    const downloadPath = await download.path()
    expect(downloadPath).toBeTruthy()
  })

  test('full encode-decode round trip', async ({ page }) => {
    const logs: string[] = []
    page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`))
    page.on('pageerror', err => logs.push(`[pageerror] ${err.message}`))

    await page.getByTestId('tab-encode').click()

    // Encode
    await page.getByTestId('audio-upload-encode').setInputFiles(FIXTURE)
    await page.getByPlaceholder('Type your hidden message...').fill(MESSAGE)
    await page.getByPlaceholder('Enter passphrase...').fill(PASSPHRASE)
    await page.getByTestId('btn-encode').click()

    const downloadLink = page.getByTestId('download-link')
    await expect(downloadLink).toBeVisible({ timeout: 60_000 })

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      downloadLink.click(),
    ])
    const downloadPath = await download.path()

    // Decode
    await page.getByTestId('tab-decode').click()
    await page.getByTestId('audio-upload-decode').setInputFiles(downloadPath!)
    await page.getByPlaceholder('Enter passphrase...').fill(PASSPHRASE)
    await page.getByTestId('btn-decode').click()

    await expect(page.getByText('Listening for hidden message...')).toBeVisible()

    const decodedMsg = page.getByTestId('decoded-message')
    await expect(decodedMsg).toBeVisible({ timeout: 60_000 })
    await expect(decodedMsg).toHaveText(MESSAGE)
  })

  test('encode button disabled when fields are missing', async ({ page }) => {
    await page.getByTestId('tab-encode').click()

    const encodeBtn = page.getByTestId('btn-encode')

    // Initially disabled — no file, no message, no passphrase
    await expect(encodeBtn).toBeDisabled()

    // Add file only — still disabled
    await page.getByTestId('audio-upload-encode').setInputFiles(FIXTURE)
    await expect(encodeBtn).toBeDisabled()

    // Add message — still disabled (no passphrase)
    await page.getByPlaceholder('Type your hidden message...').fill(MESSAGE)
    await expect(encodeBtn).toBeDisabled()

    // Add passphrase — now enabled
    await page.getByPlaceholder('Enter passphrase...').fill(PASSPHRASE)
    await expect(encodeBtn).toBeEnabled()
  })
})

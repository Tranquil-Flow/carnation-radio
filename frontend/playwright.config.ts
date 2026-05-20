import { defineConfig, devices } from '@playwright/test'
import path from 'path'

const ACOUSTIC_FIXTURE = path.join(__dirname, 'e2e/fixtures/.acoustic-generated.wav')

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 2,
  reporter: 'html',
  globalSetup: require.resolve('./e2e/global-setup'),
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
    video: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /microphone-fake-audio\.spec\.ts/,
    },
    {
      name: 'mic-fake-audio',
      testMatch: /microphone-fake-audio\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            `--use-file-for-fake-audio-capture=${ACOUSTIC_FIXTURE}`,
            '--autoplay-policy=no-user-gesture-required',
          ],
        },
      },
    },
  ],
  webServer: {
    command: 'npm run dev -- --port 3001',
    port: 3001,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})

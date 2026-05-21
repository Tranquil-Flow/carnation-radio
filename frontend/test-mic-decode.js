// Strict microphone-path decode test: the app may only receive a MediaStream from getUserMedia.
// The test harness simulates a microphone by feeding the encoded WAV into a MediaStreamDestination.
// This proves the app uses the microphone capture path, not upload decode or decodeAudioData fallback.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3101;
const M = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.mp3':'audio/mpeg','.wav':'audio/wav','.json':'application/json','.ico':'image/x-icon','.png':'image/png','.svg':'image/svg+xml'};

const FIXTURE = path.join(__dirname, 'e2e', 'fixtures', 'test_60s.wav');
const MESSAGE = 'bella ciao';
const PASSPHRASE = 'live-test-2026';

const server = http.createServer((req, res) => {
  const pathname = req.url === '/' ? 'index.html' : req.url.split('?')[0];
  const fp = path.join(__dirname, 'out', pathname);
  const ext = path.extname(fp);
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found: ' + path.basename(fp)); return; }
    res.writeHead(200, {'Content-Type': M[ext]||'application/octet-stream'});
    res.end(data);
  });
});

async function fillVisiblePassphrase(page) {
  const inputs = await page.getByPlaceholder('Enter passphrase...').all();
  for (const input of inputs) {
    if (await input.isVisible().catch(() => false)) {
      await input.fill(PASSPHRASE);
      return;
    }
  }
  throw new Error('No visible passphrase input found');
}

async function encodeMessage(page) {
  console.log('[test] Encoding fixture...');
  await page.getByTestId('tab-encode').click();
  await page.locator('input[type="file"]').first().setInputFiles(FIXTURE);
  await page.getByPlaceholder('Type your hidden message...').fill(MESSAGE);
  await page.getByPlaceholder('Enter passphrase...').fill(PASSPHRASE);
  await page.getByTestId('checkbox-acoustic-carrier').check();
  await page.getByTestId('btn-encode').click();

  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(1000);
    if (await page.getByTestId('download-link').isVisible().catch(() => false)) break;
    if (await page.locator('.alert-error').isVisible().catch(() => false)) {
      throw new Error('Encoding failed: ' + await page.locator('.alert-error').textContent());
    }
    if (i === 119) throw new Error('Timed out waiting for encoded WAV');
  }

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 10_000 }),
    page.getByTestId('download-link').click(),
  ]);
  const downloadPath = await download.path();
  console.log(`[test] Encoded WAV downloaded: ${downloadPath}`);
  return downloadPath;
}

server.listen(PORT, async () => {
  console.log(`[server] Static server on http://localhost:${PORT}`);
  let browser;
  try {
    const { chromium } = require('playwright');
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--autoplay-policy=no-user-gesture-required',
        '--use-fake-ui-for-media-stream',
      ],
    });
    let context = await browser.newContext({ permissions: ['microphone'] });
    let page = await context.newPage();
    const logs = [];
    page.on('console', msg => {
      const line = `[browser:${msg.type()}] ${msg.text()}`;
      logs.push(line);
      if (msg.type() === 'error') console.log(line);
    });
    page.on('pageerror', err => {
      const line = `[pageerror] ${err.message}`;
      logs.push(line);
      console.log(line);
    });

    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle', timeout: 30_000 });
    const encodedPath = await encodeMessage(page);
    const encodedBase64 = fs.readFileSync(encodedPath).toString('base64');

    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle', timeout: 30_000 });

    // Install fake microphone before the app asks for it. The app receives only a MediaStream.
    await page.evaluate((base64) => {
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      let requested = false;
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: {
          async getUserMedia(constraints) {
            if (!constraints || !constraints.audio) throw new Error('Expected audio getUserMedia request');
            if (requested) throw new Error('Microphone stream requested more than once');
            requested = true;
            const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
            const ctx = new AudioContextCtor({ sampleRate: 44100 });
            const buffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            const gain = ctx.createGain();
            gain.gain.value = 1.0;
            const dest = ctx.createMediaStreamDestination();
            source.connect(gain).connect(dest);
            window.__carnationMicTest = { ctx, source, started: false };
            await ctx.resume();
            return dest.stream;
          },
        },
      });
    }, encodedBase64);

    console.log('[test] Starting strict microphone decode path...');
    await page.getByTestId('tab-decode').click();
    await page.getByText('Listen from Microphone').click();
    await fillVisiblePassphrase(page);
    await page.getByTestId('btn-start-microphone').click();

    await page.getByText(/Listening through microphone|Decoding microphone/).waitFor({ state: 'visible', timeout: 30_000 });
    await page.evaluate(async () => {
      const micTest = window.__carnationMicTest;
      if (!micTest || micTest.started) return;
      await micTest.ctx.resume();
      micTest.source.start(0);
      micTest.started = true;
    });
    console.log('[test] Fake microphone MediaStream is streaming encoded WAV');

    let decoded = false;
    for (let i = 0; i < 120; i++) {
      await page.waitForTimeout(1000);
      const msgEl = page.getByTestId('decoded-message');
      if (await msgEl.isVisible().catch(() => false)) {
        const text = await msgEl.textContent();
        console.log(`[test] ★ MICROPHONE DECODED MESSAGE: "${text}"`);
        if (text !== MESSAGE) throw new Error(`Microphone decode mismatch: expected "${MESSAGE}", got "${text}"`);
        decoded = true;
        break;
      }
      if (await page.locator('.alert-error').isVisible().catch(() => false)) {
        throw new Error('Microphone decode error: ' + await page.locator('.alert-error').textContent());
      }
      if (i % 5 === 0) {
        const status = await page.getByText(/Listening through microphone|Decoding microphone|Microphone/).first().textContent().catch(() => null);
        console.log(`[test] Waiting for microphone decode... ${i}s (${status})`);
      }
    }

    if (!decoded) {
      console.log('[test] Browser logs:');
      logs.slice(-40).forEach(l => console.log('  ' + l));
      throw new Error('Message was not decoded from microphone MediaStream within timeout');
    }

    console.log(`[test] ✓✓✓ MICROPHONE DECODE TEST PASSED! Message matches: "${MESSAGE}"`);
    await browser.close();
    server.close();
    process.exit(0);
  } catch (e) {
    console.error('[test] Fatal error:', e.message);
    console.error(e.stack);
    if (browser) await browser.close().catch(() => {});
    server.close();
    process.exit(1);
  }
});

// Self-contained live decode test: server + playwright in one process
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3099;
const M = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.mp3':'audio/mpeg','.wav':'audio/wav','.json':'application/json','.ico':'image/x-icon','.png':'image/png','.svg':'image/svg+xml'};

// Use the 60s fixture for more capacity; song_30s is too short for encrypted payloads
const FIXTURE = path.join(__dirname, 'e2e', 'fixtures', 'test_60s.wav');
const MESSAGE = 'bella ciao';
const PASSPHRASE = 'live-test-2026';

// Start static server serving the built output
const server = http.createServer((req, res) => {
  let fp = path.join(__dirname, 'out', req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  const ext = path.extname(fp);
  fs.readFile(fp, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found: ' + path.basename(fp)); return; }
    res.writeHead(200, {'Content-Type': M[ext]||'application/octet-stream'});
    res.end(data);
  });
});

server.listen(PORT, async () => {
  console.log(`[server] Static server on http://localhost:${PORT}`);
  
  let browser;
  try {
    const { chromium } = require('playwright');
    browser = await chromium.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required']
    });
    console.log('[browser] Chromium launched');

    const context = await browser.newContext();
    const page = await context.newPage();

    const logs = [];
    page.on('console', msg => {
      const line = `[browser:${msg.type()}] ${msg.text()}`;
      logs.push(line);
      if (msg.type() === 'error') console.log(line);
    });
    page.on('pageerror', err => {
      logs.push(`[pageerror] ${err.message}`);
      console.log(`[pageerror] ${err.message}`);
    });

    // ── Navigate to app ──
    console.log('[test] Navigating to app...');
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle', timeout: 30_000 });
    
    const heading = await page.textContent('h1').catch(() => null);
    console.log(`[test] Page heading: "${heading}"`);

    // ── Phase 1: Encode ──
    console.log('[test] Phase 1: Encoding message into audio...');
    
    // We're already on Encode tab (default), verify
    const encodeTabActive = await page.getByTestId('tab-encode').getAttribute('class');
    if (!encodeTabActive?.includes('tab-active')) {
      await page.getByTestId('tab-encode').click();
    }

    // Upload audio file
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(FIXTURE);
    await page.waitForTimeout(1000);
    
    // Verify file was accepted
    const fileLabel = await page.getByText('test_60s.wav').textContent().catch(() => null);
    console.log(`[test] File uploaded: "${fileLabel}"`);

    // Fill message
    await page.getByPlaceholder('Type your hidden message...').fill(MESSAGE);
    
    // Fill passphrase
    await page.getByPlaceholder('Enter passphrase...').fill(PASSPHRASE);

    // Click encode button
    const encodeBtn = page.getByTestId('btn-encode');
    await encodeBtn.click();
    console.log('[test] Encode clicked, waiting for pipeline...');

    // Wait for download link (up to 2 minutes for WASM compilation)
    const downloadLink = page.getByTestId('download-link');
    
    // Poll for either download link or error
    let encoded = false;
    for (let i = 0; i < 120; i++) {
      await page.waitForTimeout(1000);
      
      const dl = await page.getByTestId('download-link').isVisible().catch(() => false);
      const dl2 = await page.locator('a:has-text("Download")').isVisible().catch(() => false);
      const err = await page.locator('.alert-error').isVisible().catch(() => false);
      
      if (dl || dl2) {
        console.log('[test] Download link appeared!');
        encoded = true;
        break;
      }
      if (err) {
        const errText = await page.locator('.alert-error').textContent();
        throw new Error('Encoding failed: ' + errText);
      }
      
      if (i % 10 === 0) console.log(`[test] Waiting for encode... ${i}s`);
    }
    
    if (!encoded) throw new Error('Timed out waiting for encode to complete');

    // Download the encoded WAV
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 10_000 }),
      page.getByTestId('download-link').click().catch(() => page.locator('a:has-text("Download")').click()),
    ]);
    const downloadPath = await download.path();
    const fileSize = fs.statSync(downloadPath).size;
    console.log(`[test] Downloaded encoded WAV: ${downloadPath} (${fileSize} bytes)`);

    // Sanity check: the same WAV must decode through the existing upload path first.
    console.log('[test] Sanity check: upload decode of same WAV...');
    await page.getByTestId('tab-decode').click();
    await page.getByText('Upload File').click();
    await page.getByTestId('audio-upload-decode').setInputFiles(downloadPath);
    const uploadPassInputs = await page.getByPlaceholder('Enter passphrase...').all();
    for (const input of uploadPassInputs) {
      if (await input.isVisible().catch(() => false)) {
        await input.fill(PASSPHRASE);
        break;
      }
    }
    await page.getByTestId('btn-decode').click();
    const uploadDecoded = page.getByTestId('decoded-message');
    await uploadDecoded.waitFor({ state: 'visible', timeout: 90_000 });
    const uploadText = await uploadDecoded.textContent();
    console.log(`[test] Upload decoded message: "${uploadText}"`);
    if (uploadText !== MESSAGE) throw new Error(`Upload decode mismatch: ${uploadText}`);

    // Go back to a clean app instance for the live decode path.
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle', timeout: 30_000 });

    // ── Phase 2: Live Decode ──
    console.log('[test] Phase 2: Live AudioWorklet decode...');
    
    // Switch to Decode tab
    await page.getByTestId('tab-decode').click();

    // Click "Listen Live" sub-tab
    await page.getByText('Listen Live').click();
    console.log('[test] Switched to Listen Live mode');

    // Enter passphrase
    const passInputs = await page.getByPlaceholder('Enter passphrase...').all();
    for (const input of passInputs) {
      const visible = await input.isVisible().catch(() => false);
      if (visible) {
        await input.fill(PASSPHRASE);
        console.log('[test] Passphrase filled');
        break;
      }
    }

    // Click "Start Listening"
    const startBtn = page.getByText('Start Listening');
    await startBtn.click();
    console.log('[test] Start Listening clicked');

    // Wait for the "Waiting for audio" state
    await page.waitForTimeout(1000);

    // Upload the encoded WAV to the live decode dropzone
    let liveInput;
    try {
      liveInput = page.getByTestId('audio-upload-decode-live');
      await liveInput.elementHandle({ timeout: 2000 });
    } catch {
      liveInput = page.locator('input[type="file"]').last();
    }
    await liveInput.setInputFiles(downloadPath);
    console.log('[test] Uploaded encoded WAV to live decode');
    
    // Find the audio element, then wait until the app says the decoder graph is ready.
    const audioEl = page.locator('audio');
    await audioEl.waitFor({ state: 'attached', timeout: 30_000 });
    console.log('[test] Audio element attached');

    await page.getByText('Press play to start decoding').waitFor({ state: 'visible', timeout: 30_000 });
    console.log('[test] Live decoder ready; starting playback...');

    await audioEl.evaluate(async (el) => {
      el.volume = 1;
      el.currentTime = 0;
      await el.play();
      // Headless Chromium does not always route programmatic play through React's
      // synthetic onPlay event. Dispatching mirrors the user pressing native play.
      el.dispatchEvent(new Event('play', { bubbles: true }));
    });
    console.log('[test] Audio play() called + play event dispatched');

    const progressExists = await page.locator('progress').isVisible().catch(() => false);
    console.log(`[test] Progress bar visible after play: ${progressExists}`);

    const statusText = await page.getByText(/Decoding\.\.\.|Press play/).textContent().catch(() => null);
    console.log(`[test] Status text: "${statusText}"`);

    // Wait for decoded message (up to 2 minutes for full playback + decode)
    let decoded = false;
    for (let i = 0; i < 120; i++) {
      await page.waitForTimeout(1000);
      
      // Check for decoded message
      const msgEl = page.getByTestId('decoded-message');
      const msgVisible = await msgEl.isVisible().catch(() => false);
      
      if (msgVisible) {
        const text = await msgEl.textContent();
        console.log(`[test] ★ DECODED MESSAGE: "${text}"`);
        decoded = true;
        
        if (text === MESSAGE) {
          console.log(`[test] ✓✓✓ LIVE DECODE TEST PASSED! Message matches: "${text}"`);
        } else {
          console.log(`[test] ✗ MESSAGE MISMATCH! Expected "${MESSAGE}", got "${text}"`);
        }
        break;
      }
      
      // Check for error
      const errVisible = await page.locator('.alert-error').isVisible().catch(() => false);
      if (errVisible) {
        const errText = await page.locator('.alert-error').textContent();
        console.log(`[test] Error appeared: ${errText}`);
        break;
      }
      
      // Log progress
      const progressText = await page.getByText(/Decoding\.\.\.|Press play/).textContent().catch(() => null);
      if (i % 5 === 0) console.log(`[test] Waiting for decode... ${i}s (status: "${progressText}")`);
    }

    if (!decoded) {
      console.log('[test] ✗ FAILED: Message was not decoded within timeout');
      console.log('[test] Browser logs:');
      logs.slice(-30).forEach(l => console.log('  ' + l));
    }

    await browser.close();
    server.close();
    process.exit(decoded ? 0 : 1);
    
  } catch(e) {
    console.error('[test] Fatal error:', e.message);
    console.error(e.stack);
    if (browser) await browser.close().catch(() => {});
    server.close();
    process.exit(1);
  }
});

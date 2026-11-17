// Smoke test the shipped out/game copy over plain HTTP.
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome`,
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto('http://127.0.0.1:8904/?shot=play&seed=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 60000 });
console.log('out/game loads + shot ready, errors:', errs.length === 0 ? 'none' : errs.join(' | '));
await browser.close();

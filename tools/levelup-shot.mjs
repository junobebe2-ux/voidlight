// One-off visual check: the level-up blessing screen, and the shipped out/game copy.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const server = spawn('node', ['serve.ts', '--port', '8902'], { cwd: new URL('..', import.meta.url).pathname, stdio: 'pipe' });
await new Promise((resolve) => { server.stdout.on('data', () => resolve()); setTimeout(resolve, 5000); });
const browser = await chromium.launch({
  headless: true,
  executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome`,
  args: ['--no-sandbox', '--disable-gpu'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://127.0.0.1:8902', { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await page.keyboard.press('Space');
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const w = window.__voidlight;
    const s = w.world.state;
    s.xp = 5 + s.level * 4 - 1;
    const free = s.shards.find((x) => !x.active);
    free.active = true;
    free.x = s.player.x;
    free.y = s.player.y;
    free.vx = 0;
    free.vy = 0;
    free.life = 14;
  });
  await page.waitForTimeout(1000);
  const screen = await page.evaluate(() => window.__voidlight.screen);
  console.log('screen:', screen);
  await page.screenshot({ path: '/tmp/levelup.png' });
  console.log('page errors:', errors.length === 0 ? 'none' : errors.join(' | '));
  await page.close();
} finally {
  await browser.close();
  server.kill();
}

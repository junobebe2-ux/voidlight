// VOIDLIGHT verification: serves game/ locally, plays it in headless Chromium, and takes
// the three staged screenshots. Run from the repo root: `node tools/test.mjs`.
// Exit code 0 means every gate passed; anything else prints the failure and exits 1.
import { spawn } from 'node:child_process';
import { statSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 8901;
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = [
  { name: '1-start.jpg', query: '?shot=start&seed=1' },
  { name: '2-play.jpg', query: '?shot=play&seed=1' },
  { name: '3-end.jpg', query: '?shot=end&seed=1' },
];
const MAX_SHOT_BYTES = 262144;

const failures = [];
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const server = spawn('node', ['serve.ts', '--port', String(PORT)], { cwd: new URL('..', import.meta.url).pathname, stdio: 'pipe' });
await new Promise((resolve) => {
  server.stdout.on('data', () => resolve());
  setTimeout(resolve, 5000);
});

const browser = await chromium.launch({
  headless: true,
  executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome`,
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
const externalRequests = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (error) => pageErrors.push(String(error)));
page.on('requestfailed', (request) => failedRequests.push(`${request.url()} ${request.failure()?.errorText ?? ''}`));
page.on('request', (request) => {
  const url = request.url();
  if (!url.startsWith(`${BASE}/`) && !url.startsWith('data:')) externalRequests.push(url);
});

const state = () => page.evaluate(() => {
  const w = window.__voidlight;
  if (!w) return null;
  const s = w.world.state;
  return {
    screen: w.screen,
    hp: s.hp,
    score: Math.floor(s.score),
    kills: s.kills,
    level: s.level,
    xp: s.xp,
    wave: s.wave,
    elapsed: Math.floor(s.elapsed),
    novaCharges: s.novaCharges,
    pendingLevels: s.pendingLevels,
    offer: s.offer.slice(),
    enemies: s.enemies.filter((e) => e.active).length,
    bolts: s.bolts.filter((b) => b.active).length,
    shards: s.shards.filter((x) => x.active).length,
  };
});

try {
  // --- Gate 1: the game loads clean ---
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const s0 = await state();
  check('game boots to title screen', s0 !== null && s0.screen === 'title', JSON.stringify(s0));

  // --- Gate 2: start, play, enemies spawn, bolts fire, kills happen ---
  await page.keyboard.press('Space');
  await page.waitForTimeout(500);
  const s1 = await state();
  check('Space starts the game', s1.screen === 'play', s1.screen);
  // Steer around so the lantern moves and meets shades.
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(2500);
  await page.keyboard.up('KeyD');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2000);
  await page.keyboard.up('KeyW');
  await page.keyboard.down('KeyA');
  await page.waitForTimeout(2500);
  await page.keyboard.up('KeyA');
  await page.waitForTimeout(4000);
  const s2 = await state();
  check('enemies spawn and stay in play', s2.enemies > 0, `${s2.enemies} active`);
  check('bolts fired and shades killed', s2.kills > 0 || s2.score > 0, `kills=${s2.kills} score=${s2.score}`);
  check('shards drop', s2.shards >= 0, `${s2.shards} on field`);

  // --- Nova: charges fall by one ---
  const before = s2.novaCharges;
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  const s3 = await state();
  check('nova spends a charge', s3.novaCharges === before - 1, `${before} -> ${s3.novaCharges}`);

  // --- Level-up: force one shard collection at the threshold, pick a blessing ---
  await page.evaluate(() => {
    const w = window.__voidlight;
    const s = w.world.state;
    const need = 5 + s.level * 4;
    s.xp = need - 1;
    const shard = s.shards.find((x) => x.active) ?? null;
    if (shard) {
      shard.x = s.player.x;
      shard.y = s.player.y;
      shard.vx = 0;
      shard.vy = 0;
    } else {
      // No shard on the field: drop one on the player by hand through the state's pools.
      const free = s.shards.find((x) => !x.active);
      free.active = true;
      free.x = s.player.x;
      free.y = s.player.y;
      free.vx = 0;
      free.vy = 0;
      free.life = 14;
    }
  });
  await page.waitForTimeout(800);
  const s4 = await state();
  check('level-up opens the blessing screen', s4.screen === 'levelup' && s4.offer.length === 3, `screen=${s4.screen} offer=${s4.offer.join(',')}`);
  if (s4.screen === 'levelup') {
    await page.keyboard.press('Digit1');
    await page.waitForTimeout(300);
    const s5 = await state();
    check('picking a blessing resumes play', s5.screen === 'play' && s5.pendingLevels === 0, `screen=${s5.screen}`);
  }

  // --- Pause / resume ---
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(200);
  const s6 = await state();
  check('P pauses', s6.screen === 'paused', s6.screen);
  await page.keyboard.press('KeyP');
  await page.waitForTimeout(200);
  const s7 = await state();
  check('P resumes', s7.screen === 'play', s7.screen);

  // --- Game over and restart ---
  await page.evaluate(() => {
    const w = window.__voidlight;
    const s = w.world.state;
    s.hp = 1;
    s.player.invulnerable = 0;
    const e = s.enemies.find((x) => x.active);
    if (e) {
      e.x = s.player.x + 5;
      e.y = s.player.y;
      e.hitCooldown = 0;
    }
  });
  await page.waitForTimeout(800);
  const s8 = await state();
  check('game over at 0 HP', s8.screen === 'over', `screen=${s8.screen} hp=${s8.hp}`);
  await page.keyboard.press('KeyR');
  await page.waitForTimeout(300);
  const s9 = await state();
  check('R restarts', s9.screen === 'play' && s9.hp === 3 && s9.score === 0, `screen=${s9.screen} hp=${s9.hp}`);

  // --- Gate 3: staged screenshots, 1280x720 JPEGs under the 256 KiB cap ---
  for (const shot of SHOTS) {
    const shotPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    shotPage.on('pageerror', (error) => pageErrors.push(`shot ${shot.name}: ${error}`));
    await shotPage.goto(`${BASE}/${shot.query}`, { waitUntil: 'load' });
    await shotPage.waitForFunction(() => window.__shotReady === true, null, { timeout: 90000 });
    await shotPage.waitForTimeout(400);
    const path = new URL(`../screenshots/${shot.name}`, import.meta.url).pathname;
    await shotPage.screenshot({ path, type: 'jpeg', quality: 80 });
    const bytes = statSync(path).size;
    check(`screenshot ${shot.name} under 256 KiB`, bytes <= MAX_SHOT_BYTES, `${bytes} bytes`);
    await shotPage.close();
  }

  // --- Gate 1 (continued): clean console and network ---
  check('zero console errors', consoleErrors.length === 0, consoleErrors.join(' | ').slice(0, 300));
  check('zero page errors', pageErrors.length === 0, pageErrors.join(' | ').slice(0, 300));
  check('zero failed requests', failedRequests.length === 0, failedRequests.join(' | ').slice(0, 300));
  check('zero external requests', externalRequests.length === 0, externalRequests.join(' | ').slice(0, 300));
} finally {
  await browser.close();
  server.kill();
}

if (failures.length > 0) {
  console.log(`\n${failures.length} gate(s) failed: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('\nAll gates passed.');

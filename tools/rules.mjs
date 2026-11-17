// Headless rules check for VOIDLIGHT: imports world.js directly in Node and steps the
// simulation with an autopilot, asserting the rules hold. No DOM, no browser.
import { createRandom } from '../game/src/random.js';
import { createWorld, EVENT_OVER, EVENT_LEVEL } from '../game/src/world.js';
import { FIELD, STEP, xpForLevel } from '../game/src/config.js';

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

function autopilot(state, flee) {
  const p = state.player;
  let best = null;
  let bestD = Infinity;
  for (const e of state.enemies) {
    if (!e.active) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < bestD) { bestD = d; best = e; }
  }
  let tx = FIELD.width / 2;
  let ty = FIELD.height / 2;
  if (best && bestD < flee) {
    tx = p.x + (p.x - best.x);
    ty = p.y + (p.y - best.y);
  } else {
    let shard = null;
    let sd = Infinity;
    for (const s of state.shards) {
      if (!s.active) continue;
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d < sd) { sd = d; shard = s; }
    }
    if (shard && sd < 420) { tx = shard.x; ty = shard.y; }
  }
  const dx = tx - p.x;
  const dy = ty - p.y;
  const len = Math.hypot(dx, dy);
  return len < 8 ? { x: 0, y: 0 } : { x: dx / len, y: dy / len };
}

// --- Scenario 1: hp=1, enemy teleported onto the player ---
{
  const world = createWorld(createRandom(7));
  world.reset();
  const s = world.state;
  s.hp = 1;
  s.player.invulnerable = 0;
  // Spawn an enemy right on the player.
  const e = s.enemies.find((x) => !x.active);
  e.active = true; e.kind = 'drifter'; e.x = s.player.x + 5; e.y = s.player.y;
  e.hp = 2; e.maxHp = 2; e.speed = 88; e.radius = 17; e.phase = 0; e.t = 0; e.hitFlash = 0; e.hitCooldown = 0; e.vx = 0; e.vy = 0;
  let over = false;
  for (let i = 0; i < 120; i += 1) {
    if (world.step(STEP, 0, 0, false) & EVENT_OVER) { over = true; break; }
  }
  check('hp=1 + contact ends the game', over, `hp=${s.hp} over=${over}`);
  check('hp never goes below 0', s.hp >= 0, `hp=${s.hp}`);
}

// --- Scenario 2: 60 s of autopilot play ---
{
  const world = createWorld(createRandom(1));
  world.reset();
  world.state.autoLevel = true;
  let over = false;
  let levelEvents = 0;
  let novas = 0;
  for (let i = 0; i < 60 / STEP; i += 1) {
    const move = autopilot(world.state, 150);
    if (i % 600 === 0 && world.state.novaCharges > 0) {
      if (world.nova()) novas += 1;
    }
    const events = world.step(STEP, move.x, move.y, false);
    if (events & EVENT_LEVEL) levelEvents += 1;
    if (events & EVENT_OVER) { over = true; break; }
  }
  const s = world.state;
  check('60 s autopilot: kills happen', s.kills > 0, `kills=${s.kills}`);
  check('60 s autopilot: score grows', s.score > 0, `score=${Math.floor(s.score)}`);
  check('60 s autopilot: leveled up', s.level > 1, `level=${s.level}`);
  check('60 s autopilot: waves advance', s.wave >= 3, `wave=${s.wave}`);
  check('60 s autopilot: nova fired', novas > 0, `novas=${novas}`);
  check('60 s autopilot: hp bounded 0..max', s.hp >= 0 && s.hp <= s.stats.hpMax, `hp=${s.hp}`);
  console.log(`  final: score=${Math.floor(s.score)} kills=${s.kills} level=${s.level} wave=${s.wave} hp=${s.hp} over=${over} levelEvents=${levelEvents}`);
}

// --- Scenario 3: no-flee autopilot dies in reasonable time (the end shot) ---
{
  const world = createWorld(createRandom(1));
  world.reset();
  world.state.autoLevel = true;
  let overAt = -1;
  for (let i = 0; i < 180 / STEP; i += 1) {
    const move = autopilot(world.state, 0);
    if (world.step(STEP, move.x, move.y, false) & EVENT_OVER) { overAt = i * STEP; break; }
  }
  check('no-flee autopilot dies within 180 s', overAt >= 0, overAt >= 0 ? `died at ${overAt.toFixed(1)} s` : 'survived 180 s');
}

if (failures > 0) {
  console.log(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nAll rules checks passed.');

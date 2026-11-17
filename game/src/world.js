// VOIDLIGHT's rules and state, with no drawing and no browser in it: the lantern-bearer,
// the shades that converge on them, auto-fired light bolts, the nova burst, light shards
// (XP), waves and level-up upgrades. step() advances one fixed step and returns what
// happened as bit flags; the details of each event land in state.eventLog, which the caller
// drains every frame to drive sound and visual effects. Nothing here allocates after
// createWorld returns, and all randomness comes from the injected seeded generator.
import { BOLT, ENEMY, FIELD, HP, NOVA, PLAYER, POOL, SHARD, UPGRADES, WAVE, xpForLevel } from './config.js';

export const KIND_DRIFTER = 'drifter';
export const KIND_DART = 'dart';
export const KIND_SPLITTER = 'splitter';
export const KIND_MINION = 'minion';
export const KIND_BRUTE = 'brute';

export const EVENT_HIT = 1;
export const EVENT_KILL = 2;
export const EVENT_SHARD = 4;
export const EVENT_LEVEL = 8;
export const EVENT_NOVA = 16;
export const EVENT_OVER = 32;

function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export function createWorld(random) {
  const player = { x: FIELD.width / 2, y: FIELD.height / 2, kx: 0, ky: 0, invulnerable: 0 };
  const stats = { fireRate: BOLT.fireRate, damage: BOLT.damage, moveSpeed: 335, magnet: SHARD.magnet, hpMax: HP.start, novaMax: NOVA.chargesStart };
  const enemies = [];
  for (let i = 0; i < POOL.enemies; i += 1) {
    enemies.push({ active: false, kind: KIND_DRIFTER, x: 0, y: 0, hp: 1, maxHp: 1, speed: 0, radius: 0, phase: 0, t: 0, hitFlash: 0, hitCooldown: 0, vx: 0, vy: 0 });
  }
  const bolts = [];
  for (let i = 0; i < POOL.bolts; i += 1) bolts.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, damage: 1, life: 0 });
  const shards = [];
  for (let i = 0; i < POOL.shards; i += 1) shards.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0 });
  const eventLog = [];

  const state = {
    player, stats, enemies, bolts, shards, eventLog,
    hp: HP.start, score: 0, kills: 0, level: 1, xp: 0, wave: 1,
    elapsed: 0, spawnTimer: 0.6, fireTimer: 0.3, novaCharges: NOVA.chargesStart,
    novaCooldown: 0, nextFreeCharge: NOVA.freeChargeSeconds,
    pendingLevels: 0, offer: [], autoLevel: false,
  };

  function reset() {
    player.x = FIELD.width / 2;
    player.y = FIELD.height / 2;
    player.kx = 0;
    player.ky = 0;
    player.invulnerable = 0;
    stats.fireRate = BOLT.fireRate;
    stats.damage = BOLT.damage;
    stats.moveSpeed = 335;
    stats.magnet = SHARD.magnet;
    stats.hpMax = HP.start;
    stats.novaMax = NOVA.chargesStart;
    for (const e of enemies) e.active = false;
    for (const b of bolts) b.active = false;
    for (const s of shards) s.active = false;
    eventLog.length = 0;
    state.hp = HP.start;
    state.score = 0;
    state.kills = 0;
    state.level = 1;
    state.xp = 0;
    state.wave = 1;
    state.elapsed = 0;
    state.spawnTimer = 0.6;
    state.fireTimer = 0.3;
    state.novaCharges = NOVA.chargesStart;
    state.novaCooldown = 0;
    state.nextFreeCharge = NOVA.freeChargeSeconds;
    state.pendingLevels = 0;
    state.offer = [];
  }

  function log(type, x, y, extra) {
    if (eventLog.length < 64) eventLog.push({ type, x, y, extra });
  }

  function freeEnemy() {
    for (let i = 0; i < enemies.length; i += 1) if (!enemies[i].active) return enemies[i];
    return null;
  }

  function freeBolt() {
    for (let i = 0; i < bolts.length; i += 1) if (!bolts[i].active) return bolts[i];
    return null;
  }

  function freeShard() {
    for (let i = 0; i < shards.length; i += 1) if (!shards[i].active) return shards[i];
    return null;
  }

  function spawnEnemy(kind, x, y) {
    const e = freeEnemy();
    if (e === null) return null;
    const def = ENEMY[kind];
    e.active = true;
    e.kind = kind;
    e.x = x;
    e.y = y;
    e.maxHp = def.hp;
    e.hp = def.hp;
    e.speed = def.speed + WAVE.speedPerWave * (state.wave - 1);
    e.radius = def.radius;
    e.phase = random() * Math.PI * 2;
    e.t = 0;
    e.hitFlash = 0;
    e.hitCooldown = 0;
    e.vx = 0;
    e.vy = 0;
    return e;
  }

  function pickKind() {
    const wave = state.wave;
    const roll = random();
    if (wave >= WAVE.unlock.brute && roll < 0.06) return KIND_BRUTE;
    if (wave >= WAVE.unlock.splitter && roll < 0.22) return KIND_SPLITTER;
    if (wave >= WAVE.unlock.dart && roll < 0.52) return KIND_DART;
    return KIND_DRIFTER;
  }

  function spawnAtEdge() {
    const kind = pickKind();
    const m = 48;
    const side = Math.floor(random() * 4);
    let x = 0;
    let y = 0;
    if (side === 0) { x = random() * FIELD.width; y = -m; }
    else if (side === 1) { x = FIELD.width + m; y = random() * FIELD.height; }
    else if (side === 2) { x = random() * FIELD.width; y = FIELD.height + m; }
    else { x = -m; y = random() * FIELD.height; }
    spawnEnemy(kind, x, y);
  }

  function spawnInterval() {
    return Math.max(WAVE.minInterval, WAVE.interval * WAVE.intervalScale ** (state.wave - 1));
  }

  function dropShards(x, y, count) {
    for (let i = 0; i < count; i += 1) {
      const s = freeShard();
      if (s === null) return;
      s.active = true;
      const angle = random() * Math.PI * 2;
      const speed = 60 + random() * 140;
      s.x = x;
      s.y = y;
      s.vx = Math.cos(angle) * speed;
      s.vy = Math.sin(angle) * speed;
      s.life = SHARD.lifetime;
    }
  }

  function killEnemy(e, award) {
    e.active = false;
    state.kills += 1;
    const def = ENEMY[e.kind];
    if (award) {
      state.score += def.score;
      dropShards(e.x, e.y, def.shards);
    }
    log('kill', e.x, e.y, e.kind);
    if (e.kind === KIND_SPLITTER) {
      for (let i = 0; i < 2; i += 1) {
        const m = spawnEnemy(KIND_MINION, e.x + (random() - 0.5) * 36, e.y + (random() - 0.5) * 36);
        if (m !== null) m.phase = random() * Math.PI * 2;
      }
    }
  }

  function damageEnemy(e, damage) {
    e.hp -= damage;
    e.hitFlash = 0.09;
    log('damage', e.x, e.y, damage);
    if (e.hp <= 0) killEnemy(e, true);
  }

  function nearestEnemy() {
    let best = null;
    let bestD = BOLT.range * BOLT.range;
    for (let i = 0; i < enemies.length; i += 1) {
      const e = enemies[i];
      if (!e.active) continue;
      const d = dist2(e.x, e.y, player.x, player.y);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  function fireBolt() {
    const target = nearestEnemy();
    if (target === null) return;
    const b = freeBolt();
    if (b === null) return;
    const dx = target.x - player.x;
    const dy = target.y - player.y;
    const len = Math.hypot(dx, dy) || 1;
    b.active = true;
    b.x = player.x + (dx / len) * 22;
    b.y = player.y + (dy / len) * 22;
    b.vx = (dx / len) * BOLT.speed;
    b.vy = (dy / len) * BOLT.speed;
    b.damage = stats.damage;
    b.life = 1.6;
    log('shoot', b.x, b.y, 0);
  }

  /** The nova burst: light hurts every shade inside its radius. Returns true if it fired. */
  function nova() {
    if (state.novaCharges <= 0 || state.novaCooldown > 0) return false;
    state.novaCharges -= 1;
    state.novaCooldown = NOVA.cooldown;
    log('nova', player.x, player.y, 0);
    const r2 = NOVA.radius * NOVA.radius;
    for (let i = 0; i < enemies.length; i += 1) {
      const e = enemies[i];
      if (!e.active) continue;
      if (dist2(e.x, e.y, player.x, player.y) <= r2) damageEnemy(e, NOVA.damage);
    }
    return true;
  }

  /** The three upgrades on offer; called when a level-up is pending. */
  function offerUpgrades() {
    const pool = UPGRADES.slice();
    const offer = [];
    while (offer.length < 3 && pool.length > 0) {
      const index = Math.floor(random() * pool.length);
      offer.push(pool.splice(index, 1)[0].id);
    }
    state.offer = offer;
    return offer;
  }

  function applyUpgrade(id) {
    const upgrade = UPGRADES.find((u) => u.id === id);
    if (!upgrade) return false;
    upgrade.apply(stats);
    state.pendingLevels -= 1;
    if (state.pendingLevels > 0) offerUpgrades();
    else state.offer = [];
    return true;
  }

  function gainXp(amount) {
    state.xp += amount;
    let need = xpForLevel(state.level);
    while (state.xp >= need) {
      state.xp -= need;
      state.level += 1;
      state.pendingLevels += 1;
      log('level', player.x, player.y, state.level);
      need = xpForLevel(state.level);
    }
    if (state.pendingLevels > 0 && state.autoLevel) {
      while (state.pendingLevels > 0) {
        offerUpgrades();
        applyUpgrade(state.offer[0]);
      }
    } else if (state.pendingLevels > 0 && state.offer.length === 0) {
      offerUpgrades();
    }
  }

  function moveEnemy(e, dt) {
    const dx = player.x - e.x;
    const dy = player.y - e.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dx / len;
    const ny = dy / len;
    let speed = e.speed;
    if (e.kind === KIND_DART) {
      // Darts wind up, then lunge: a 0.35 s pause, then 0.55 s at double speed.
      const cycle = e.t % 2.4;
      if (cycle < 0.35) speed = 0;
      else if (cycle < 0.9) speed = e.speed * 2.1;
    }
    let mx = nx;
    let my = ny;
    if (e.kind === KIND_DRIFTER || e.kind === KIND_MINION) {
      // A slow sideways wobble so drifters never march in a dead-straight line.
      const wob = Math.sin(e.t * 2.2 + e.phase) * 0.45;
      mx = nx + -ny * wob;
      my = ny + nx * wob;
      const ml = Math.hypot(mx, my) || 1;
      mx /= ml;
      my /= ml;
    }
    e.x += (mx * speed + e.vx) * dt;
    e.y += (my * speed + e.vy) * dt;
    // Knockback velocity decays fast.
    e.vx *= Math.max(0, 1 - dt * 6);
    e.vy *= Math.max(0, 1 - dt * 6);
  }

  /**
   * One fixed step. `mx, my` is the movement direction (-1..1 each, normalised by the
   * caller). With `harmless` set (the title screen's backdrop) shades drift but nothing
   * touches the player, nothing fires and nothing scores.
   */
  function step(dt, mx, my, harmless) {
    let events = 0;
    state.elapsed += dt;
    state.wave = 1 + Math.floor(state.elapsed / WAVE.seconds);
    if (!harmless) state.score += dt;

    // Player movement: steering plus decaying knockback, clamped to the field.
    const len = Math.hypot(mx, my);
    const nx = len > 0 ? mx / len : 0;
    const ny = len > 0 ? my / len : 0;
    player.x += (nx * stats.moveSpeed + player.kx) * dt;
    player.y += (ny * stats.moveSpeed + player.ky) * dt;
    player.kx *= Math.max(0, 1 - dt * 7);
    player.ky *= Math.max(0, 1 - dt * 7);
    player.x = Math.min(FIELD.width - 20, Math.max(20, player.x));
    player.y = Math.min(FIELD.height - 20, Math.max(20, player.y));
    if (player.invulnerable > 0) player.invulnerable = Math.max(0, player.invulnerable - dt);
    if (state.novaCooldown > 0) state.novaCooldown = Math.max(0, state.novaCooldown - dt);
    if (!harmless && state.elapsed >= state.nextFreeCharge) {
      state.nextFreeCharge += NOVA.freeChargeSeconds;
      if (state.novaCharges < stats.novaMax) state.novaCharges += 1;
    }

    // Spawning.
    state.spawnTimer -= dt;
    if (state.spawnTimer <= 0) {
      spawnAtEdge();
      state.spawnTimer += spawnInterval();
    }

    // Auto-fire.
    if (!harmless) {
      state.fireTimer -= dt;
      if (state.fireTimer <= 0) {
        fireBolt();
        state.fireTimer += 1 / stats.fireRate;
      }
    }

    // Enemies move, flash decays, and contact is checked.
    for (let i = 0; i < enemies.length; i += 1) {
      const e = enemies[i];
      if (!e.active) continue;
      e.t += dt;
      if (e.hitFlash > 0) e.hitFlash = Math.max(0, e.hitFlash - dt);
      if (e.hitCooldown > 0) e.hitCooldown = Math.max(0, e.hitCooldown - dt);
      moveEnemy(e, dt);
      if (harmless) continue;
      const rr = 16 + e.radius * 0.8;
      if (dist2(e.x, e.y, player.x, player.y) > rr * rr) continue;
      if (player.invulnerable > 0 || e.hitCooldown > 0) continue;
      // Contact: the player is hurt. Kamikaze shades die; brutes bounce off.
      state.hp -= 1;
      player.invulnerable = PLAYER.invulnerable;
      const dx = player.x - e.x;
      const dy = player.y - e.y;
      const dl = Math.hypot(dx, dy) || 1;
      player.kx = (dx / dl) * PLAYER.knockback;
      player.ky = (dy / dl) * PLAYER.knockback;
      log('hit', player.x, player.y, 0);
      events |= EVENT_HIT;
      if (ENEMY[e.kind].contact) {
        e.active = false;
        log('kill', e.x, e.y, e.kind);
      } else {
        e.hitCooldown = 0.8;
        e.vx = -(dx / dl) * 260;
        e.vy = -(dy / dl) * 260;
      }
      if (state.hp <= 0) {
        events |= EVENT_OVER;
        return events;
      }
    }

    // Bolts fly and hit shades.
    for (let i = 0; i < bolts.length; i += 1) {
      const b = bolts[i];
      if (!b.active) continue;
      b.life -= dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.life <= 0 || b.x < -BOLT.margin || b.x > FIELD.width + BOLT.margin || b.y < -BOLT.margin || b.y > FIELD.height + BOLT.margin) {
        b.active = false;
        continue;
      }
      for (let j = 0; j < enemies.length; j += 1) {
        const e = enemies[j];
        if (!e.active) continue;
        const rr = BOLT.radius + e.radius;
        if (dist2(b.x, b.y, e.x, e.y) > rr * rr) continue;
        b.active = false;
        damageEnemy(e, b.damage);
        if (!e.active) events |= EVENT_KILL;
        break;
      }
    }

    // Shards drift, get magnetised, and are collected.
    for (let i = 0; i < shards.length; i += 1) {
      const s = shards[i];
      if (!s.active) continue;
      s.life -= dt;
      if (s.life <= 0) {
        s.active = false;
        continue;
      }
      const d2 = dist2(s.x, s.y, player.x, player.y);
      const magnetR = stats.magnet;
      if (d2 < magnetR * magnetR) {
        const d = Math.sqrt(d2) || 1;
        const pull = SHARD.pullSpeed * (1.2 - d / magnetR);
        s.vx += ((player.x - s.x) / d) * pull * dt * 6;
        s.vy += ((player.y - s.y) / d) * pull * dt * 6;
      }
      s.vx *= Math.max(0, 1 - dt * 3);
      s.vy *= Math.max(0, 1 - dt * 3);
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (d2 < (16 + SHARD.radius + 6) * (16 + SHARD.radius + 6)) {
        s.active = false;
        gainXp(SHARD.value);
        log('shard', s.x, s.y, 0);
        events |= EVENT_SHARD;
      }
    }

    if (state.pendingLevels > 0 && !state.autoLevel) events |= EVENT_LEVEL;
    return events;
  }

  reset();
  return { state, reset, step, nova, applyUpgrade, offerUpgrades };
}

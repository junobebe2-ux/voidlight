// Drawing only: the world's state and the current screen in, pixels out. The 1280x720
// playfield is scaled to fit the window and centred. Glow comes from three small
// pre-rendered radial sprites (amber, coral, cyan) drawn additively — no shadowBlur, so
// a busy frame stays cheap. Visual-only effects live here too: the particle pool, floating
// numbers, nova rings, trauma-based screen shake and the level-up flash. The shake moves
// the camera only, never the simulation; it decays in real time so it never freezes
// off-centre during a hit-stop.
import { FIELD, FONT_BODY, FONT_DISPLAY, HP, NOVA, PALETTE, POOL, UPGRADES, xpForLevel } from './config.js';
import { createRandom } from './random.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_LEVELUP = 'levelup';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';

/** Level-up card geometry, shared with main.js for click hit-testing. */
export function cardRects() {
  const w = 300;
  const h = 168;
  const gap = 28;
  const total = w * 3 + gap * 2;
  const x0 = (FIELD.width - total) / 2;
  const y = 300;
  return [0, 1, 2].map((i) => ({ x: x0 + i * (w + gap), y, w, h }));
}

function makeGlow(color) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, color);
  grad.addColorStop(0.35, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return c;
}

function hexToRgba(hex, alpha) {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function createRenderer(canvas) {
  const context = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };
  const glowAmber = makeGlow('rgba(255,196,107,0.55)');
  const glowCoral = makeGlow('rgba(255,93,115,0.4)');
  const glowCyan = makeGlow('rgba(110,231,255,0.5)');

  // The starfield: fixed positions from a seeded generator, so the backdrop is stable.
  const starRandom = createRandom(1337);
  const stars = [];
  for (let i = 0; i < 110; i += 1) {
    stars.push({ x: starRandom() * FIELD.width, y: starRandom() * FIELD.height, r: 0.6 + starRandom() * 1.6, phase: starRandom() * Math.PI * 2, speed: 0.4 + starRandom() * 1.2 });
  }

  const particles = [];
  for (let i = 0; i < POOL.particles; i += 1) particles.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 2, color: '#fff' });
  const numbers = [];
  for (let i = 0; i < POOL.numbers; i += 1) numbers.push({ active: false, x: 0, y: 0, life: 0, text: '', color: '#fff', size: 18 });

  let time = 0;
  let trauma = 0;
  let traumaT = 0;
  let flash = 0;
  let lastX = FIELD.width / 2;
  let lastY = FIELD.height / 2;
  let stretch = 0;
  let shootPulse = 0;
  let background = null;

  const fonts = new Map();
  function fontFor(size, display) {
    const key = `${size}|${display ? 'd' : 'b'}`;
    if (!fonts.has(key)) fonts.set(key, `${display ? '700 ' : ''}${size}px ${display ? FONT_DISPLAY : FONT_BODY}`);
    return fonts.get(key);
  }

  function text(value, x, y, size, color, align, display) {
    context.font = fontFor(size, display);
    context.fillStyle = color;
    context.textAlign = align;
    context.textBaseline = 'alphabetic';
    context.fillText(value, x, y);
  }

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * ratio);
    const height = Math.round(window.innerHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    view.scale = Math.min(width / FIELD.width, height / FIELD.height);
    view.x = (width - FIELD.width * view.scale) / 2;
    view.y = (height - FIELD.height * view.scale) / 2;
    background = null;
  }

  function roundRect(x, y, w, h, r) {
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + w, y, x + w, y + h, r);
    context.arcTo(x + w, y + h, x, y + h, r);
    context.arcTo(x, y + h, x, y, r);
    context.arcTo(x, y, x + w, y, r);
    context.closePath();
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function drawGlow(sprite, x, y, size) {
    context.drawImage(sprite, x - size / 2, y - size / 2, size, size);
  }

  function drawBackground() {
    if (background === null) {
      background = context.createRadialGradient(FIELD.width / 2, FIELD.height / 2, 60, FIELD.width / 2, FIELD.height / 2, 820);
      background.addColorStop(0, PALETTE.void);
      background.addColorStop(0.6, '#100d28');
      background.addColorStop(1, PALETTE.voidDeep);
    }
    context.fillStyle = background;
    context.fillRect(0, 0, FIELD.width, FIELD.height);
    for (let i = 0; i < stars.length; i += 1) {
      const s = stars[i];
      const a = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(time * s.speed + s.phase));
      context.globalAlpha = a;
      context.fillStyle = PALETTE.star;
      context.beginPath();
      context.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
  }

  function drawSpiky(x, y, radius, spikes, rotation, color, inner) {
    context.fillStyle = color;
    context.beginPath();
    for (let i = 0; i <= spikes * 2; i += 1) {
      const angle = rotation + (i / (spikes * 2)) * Math.PI * 2;
      const r = i % 2 === 0 ? radius : radius * inner;
      const px = x + Math.cos(angle) * r;
      const py = y + Math.sin(angle) * r;
      if (i === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    }
    context.closePath();
    context.fill();
  }

  function drawEnemy(e, player) {
    const flash = e.hitFlash > 0;
    const color = flash ? '#ffffff' : e.kind === 'brute' ? PALETTE.brute : e.kind === 'splitter' ? PALETTE.shadeDark : PALETTE.shade;
    context.globalCompositeOperation = 'lighter';
    drawGlow(glowCoral, e.x, e.y, e.radius * (e.kind === 'brute' ? 5.2 : 4.2));
    context.globalCompositeOperation = 'source-over';
    if (e.kind === 'drifter') {
      drawSpiky(e.x, e.y, e.radius, 8, e.t * 0.7, color, 0.62);
    } else if (e.kind === 'minion') {
      drawSpiky(e.x, e.y, e.radius, 6, e.t * 1.4, color, 0.6);
    } else if (e.kind === 'dart') {
      const angle = Math.atan2(player.y - e.y, player.x - e.x);
      context.save();
      context.translate(e.x, e.y);
      context.rotate(angle);
      context.fillStyle = color;
      context.beginPath();
      context.moveTo(e.radius * 1.5, 0);
      context.lineTo(-e.radius, e.radius * 0.85);
      context.lineTo(-e.radius * 0.4, 0);
      context.lineTo(-e.radius, -e.radius * 0.85);
      context.closePath();
      context.fill();
      context.restore();
    } else if (e.kind === 'splitter') {
      context.fillStyle = color;
      context.beginPath();
      for (let i = 0; i < 6; i += 1) {
        const angle = (i / 6) * Math.PI * 2 + e.t * 0.4;
        const px = e.x + Math.cos(angle) * e.radius;
        const py = e.y + Math.sin(angle) * e.radius;
        if (i === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
      }
      context.closePath();
      context.fill();
      context.fillStyle = PALETTE.voidDeep;
      context.beginPath();
      context.arc(e.x, e.y, e.radius * 0.42, 0, Math.PI * 2);
      context.fill();
    } else {
      // Brute: a large spiked mass with a dark core and a thin warning ring.
      drawSpiky(e.x, e.y, e.radius, 10, e.t * 0.35, color, 0.72);
      context.fillStyle = PALETTE.voidDeep;
      context.beginPath();
      context.arc(e.x, e.y, e.radius * 0.5, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = hexToRgba(PALETTE.shade, 0.7);
      context.lineWidth = 2;
      context.beginPath();
      context.arc(e.x, e.y, e.radius + 7 + Math.sin(time * 3) * 2, 0, Math.PI * 2);
      context.stroke();
      if (e.hp < e.maxHp) {
        const w = e.radius * 2;
        context.fillStyle = 'rgba(0,0,0,0.5)';
        context.fillRect(e.x - w / 2, e.y - e.radius - 14, w, 5);
        context.fillStyle = PALETTE.shade;
        context.fillRect(e.x - w / 2, e.y - e.radius - 14, w * (e.hp / e.maxHp), 5);
      }
    }
  }

  function drawPlayer(state, dt) {
    const p = state.player;
    // Squash and stretch from motion: stretch along the direction of travel, springing back.
    const vx = (p.x - lastX) / Math.max(dt, 0.001);
    const vy = (p.y - lastY) / Math.max(dt, 0.001);
    const speed = Math.hypot(vx, vy);
    const target = Math.min(0.22, speed / 2400);
    stretch += (target - stretch) * Math.min(1, dt * 10);
    const angle = speed > 20 ? Math.atan2(vy, vx) : 0;
    lastX = p.x;
    lastY = p.y;
    shootPulse = Math.max(0, shootPulse - dt * 4);

    const blink = p.invulnerable > 0 && Math.floor(p.invulnerable * 12) % 2 === 0;
    const pulse = 1 + Math.sin(time * 2.4) * 0.05 + shootPulse * 0.14;
    const glowSize = 190 + Math.sin(time * 2.4) * 10;

    context.save();
    context.globalCompositeOperation = 'lighter';
    drawGlow(glowAmber, p.x, p.y, glowSize);
    context.globalCompositeOperation = 'source-over';
    if (!blink) {
      context.translate(p.x, p.y);
      context.rotate(angle);
      context.scale((1 + stretch) * pulse, (1 - stretch * 0.7) * pulse);
      context.rotate(-angle);
      // The lantern: an amber ring, a pale core, and a small flame.
      context.strokeStyle = PALETTE.player;
      context.lineWidth = 3;
      context.beginPath();
      context.arc(0, 0, 16, 0, Math.PI * 2);
      context.stroke();
      context.fillStyle = PALETTE.playerCore;
      context.beginPath();
      context.arc(0, 0, 9, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = PALETTE.ember;
      context.beginPath();
      context.moveTo(0, -11);
      context.quadraticCurveTo(5, -2, 0, 4);
      context.quadraticCurveTo(-5, -2, 0, -11);
      context.fill();
    }
    context.restore();
  }

  function drawBolts(state) {
    context.globalCompositeOperation = 'lighter';
    for (let i = 0; i < state.bolts.length; i += 1) {
      const b = state.bolts[i];
      if (!b.active) continue;
      drawGlow(glowAmber, b.x, b.y, 34);
      context.fillStyle = PALETTE.playerCore;
      context.beginPath();
      context.arc(b.x, b.y, 5, 0, Math.PI * 2);
      context.fill();
    }
    context.globalCompositeOperation = 'source-over';
  }

  function drawShards(state) {
    context.globalCompositeOperation = 'lighter';
    for (let i = 0; i < state.shards.length; i += 1) {
      const s = state.shards[i];
      if (!s.active) continue;
      const blink = s.life < 3 ? (Math.floor(s.life * 6) % 2 === 0 ? 0.35 : 1) : 1;
      context.globalAlpha = blink;
      drawGlow(glowCyan, s.x, s.y, 30);
      context.globalAlpha = blink;
      context.fillStyle = PALETTE.xp;
      context.save();
      context.translate(s.x, s.y);
      context.rotate(time * 2 + s.x);
      context.fillRect(-4.5, -4.5, 9, 9);
      context.restore();
    }
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
  }

  function drawNovaRings() {
    for (let i = 0; i < novaRings.length; i += 1) {
      const ring = novaRings[i];
      if (!ring.active) continue;
      const t = 1 - ring.life / ring.maxLife;
      const radius = NOVA.radius * (0.25 + 0.75 * (1 - (1 - t) * (1 - t)));
      context.strokeStyle = hexToRgba(PALETTE.player, (1 - t) * 0.9);
      context.lineWidth = 10 * (1 - t) + 2;
      context.beginPath();
      context.arc(ring.x, ring.y, radius, 0, Math.PI * 2);
      context.stroke();
      context.strokeStyle = hexToRgba(PALETTE.playerCore, (1 - t) * 0.5);
      context.lineWidth = 3;
      context.beginPath();
      context.arc(ring.x, ring.y, radius * 0.82, 0, Math.PI * 2);
      context.stroke();
    }
  }

  const novaRings = [];
  for (let i = 0; i < 4; i += 1) novaRings.push({ active: false, x: 0, y: 0, life: 0, maxLife: 0.5 });

  function drawParticles(dt) {
    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.max(0, 1 - dt * 3);
      p.vy *= Math.max(0, 1 - dt * 3);
      context.globalAlpha = Math.max(0, p.life / p.maxLife);
      context.fillStyle = p.color;
      context.beginPath();
      context.arc(p.x, p.y, p.size * (p.life / p.maxLife), 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
  }

  function drawNumbers(dt) {
    for (let i = 0; i < numbers.length; i += 1) {
      const n = numbers[i];
      if (!n.active) continue;
      n.life -= dt;
      if (n.life <= 0) {
        n.active = false;
        continue;
      }
      n.y -= 42 * dt;
      context.globalAlpha = Math.min(1, n.life / 0.4);
      text(n.text, n.x, n.y, n.size, n.color, 'center');
    }
    context.globalAlpha = 1;
  }

  function drawHeart(x, y, size, filled) {
    context.save();
    context.translate(x, y);
    context.scale(size / 16, size / 16);
    context.beginPath();
    context.moveTo(0, 5);
    context.bezierCurveTo(-9, -3, -6, -11, 0, -5);
    context.bezierCurveTo(6, -11, 9, -3, 0, 5);
    context.closePath();
    if (filled) {
      context.fillStyle = PALETTE.player;
      context.fill();
    } else {
      context.strokeStyle = PALETTE.muted;
      context.lineWidth = 1.6;
      context.stroke();
    }
    context.restore();
  }

  function drawHud(state, ui) {
    // Hearts, top left.
    for (let i = 0; i < state.stats.hpMax; i += 1) {
      drawHeart(30 + i * 30, 34, 22, i < state.hp);
    }
    // XP bar and level, top centre.
    const barW = 380;
    const barX = (FIELD.width - barW) / 2;
    const barY = 22;
    context.fillStyle = 'rgba(0,0,0,0.45)';
    roundRect(barX - 2, barY - 2, barW + 4, 16, 8);
    context.fill();
    context.fillStyle = PALETTE.xp;
    const need = xpForLevel(state.level);
    const frac = need > 0 ? Math.min(1, state.xp / need) : 0;
    if (frac > 0) {
      roundRect(barX, barY, barW * frac, 12, 6);
      context.fill();
    }
    text(`LEVEL ${state.level}`, FIELD.width / 2, barY + 40, 20, PALETTE.text, 'center');
    // Wave, score and time, top right.
    text(`WAVE ${state.wave}`, FIELD.width - 24, 34, 22, PALETTE.muted, 'right');
    text(String(Math.floor(state.score)), FIELD.width - 24, 64, 30, PALETTE.text, 'right');
    text(formatTime(state.elapsed), FIELD.width - 24, 92, 20, PALETTE.muted, 'right');
    // Nova charges, bottom left.
    for (let i = 0; i < state.stats.novaMax; i += 1) {
      const x = 30 + i * 26;
      const y = FIELD.height - 30;
      context.beginPath();
      context.arc(x, y, 9, 0, Math.PI * 2);
      if (i < state.novaCharges) {
        context.fillStyle = PALETTE.player;
        context.fill();
      } else {
        context.strokeStyle = PALETTE.muted;
        context.lineWidth = 2;
        context.stroke();
      }
    }
    text(state.novaCooldown > 0 ? 'nova recharging' : 'SPACE — nova', 30, FIELD.height - 52, 16, PALETTE.muted, 'left');
    // Hints, bottom right.
    const hints = [`M ${ui.muted ? 'unmute' : 'mute'}`, `F ${ui.calm ? 'full effects' : 'calm mode'}`, 'P pause', 'R restart'];
    text(hints.join('   '), FIELD.width - 24, FIELD.height - 30, 16, PALETTE.muted, 'right');
  }

  function drawPanel(title, lines, prompt, titleColor) {
    const width = 640;
    const lineH = 32;
    const height = 150 + lines.length * lineH + 74;
    const x = (FIELD.width - width) / 2;
    const y = (FIELD.height - height) / 2;
    context.fillStyle = hexToRgba(PALETTE.panel, 0.94);
    roundRect(x, y, width, height, 18);
    context.fill();
    context.strokeStyle = PALETTE.panelEdge;
    context.lineWidth = 2;
    roundRect(x, y, width, height, 18);
    context.stroke();
    text(title, FIELD.width / 2, y + 74, 52, titleColor ?? PALETTE.text, 'center', true);
    for (let i = 0; i < lines.length; i += 1) {
      text(lines[i], FIELD.width / 2, y + 128 + i * lineH, 21, PALETTE.muted, 'center');
    }
    text(prompt, FIELD.width / 2, y + height - 30, 22, PALETTE.player, 'center');
  }

  function drawTitle(state, best) {
    // A slow lantern glow behind the title, over the drifting backdrop.
    context.globalCompositeOperation = 'lighter';
    drawGlow(glowAmber, FIELD.width / 2, 215, 330 + Math.sin(time * 1.2) * 18);
    context.globalCompositeOperation = 'source-over';
    text('VOIDLIGHT', FIELD.width / 2, 268, 84, PALETTE.text, 'center', true);
    text('You are the last lantern-light in the dark.', FIELD.width / 2, 312, 22, PALETTE.muted, 'center');
    text('Shades converge from the edges. Outlast them.', FIELD.width / 2, 344, 22, PALETTE.muted, 'center');
    const lines = [
      'Move — WASD or arrow keys',
      'Your lantern fires on its own. SPACE unleashes a nova.',
      'Gather light shards, level up, choose your blessing.',
      'Survive the waves. Fall, and the dark takes the light.',
    ];
    lines.forEach((line, i) => text(line, FIELD.width / 2, 420 + i * 30, 20, PALETTE.text, 'center'));
    if (best > 0) text(`Best score ${best}`, FIELD.width / 2, 566, 20, PALETTE.player, 'center');
    text('Press SPACE or click to begin', FIELD.width / 2, 612, 24, PALETTE.player, 'center');
  }

  function drawLevelUp(state, ui) {
    text('LEVEL UP', FIELD.width / 2, 190, 56, PALETTE.text, 'center', true);
    text(`Level ${state.level} — choose a blessing`, FIELD.width / 2, 232, 22, PALETTE.muted, 'center');
    const rects = cardRects();
    const offer = state.offer;
    for (let i = 0; i < 3; i += 1) {
      const r = rects[i];
      // The offer holds upgrade ids; look the card's text up here.
      const upgrade = UPGRADES.find((u) => u.id === offer[i]);
      const hover = ui.pointer.x >= r.x && ui.pointer.x <= r.x + r.w && ui.pointer.y >= r.y && ui.pointer.y <= r.y + r.h;
      context.fillStyle = hover ? '#2a2352' : hexToRgba(PALETTE.panel, 0.96);
      roundRect(r.x, r.y, r.w, r.h, 14);
      context.fill();
      context.strokeStyle = hover ? PALETTE.player : PALETTE.panelEdge;
      context.lineWidth = hover ? 3 : 2;
      roundRect(r.x, r.y, r.w, r.h, 14);
      context.stroke();
      if (!upgrade) continue;
      text(String(i + 1), r.x + 22, r.y + 36, 18, PALETTE.muted, 'left');
      // Word-wrap the upgrade name and text inside the card.
      context.font = fontFor(24, true);
      const nameWords = upgrade.name.split(' ');
      let line = '';
      let ny = r.y + 78;
      for (const word of nameWords) {
        if (context.measureText(`${line} ${word}`.trim()).width > r.w - 44 && line !== '') {
          text(line, r.x + r.w / 2, ny, 24, PALETTE.text, 'center', true);
          ny += 30;
          line = word;
        } else {
          line = `${line} ${word}`.trim();
        }
      }
      if (line !== '') {
        text(line, r.x + r.w / 2, ny, 24, PALETTE.text, 'center', true);
        ny += 30;
      }
      context.font = fontFor(18, false);
      const words = upgrade.text.split(' ');
      line = '';
      let ty = ny + 14;
      for (const word of words) {
        if (context.measureText(`${line} ${word}`.trim()).width > r.w - 44 && line !== '') {
          text(line, r.x + r.w / 2, ty, 18, PALETTE.muted, 'center');
          ty += 24;
          line = word;
        } else {
          line = `${line} ${word}`.trim();
        }
      }
      if (line !== '') text(line, r.x + r.w / 2, ty, 18, PALETTE.muted, 'center');
    }
    text('Press 1, 2 or 3 — or click a card', FIELD.width / 2, 540, 20, PALETTE.muted, 'center');
  }

  function drawOver(state, best) {
    const lines = [
      `Score ${Math.floor(state.score)}    Best ${Math.floor(best)}`,
      `Survived ${formatTime(state.elapsed)}  ·  Wave ${state.wave}  ·  ${state.kills} shades banished  ·  Level ${state.level}`,
      '',
      'The dark takes the light — this time.',
    ];
    drawPanel('The light goes out', lines, 'Press R or click to light it again', PALETTE.shade);
  }

  /** Paint one frame. `dt` is real seconds since the last frame (drives the effects). */
  function draw(state, screen, best, ui, dt) {
    time += dt;
    // Trauma decays in real time, so a hit-stop never freezes the camera off-centre.
    traumaT += dt * 30;
    const decay = ui.calm ? 2.4 : 1.6;
    trauma = Math.max(0, trauma - decay * dt);
    flash = Math.max(0, flash - dt * 2.2);
    for (let i = 0; i < novaRings.length; i += 1) {
      const ring = novaRings[i];
      if (!ring.active) continue;
      ring.life -= dt;
      if (ring.life <= 0) ring.active = false;
    }
    const shake = trauma * trauma * (ui.calm ? 0.35 : 1);
    const shakeX = 13 * shake * Math.sin(traumaT * 1.7);
    const shakeY = 9 * shake * Math.sin(traumaT * 2.3);

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = PALETTE.backdrop;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.setTransform(view.scale, 0, 0, view.scale, view.x + shakeX * view.scale, view.y + shakeY * view.scale);
    drawBackground();
    for (let i = 0; i < state.enemies.length; i += 1) {
      const e = state.enemies[i];
      if (e.active) drawEnemy(e, state.player);
    }
    drawShards(state);
    drawBolts(state);
    drawPlayer(state, dt);
    drawNovaRings();
    context.globalCompositeOperation = 'lighter';
    drawParticles(dt);
    context.globalCompositeOperation = 'source-over';
    drawNumbers(dt);

    // The HUD and panels sit still while the field shakes.
    context.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    if (screen === SCREEN_TITLE) {
      drawTitle(state, best);
    } else {
      drawHud(state, ui);
      if (screen === SCREEN_LEVELUP) drawLevelUp(state, ui);
      else if (screen === SCREEN_PAUSED) drawPanel('Paused', ['The shades wait in the dark.'], 'Press P to return to the light');
      else if (screen === SCREEN_OVER) drawOver(state, best);
    }

    // One soft flash on level-up (never more than a gentle pulse; calm mode dims it).
    if (flash > 0) {
      context.fillStyle = hexToRgba(PALETTE.player, flash * (ui.calm ? 0.1 : 0.22));
      context.fillRect(0, 0, FIELD.width, FIELD.height);
    }
  }

  function burst(x, y, color, count, speed, size) {
    for (let i = 0; i < count; i += 1) {
      let p = null;
      for (let j = 0; j < particles.length; j += 1) {
        if (!particles[j].active) {
          p = particles[j];
          break;
        }
      }
      if (p === null) return;
      const angle = Math.random() * Math.PI * 2;
      const v = speed * (0.3 + Math.random() * 0.7);
      p.active = true;
      p.x = x;
      p.y = y;
      p.vx = Math.cos(angle) * v;
      p.vy = Math.sin(angle) * v;
      p.maxLife = 0.4 + Math.random() * 0.45;
      p.life = p.maxLife;
      p.size = size * (0.6 + Math.random() * 0.8);
      p.color = color;
    }
  }

  function number(x, y, value, color, size) {
    let n = null;
    for (let i = 0; i < numbers.length; i += 1) {
      if (!numbers[i].active) {
        n = numbers[i];
        break;
      }
    }
    if (n === null) return;
    n.active = true;
    n.x = x + (Math.random() - 0.5) * 14;
    n.y = y - 10;
    n.life = 0.8;
    n.text = String(value);
    n.color = color;
    n.size = size ?? 18;
  }

  resize();
  window.addEventListener('resize', resize);

  return {
    draw,
    /** Add camera trauma (0..1); hits add, they never reset. */
    addTrauma(amount) {
      trauma = Math.min(1, trauma + amount);
    },
    shootPulse() {
      shootPulse = 1;
    },
    flash() {
      flash = 1;
    },
    novaRing(x, y) {
      for (let i = 0; i < novaRings.length; i += 1) {
        if (!novaRings[i].active) {
          novaRings[i].active = true;
          novaRings[i].x = x;
          novaRings[i].y = y;
          novaRings[i].life = 0.5;
          novaRings[i].maxLife = 0.5;
          return;
        }
      }
    },
    burst,
    number,
  };
}

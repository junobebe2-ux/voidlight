// Boot and the one loop: input is read every frame, the world advances in fixed 1/60 s
// steps (several in a slow frame, none in a fast one), and the renderer paints what is
// there. The game moves between five screens: title, play, level-up, paused and game over.
// Hit-stop slows the simulation for a few real milliseconds after a brute kill or a nova;
// the newest hit-stop owns the restore, so overlapping stops never end early.
//
// ?seed=N fixes the spawn pattern. ?shot=start|play|end (with &seed=N) stages that scene
// instead of running the loop, paints it twice and sets window.__shotReady for a screenshot.
import { BEST_KEY, ENEMY, NOVA, PALETTE, STEP, xpForLevel } from './config.js';
import { createRandom } from './random.js';
import { createWorld, EVENT_HIT, EVENT_KILL, EVENT_LEVEL, EVENT_OVER } from './world.js';
import {
  ACTION_CALM, ACTION_CONFIRM, ACTION_MUTE, ACTION_NOVA, ACTION_PAUSE,
  ACTION_PICK_1, ACTION_PICK_2, ACTION_PICK_3, ACTION_RESTART, createInput,
} from './input.js';
import { cardRects, createRenderer, SCREEN_LEVELUP, SCREEN_OVER, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { createAudio } from './audio.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const world = createWorld(createRandom(seed));
const renderer = createRenderer(canvas);

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off (private windows): the best score then lasts this visit only.
  }
}

function runShot(name) {
  const scene = stageShot(name, world);
  const ui = { muted: false, calm: false, pointer: { x: -1, y: -1 } };
  let painted = 0;
  function paint() {
    renderer.draw(world.state, scene.screen, scene.best, ui, 1 / 60);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  const audio = createAudio();
  let screen = SCREEN_TITLE;
  let best = readBest();
  let accumulator = 0;
  let last = performance.now();
  let slowUntil = 0;
  const ui = { muted: false, calm: false, pointer: input.pointer };

  // Screen readers (and anyone watching the page's text) hear the screen changes and each hit.
  function announce(message) {
    status.textContent = message;
  }

  function hitStop(durationMs) {
    slowUntil = Math.max(slowUntil, performance.now() + durationMs);
  }

  function startGame() {
    audio.unlock();
    world.reset();
    accumulator = 0;
    screen = SCREEN_PLAY;
    announce('Playing. Hold the light. WASD or arrows to move, Space for a nova.');
  }

  function endGame() {
    screen = SCREEN_OVER;
    if (world.state.score > best) {
      best = world.state.score;
      saveBest(best);
    }
    audio.death();
    renderer.addTrauma(0.8);
    announce(`Game over. Score ${Math.floor(world.state.score)}. Best ${Math.floor(best)}. Press R to play again.`);
  }

  function pickUpgrade(index) {
    const offer = world.state.offer;
    if (index >= offer.length) return;
    const id = offer[index];
    audio.click();
    world.applyUpgrade(id);
    if (world.state.pendingLevels <= 0) {
      screen = SCREEN_PLAY;
      announce('Playing.');
    }
  }

  function drainEvents() {
    const log = world.state.eventLog;
    for (let i = 0; i < log.length; i += 1) {
      const event = log[i];
      if (event.type === 'shoot') {
        renderer.shootPulse();
        audio.shoot();
      } else if (event.type === 'damage') {
        renderer.number(event.x, event.y, event.extra, '#ffffff', 16);
      } else if (event.type === 'kill') {
        const kind = event.extra;
        audio.kill(kind);
        const big = kind === 'brute';
        renderer.burst(event.x, event.y, big ? PALETTE.brute : PALETTE.shade, big ? 30 : 10, big ? 320 : 220, big ? 4 : 3);
        renderer.number(event.x, event.y - 14, `+${ENEMY[kind].score}`, PALETTE.player, 18);
        if (big) {
          renderer.addTrauma(0.6);
          hitStop(90);
        }
      } else if (event.type === 'hit') {
        audio.hit();
        renderer.addTrauma(0.55);
        renderer.burst(event.x, event.y, PALETTE.player, 14, 260, 4);
      } else if (event.type === 'shard') {
        audio.shard();
        renderer.burst(event.x, event.y, PALETTE.xp, 2, 120, 2.5);
      } else if (event.type === 'level') {
        audio.level();
        renderer.flash();
        renderer.burst(world.state.player.x, world.state.player.y, PALETTE.xp, 22, 280, 3.5);
        announce(`Level ${event.extra}. Choose a blessing.`);
      } else if (event.type === 'nova') {
        audio.nova();
        renderer.novaRing(event.x, event.y);
        renderer.burst(event.x, event.y, PALETTE.player, 26, 420, 4);
        renderer.addTrauma(0.7);
        hitStop(90);
      }
    }
    log.length = 0;
  }

  function handleActions() {
    const actions = input.takeActions();
    if (actions & ACTION_MUTE) {
      ui.muted = audio.toggleMute();
      announce(ui.muted ? 'Muted.' : 'Sound on.');
    }
    if (actions & ACTION_CALM) {
      ui.calm = !ui.calm;
      announce(ui.calm ? 'Calm mode on: less shake and flash.' : 'Calm mode off.');
    }
    if (screen === SCREEN_TITLE) {
      if (actions & ACTION_CONFIRM) startGame();
      return;
    }
    if (screen === SCREEN_OVER) {
      if (actions & (ACTION_CONFIRM | ACTION_RESTART)) startGame();
      return;
    }
    if (screen === SCREEN_LEVELUP) {
      if (actions & ACTION_PICK_1) pickUpgrade(0);
      else if (actions & ACTION_PICK_2) pickUpgrade(1);
      else if (actions & ACTION_PICK_3) pickUpgrade(2);
      else if (input.takeClick()) {
        const rects = cardRects();
        const p = input.pointer;
        for (let i = 0; i < rects.length; i += 1) {
          const r = rects[i];
          if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) {
            pickUpgrade(i);
            break;
          }
        }
      }
      return;
    }
    if (screen === SCREEN_PAUSED) {
      if (actions & (ACTION_PAUSE | ACTION_CONFIRM)) {
        screen = SCREEN_PLAY;
        announce('Playing.');
      } else if (actions & ACTION_RESTART) startGame();
      return;
    }
    // SCREEN_PLAY
    if (actions & ACTION_PAUSE) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    } else if (actions & ACTION_RESTART) {
      startGame();
    } else if (actions & ACTION_NOVA) {
      if (world.nova()) drainEvents();
    }
  }

  function step() {
    if (screen === SCREEN_TITLE) {
      world.step(STEP, 0, 0, true);
      drainEvents();
      return;
    }
    const move = input.move();
    const events = world.step(STEP, move.x, move.y, false);
    drainEvents();
    if (events & EVENT_OVER) endGame();
    else if (events & EVENT_LEVEL && world.state.pendingLevels > 0) {
      screen = SCREEN_LEVELUP;
      announce('Level up. Choose a blessing.');
    } else if (events & EVENT_HIT) {
      announce(world.state.hp === 1 ? 'Hit. One heart left.' : `Hit. ${world.state.hp} hearts left.`);
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const timeScale = now < slowUntil ? 0.06 : 1;
    accumulator += Math.min((now - last) / 1000, MAX_FRAME) * timeScale;
    const dtReal = Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    handleActions();
    if (screen === SCREEN_TITLE || screen === SCREEN_PLAY) {
      while (accumulator >= STEP && (screen === SCREEN_TITLE || screen === SCREEN_PLAY)) {
        step();
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    world.state.xpNeed = xpForLevel(world.state.level);
    renderer.draw(world.state, screen, best, ui, dtReal);
  }

  // Leaving the tab pauses a running game rather than letting shades close in unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      announce('Paused.');
    }
  });

  // A read-only handle for automated play-tests (and curious players in devtools):
  // the world state and the current screen, nothing that plays the game for you.
  window.__voidlight = { world, get screen() { return screen; } };

  announce('Voidlight. Press Space or click to start.');
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();

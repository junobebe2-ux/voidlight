// The screenshot scenes behind ?shot=start|play|end. Each one plays the real rules forward
// from a fresh world for a fixed number of steps, steered by a simple autopilot (flee the
// nearest shade when it closes in, chase the nearest light shard otherwise, fire a nova
// when surrounded), so the frame is what a real game looks like and the same seed always
// gives the same frame. Level-ups apply themselves in shot mode (autoLevel), so the play
// scene never stalls on the upgrade screen.
import { FIELD, STEP } from './config.js';
import { EVENT_OVER } from './world.js';
import { SCREEN_OVER, SCREEN_PLAY, SCREEN_TITLE } from './render.js';

const START_SECONDS = 6;
const PLAY_SECONDS = 70;
const END_LIMIT_SECONDS = 240;
/**
 * How close, in pixels, a shade must get before the autopilot flees it: the play scene's
 * pilot keeps a wide berth and survives; the end scene's never flees at all, so it is
 * caught out once the waves speed up, as a hurried player is.
 */
const FLEE_PLAY = 150;
const FLEE_END = 0;

function nearestEnemy(state) {
  let best = null;
  let bestD = Infinity;
  for (let i = 0; i < state.enemies.length; i += 1) {
    const e = state.enemies[i];
    if (!e.active) continue;
    const d = Math.hypot(e.x - state.player.x, e.y - state.player.y);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return { enemy: best, dist: bestD };
}

function nearestShard(state) {
  let best = null;
  let bestD = Infinity;
  for (let i = 0; i < state.shards.length; i += 1) {
    const s = state.shards[i];
    if (!s.active) continue;
    const d = Math.hypot(s.x - state.player.x, s.y - state.player.y);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return { shard: best, dist: bestD };
}

/** Where to steer this step: away from a close shade, else toward the nearest shard. */
function autopilot(state, fleeDistance) {
  const player = state.player;
  const { enemy, dist } = nearestEnemy(state);
  let tx = FIELD.width / 2;
  let ty = FIELD.height / 2;
  if (enemy !== null && dist < fleeDistance) {
    tx = player.x + (player.x - enemy.x);
    ty = player.y + (player.y - enemy.y);
  } else {
    const { shard, dist: shardDist } = nearestShard(state);
    if (shard !== null && shardDist < 420) {
      tx = shard.x;
      ty = shard.y;
    }
  }
  const dx = tx - player.x;
  const dy = ty - player.y;
  const len = Math.hypot(dx, dy);
  if (len < 8) return { x: 0, y: 0 };
  return { x: dx / len, y: dy / len };
}

function surrounded(state) {
  let count = 0;
  for (let i = 0; i < state.enemies.length; i += 1) {
    const e = state.enemies[i];
    if (!e.active) continue;
    if (Math.hypot(e.x - state.player.x, e.y - state.player.y) < 280) count += 1;
  }
  return count >= 6;
}

/**
 * Set `world` to the named scene (start, play or end; any other name is start) and return
 * the screen to draw over it and the best score to show.
 */
export function stageShot(name, world) {
  world.reset();
  world.state.autoLevel = true;
  if (name !== 'play' && name !== 'end') {
    for (let i = 0; i < START_SECONDS / STEP; i += 1) world.step(STEP, 0, 0, true);
    return { screen: SCREEN_TITLE, best: 0 };
  }
  const limit = name === 'end' ? END_LIMIT_SECONDS : PLAY_SECONDS;
  const flee = name === 'end' ? FLEE_END : FLEE_PLAY;
  let over = false;
  for (let i = 0; i < limit / STEP; i += 1) {
    const move = autopilot(world.state, flee);
    if (name === 'play' && surrounded(world.state)) world.nova();
    if (world.step(STEP, move.x, move.y, false) & EVENT_OVER) {
      over = true;
      break;
    }
  }
  if (!over && name === 'end') {
    // A stubborn pilot that outlived the limit: end it the honest way, by letting the
    // shades close in on a one-heart lantern.
    world.state.hp = 1;
    world.state.player.invulnerable = 0;
    for (let i = 0; i < 600 && !over; i += 1) {
      const enemy = world.state.enemies.find((e) => e.active);
      if (enemy) {
        enemy.x = world.state.player.x + 5;
        enemy.y = world.state.player.y;
        enemy.hitCooldown = 0;
      }
      if (world.step(STEP, 0, 0, false) & EVENT_OVER) over = true;
    }
  }
  return { screen: over ? SCREEN_OVER : SCREEN_PLAY, best: world.state.score };
}

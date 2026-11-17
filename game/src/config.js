// VOIDLIGHT — every tuning number and colour in one place. The playfield is a fixed
// 1280x720 logical area; the renderer scales it to the window, so no rule below depends
// on the screen size. Palette: the void is deep indigo, the player is warm amber light,
// the shades are coral-red, XP shards are cyan.

export const FIELD = { width: 1280, height: 720 };

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

export const PLAYER = {
  radius: 16,
  speed: 335,
  /** Seconds of mercy after taking a hit. */
  invulnerable: 1.0,
  /** Contact knockback applied to the player, px/s. */
  knockback: 420,
};

export const HP = { start: 3, max: 5 };

/** Auto-fire: bolts fly at the nearest shade inside range. */
export const BOLT = {
  speed: 660,
  radius: 5,
  damage: 1,
  /** Bolts per second at level 1. */
  fireRate: 2.4,
  range: 430,
  /** A bolt dies this far past the field edge. */
  margin: 60,
};

/** Nova burst (Space): a ring of light that hurts everything near the player. */
export const NOVA = {
  radius: 300,
  damage: 3,
  chargesStart: 2,
  chargesMax: 5,
  /** Seconds between two novas. */
  cooldown: 1.2,
  /** A free charge arrives every this many seconds survived. */
  freeChargeSeconds: 45,
};

/** Enemy kinds. speed is px/s toward the player; hp in bolt hits; shards is XP dropped. */
export const ENEMY = {
  drifter: { radius: 17, speed: 88, hp: 2, shards: 1, score: 10, contact: true },
  dart: { radius: 12, speed: 210, hp: 1, shards: 1, score: 15, contact: true },
  splitter: { radius: 22, speed: 66, hp: 3, shards: 2, score: 25, contact: true },
  minion: { radius: 10, speed: 150, hp: 1, shards: 0, score: 5, contact: true },
  brute: { radius: 34, speed: 52, hp: 12, shards: 4, score: 60, contact: false },
};

/** Waves: one wave every WAVE_SECONDS; each wave unlocks faster spawns and new kinds. */
export const WAVE = {
  seconds: 20,
  /** Spawn interval at wave 1, in seconds. */
  interval: 0.95,
  /** Each wave multiplies the interval by this (never below the floor). */
  intervalScale: 0.88,
  minInterval: 0.22,
  /** Wave at which each kind first appears. */
  unlock: { drifter: 1, dart: 2, splitter: 3, brute: 4 },
  /** Extra speed per wave, px/s. */
  speedPerWave: 6,
};

/** Light shards (XP): drift toward the player inside the magnet radius. */
export const SHARD = {
  radius: 7,
  /** XP one shard is worth. */
  value: 1,
  /** Shards are pulled in from this far. */
  magnet: 110,
  /** Pull speed once inside the magnet radius. */
  pullSpeed: 520,
  /** Shards fade out after this many seconds uncollected. */
  lifetime: 14,
};

/** XP to go from level n to n+1. */
export function xpForLevel(level) {
  return 5 + level * 4;
}

/** The upgrades offered at each level-up: id, name, and what it does to the stats. */
export const UPGRADES = [
  { id: 'rate', name: 'Quickened Flame', text: 'Bolts fly 20% faster', apply: (s) => { s.fireRate *= 1.2; } },
  { id: 'damage', name: 'Sharper Light', text: '+1 bolt damage', apply: (s) => { s.damage += 1; } },
  { id: 'speed', name: 'Swift Steps', text: 'Move 12% faster', apply: (s) => { s.moveSpeed *= 1.12; } },
  { id: 'nova', name: 'Deep Well', text: '+1 nova charge (max 5)', apply: (s) => { s.novaMax = Math.min(NOVA.chargesMax, s.novaMax + 1); s.novaCharges = Math.min(s.novaMax, s.novaCharges + 1); } },
  { id: 'magnet', name: 'Wide Lantern', text: 'Magnet radius +45%', apply: (s) => { s.magnet *= 1.45; } },
  { id: 'heart', name: 'Steadfast Heart', text: '+1 max HP and heal 1', apply: (s) => { s.hpMax = Math.min(HP.max, s.hpMax + 1); s.hp = Math.min(s.hpMax, s.hp + 1); } },
];

/** How many of each pool can exist at once; pools are allocated once, at boot. */
export const POOL = { enemies: 96, bolts: 64, shards: 160, particles: 256, numbers: 32 };

export const PALETTE = {
  backdrop: '#0d0a1f',
  void: '#14112e',
  voidDeep: '#0a0819',
  star: '#8f86c9',
  player: '#ffc46b',
  playerCore: '#fff3d6',
  ember: '#ff9d5c',
  shade: '#ff5d73',
  shadeDark: '#c93a52',
  brute: '#e5484d',
  xp: '#6ee7ff',
  text: '#f4eedd',
  muted: '#a49cc9',
  panel: '#1d1840',
  panelEdge: '#3a3168',
  danger: '#ff5d73',
  good: '#6ee7ff',
};

export const FONT_DISPLAY = '"Cinzel", "Palatino Linotype", "Book Antiqua", serif';
export const FONT_BODY = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Where the best score is kept between visits (this browser only). */
export const BEST_KEY = 'voidlight.best';

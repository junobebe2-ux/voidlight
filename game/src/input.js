// Keyboard and pointer input for VOIDLIGHT. Held keys give a steering vector; one-shot
// presses (confirm, nova, pause, mute, calm mode, restart, upgrade picks) are queued as
// bit flags and taken once by the loop, so a press between two frames is never lost and
// never counted twice. Pointer position is reported in playfield coordinates (1280x720)
// so the renderer can hit-test the level-up cards.
import { FIELD } from './config.js';

export const ACTION_CONFIRM = 1;
export const ACTION_NOVA = 2;
export const ACTION_PAUSE = 4;
export const ACTION_MUTE = 8;
export const ACTION_CALM = 16;
export const ACTION_RESTART = 32;
export const ACTION_PICK_1 = 64;
export const ACTION_PICK_2 = 128;
export const ACTION_PICK_3 = 256;

const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const UP = new Set(['ArrowUp', 'KeyW']);
const DOWN = new Set(['ArrowDown', 'KeyS']);
const CONFIRM = new Set(['Space', 'Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);

export function createInput(canvas) {
  let left = false;
  let right = false;
  let up = false;
  let down = false;
  let actions = 0;
  /** Latest pointer position in playfield coordinates, or null before the first move. */
  const pointer = { x: -1, y: -1, down: false, clicked: false };

  function toField(event) {
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(rect.width / FIELD.width, rect.height / FIELD.height);
    const ox = (rect.width - FIELD.width * scale) / 2;
    const oy = (rect.height - FIELD.height * scale) / 2;
    return {
      x: (event.clientX - rect.left - ox) / scale,
      y: (event.clientY - rect.top - oy) / scale,
    };
  }

  window.addEventListener('keydown', (event) => {
    if (LEFT.has(event.code)) left = true;
    else if (RIGHT.has(event.code)) right = true;
    else if (UP.has(event.code)) up = true;
    else if (DOWN.has(event.code)) down = true;
    else if (CONFIRM.has(event.code)) {
      // Space is also the nova key during play; the loop decides by screen. Confirm
      // is only consumed on title / game-over screens, nova only during play.
      if (!event.repeat) actions |= ACTION_CONFIRM | ACTION_NOVA;
    } else if (PAUSE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_PAUSE;
    } else if (event.code === 'KeyM') {
      if (!event.repeat) actions |= ACTION_MUTE;
    } else if (event.code === 'KeyF') {
      if (!event.repeat) actions |= ACTION_CALM;
    } else if (event.code === 'KeyR') {
      if (!event.repeat) actions |= ACTION_RESTART;
    } else if (event.code === 'Digit1' || event.code === 'Numpad1') {
      if (!event.repeat) actions |= ACTION_PICK_1;
    } else if (event.code === 'Digit2' || event.code === 'Numpad2') {
      if (!event.repeat) actions |= ACTION_PICK_2;
    } else if (event.code === 'Digit3' || event.code === 'Numpad3') {
      if (!event.repeat) actions |= ACTION_PICK_3;
    } else return;
    event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    if (LEFT.has(event.code)) left = false;
    else if (RIGHT.has(event.code)) right = false;
    else if (UP.has(event.code)) up = false;
    else if (DOWN.has(event.code)) down = false;
  });
  // A key released while the tab is hidden never sends keyup: let go of everything on blur.
  window.addEventListener('blur', () => {
    left = false;
    right = false;
    up = false;
    down = false;
  });
  canvas.addEventListener('pointermove', (event) => {
    const p = toField(event);
    pointer.x = p.x;
    pointer.y = p.y;
  });
  canvas.addEventListener('pointerdown', (event) => {
    const p = toField(event);
    pointer.x = p.x;
    pointer.y = p.y;
    pointer.down = true;
    pointer.clicked = true;
    actions |= ACTION_CONFIRM;
  });
  window.addEventListener('pointerup', () => {
    pointer.down = false;
  });

  return {
    /** Steering vector, each component -1, 0 or 1 (the world normalises it). */
    move() {
      return { x: (right ? 1 : 0) - (left ? 1 : 0), y: (down ? 1 : 0) - (up ? 1 : 0) };
    },
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
    pointer,
    /** True once since the last call if the pointer went down (for card clicks). */
    takeClick() {
      const clicked = pointer.clicked;
      pointer.clicked = false;
      return clicked;
    },
  };
}

// Joystick virtual e olhar por toque no celular.
import { builder } from './builder.js';
import { chatOpen } from './chat.js';
import { $, H, canvas } from './dom.js';
import { game } from './state.js';

const touchMove = { x: 0, y: 0, pointer: null };
let touchY = null;
// Independent pointer capture keeps walking and looking usable with two fingers.
function resetJoystick() {
  const pointer = touchMove.pointer;
  touchMove.pointer = null;
  touchMove.x = touchMove.y = 0;
  const stick = $('moveJoystick');
  $('joystickThumb').style.transform = 'translate(-50%,-50%)';
  try {
    if (pointer !== null && stick.hasPointerCapture?.(pointer))
      stick.releasePointerCapture(pointer);
  } catch {}
}
function moveJoystick(e) {
  if (e.pointerId !== touchMove.pointer) return;
  if (game.state !== 'playing' || chatOpen) {
    resetJoystick();
    return;
  }
  e.preventDefault();
  const rect = $('moveJoystick').getBoundingClientRect(),
    radius = rect.width * 0.32;
  const dx = e.clientX - rect.left - rect.width / 2,
    dy = e.clientY - rect.top - rect.height / 2;
  const length = Math.hypot(dx, dy),
    clamped = Math.min(length, radius),
    amount = Math.max(0, (clamped / radius - 0.1) / 0.9);
  touchMove.x = length ? (dx / length) * amount : 0;
  touchMove.y = length ? (dy / length) * amount : 0;
  $('joystickThumb').style.transform =
    `translate(calc(-50% + ${length ? (dx / length) * clamped : 0}px),calc(-50% + ${length ? (dy / length) * clamped : 0}px))`;
}

function setupTouch() {
  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse' && game.state === 'playing' && game.touchLookPointer === null) {
      game.touchLookPointer = e.pointerId;
      game.touchX = e.clientX;
      touchY = e.clientY;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {}
    }
  });
  canvas.addEventListener('pointermove', e => {
    if (e.pointerId === game.touchLookPointer && game.touchX !== null && game.state === 'playing') {
      game.player.a += (e.clientX - game.touchX) * 0.006;
      if (builder.custom && touchY !== null)
        game.viewPitch = Math.max(
          -H * 0.6,
          Math.min(H * 0.4, game.viewPitch - (e.clientY - touchY) * 0.7),
        );
      game.touchX = e.clientX;
      touchY = e.clientY;
    }
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
    canvas.addEventListener(type, e => {
      if (e.pointerId === game.touchLookPointer) {
        game.touchLookPointer = null;
        game.touchX = null;
      }
    });
  $('moveJoystick').addEventListener('pointerdown', e => {
    if (
      game.state !== 'playing' ||
      chatOpen ||
      touchMove.pointer !== null ||
      (e.pointerType === 'mouse' && e.button !== 0)
    )
      return;
    e.preventDefault();
    try {
      $('moveJoystick').setPointerCapture(e.pointerId);
    } catch {}
    touchMove.pointer = e.pointerId;
    moveJoystick(e);
  });
  $('moveJoystick').addEventListener('pointermove', moveJoystick);
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'])
    $('moveJoystick').addEventListener(event, e => {
      if (e.pointerId === touchMove.pointer) resetJoystick();
    });
  window.addEventListener('blur', resetJoystick);
  globalThis.screen?.orientation?.addEventListener('change', resetJoystick);
  // Document listeners also release the stick if capture is unavailable.
  document.addEventListener('pointermove', moveJoystick, { passive: false });
  for (const type of ['pointerup', 'pointercancel'])
    document.addEventListener(type, e => {
      if (e.pointerId === touchMove.pointer) resetJoystick();
      if (e.pointerId === game.touchLookPointer) {
        game.touchLookPointer = null;
        game.touchX = null;
      }
    });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) resetJoystick();
  });
}

export { resetJoystick, setupTouch, touchMove };

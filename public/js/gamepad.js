// Controles Xbox/PlayStation e teclado virtual para o controle.
import { builder, builderApply, closeBuilderPalette, openBuilderPalette } from './builder.js';
import { chatOpen, closeChat, openChat } from './chat.js';
import { $ } from './dom.js';
import { pause, start } from './engine.js';
import { closeLeaderboard } from './leaderboard.js';
import { closeMissions } from './missions.js';
import { leaveRoom, net, showPanel } from './net.js';
import { reviveAll } from './revive.js';
import { game } from './state.js';

let padSensitivity = 1;
let padInput = { x: 0, y: 0, lookX: 0, lookY: 0, run: false },
  padActive = false,
  padIndex = -1,
  padPrevious = [],
  padEditor = null;
function axisValue(value = 0) {
  const n = Number.isFinite(value) ? value : 0;
  return Math.abs(n) < 0.18 ? 0 : Math.sign(n) * Math.min(1, (Math.abs(n) - 0.18) / 0.82);
}
function clearPadInput() {
  padInput = { x: 0, y: 0, lookX: 0, lookY: 0, run: false };
}
function setPadMode(active) {
  padActive = active;
  document.body.classList.toggle('controller-mode', active);
  $('padHints').hidden = !active;
  $('keyboardHints').hidden = active;
  $('padStatus').textContent = active
    ? 'Controle conectado · A / × confirma · B / ○ volta'
    : 'Tem controle? Conecte e aperte qualquer botão.';
}
function menuTargets() {
  const root = padEditor
    ? $('padKeyboard')
    : !$('nameGate').hidden
      ? $('nameGate')
      : chatOpen
        ? $('chatPanel')
        : !$('workshop').hidden
          ? $('workshop')
          : builder.editing && !$('builderPalette').hidden
            ? $('builderPalette')
            : $('overlay');
  return [...root.querySelectorAll('button,input')].filter(
    el => !el.disabled && el.getClientRects().length > 0,
  );
}
function focusPad(el) {
  if (!el) return;
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function movePadFocus(dx, dy) {
  const list = menuTargets();
  if (!list.length) return;
  const current = document.activeElement;
  if (!list.includes(current)) {
    focusPad(list[0]);
    return;
  }
  const r = current.getBoundingClientRect(),
    cx = r.x + r.width / 2,
    cy = r.y + r.height / 2;
  let best = null,
    bestScore = Infinity;
  for (const el of list) {
    if (el === current) continue;
    const b = el.getBoundingClientRect(),
      x = b.x + b.width / 2 - cx,
      y = b.y + b.height / 2 - cy,
      along = dx ? x * dx : y * dy,
      across = dx ? Math.abs(y) : Math.abs(x);
    if (along <= 5) continue;
    const score = along + across * 3;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (best) focusPad(best);
  else
    focusPad(
      list[(list.indexOf(current) + (dx < 0 || dy < 0 ? -1 : 1) + list.length) % list.length],
    );
}
function openPadKeyboard(input) {
  padEditor = { input, original: input.value, draft: input.value };
  $('padKeyboardTitle').textContent =
    input.id === 'chatInput'
      ? 'Mensagem para a equipe'
      : input.id === 'roomCode'
        ? 'Código da sala'
        : 'Nome do explorador';
  $('padKeyboardValue').textContent = input.value || '…';
  $('padKeys').replaceChildren();
  const chars =
    input.id === 'roomCode'
      ? 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
      : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ';
  for (const char of chars) {
    const button = document.createElement('button');
    button.textContent = char === ' ' ? 'ESPAÇO' : char;
    button.onclick = () => {
      if (!padEditor) return;
      const limit =
        padEditor.input.id === 'chatInput' ? 240 : padEditor.input.id === 'roomCode' ? 6 : 32;
      if (padEditor.draft.length < limit) padEditor.draft += char;
      $('padKeyboardValue').textContent = padEditor.draft || '…';
    };
    $('padKeys').append(button);
  }
  $('padKeyboard').hidden = false;
  focusPad($('padKeys').querySelector('button'));
}
function closePadKeyboard(save) {
  if (!padEditor) return;
  const { input, draft } = padEditor;
  if (save) input.value = draft;
  padEditor = null;
  $('padKeyboard').hidden = true;
  focusPad(input);
}
function erasePadChar() {
  if (!padEditor) return;
  padEditor.draft = padEditor.draft.slice(0, -1);
  $('padKeyboardValue').textContent = padEditor.draft || '…';
}
function activatePadMenu() {
  const list = menuTargets();
  let selected = list.includes(document.activeElement) ? document.activeElement : list[0];
  if (!selected) return;
  if (selected.tagName === 'INPUT') openPadKeyboard(selected);
  else selected.click();
}
function pollController(now) {
  let pads;
  try {
    pads = Array.from(navigator.getGamepads?.() || []);
  } catch {
    clearPadInput();
    return;
  }
  const pad =
    pads.find(p => p && p.connected !== false && p.index === padIndex) ||
    pads.find(p => p && p.connected !== false);
  if (!pad) {
    clearPadInput();
    if (padActive) {
      setPadMode(false);
      padPrevious = [];
      padIndex = -1;
      if (game.state === 'playing') pause();
      $('padStatus').textContent = 'Controle desconectado. Reconecte para continuar.';
    }
    return;
  }
  const pressed = pad.buttons.map(b => Boolean(b?.pressed || b?.value > 0.5));
  const engaged = pressed.some(Boolean) || pad.axes.some(a => Math.abs(a) > 0.25);
  if (!padActive && !engaged) {
    clearPadInput();
    return;
  }
  if (!padActive || pad.index !== padIndex) {
    padPrevious = [];
    padIndex = pad.index;
    setPadMode(true);
  }
  const hit = i => pressed[i] && !padPrevious[i];
  clearPadInput();
  if (document.hidden) {
    padPrevious = pressed;
    return;
  }
  if (!padEditor && $('nameGate').hidden && hit(8)) {
    chatOpen ? closeChat() : openChat();
    padPrevious = pressed;
    return;
  }
  if (padEditor) {
    if (hit(1)) closePadKeyboard(false);
    else if (hit(3) || hit(9)) closePadKeyboard(true);
    else if (hit(2)) erasePadChar();
    else if (hit(0)) activatePadMenu();
  } else if (game.state === 'ready' && !$('nameGate').hidden) {
    if (hit(0)) activatePadMenu();
  } else if (chatOpen) {
    if (hit(1) || hit(9)) closeChat();
    else if (hit(0)) activatePadMenu();
  } else if (builder.editing && !$('builderPalette').hidden) {
    if (hit(1) || hit(9) || hit(3)) closeBuilderPalette();
    else if (hit(0)) activatePadMenu();
  } else if (game.state === 'playing') {
    const walk = stickVector(pad.axes[0], pad.axes[1], 0.16, 1),
      look = stickVector(pad.axes[2], pad.axes[3], 0.19, 1.7);
    padInput = {
      x: walk.x,
      y: walk.y,
      lookX: look.x,
      lookY: look.y,
      run: Boolean(pressed[4] || pressed[7] || pressed[10]),
    };
    if (builder.editing) {
      if (hit(0)) builderApply();
      if (hit(2)) builderApply(true);
      if (hit(3)) $('builderPalette').hidden ? openBuilderPalette() : closeBuilderPalette();
    } else {
      if (hit(2)) game.light = !game.light;
      if (hit(3)) void reviveAll();
    }
    if (hit(9) || hit(1)) {
      clearPadInput();
      pause();
    }
  } else {
    if (hit(3)) void reviveAll();
    if ((!$('missionsPanel').hidden || !$('leaderboardPanel').hidden) && (hit(1) || hit(9))) {
      if (!$('missionsPanel').hidden) closeMissions();
      else closeLeaderboard();
    } else if (hit(9) && game.state === 'paused') start();
    else if (hit(1)) {
      if (game.state === 'paused') start();
      else if (net) void leaveRoom();
      else {
        game.state = 'ready';
        showPanel('home');
      }
    } else if (hit(0)) activatePadMenu();
  }
  if (game.state !== 'playing' || padEditor || (builder.editing && !$('builderPalette').hidden)) {
    const ax = pad.axes[0] || 0,
      ay = pad.axes[1] || 0;
    if (Math.hypot(ax, ay) < 0.35) game.padMenuNeutral = false;
    let x = pressed[14]
        ? -1
        : pressed[15]
          ? 1
          : !game.padMenuNeutral && Math.abs(ax) > 0.65
            ? Math.sign(ax)
            : 0,
      y = pressed[12]
        ? -1
        : pressed[13]
          ? 1
          : !game.padMenuNeutral && Math.abs(ay) > 0.65
            ? Math.sign(ay)
            : 0;
    if (x && y) {
      if (Math.abs(ay) >= Math.abs(ax)) x = 0;
      else y = 0;
    }
    const direction = x + ',' + y;
    if ((x || y) && (direction !== game.padNavDirection || now >= game.padNavNext)) {
      const first = direction !== game.padNavDirection;
      movePadFocus(x, y);
      game.padNavNext = now + (first ? 420 : 180);
      game.padNavDirection = direction;
    }
    if (!x && !y) {
      game.padNavDirection = '';
      game.padNavNext = 0;
    }
  }
  padPrevious = pressed;
}
function stickVector(x = 0, y = 0, deadzone = 0.16, curve = 1) {
  x = Number.isFinite(x) ? x : 0;
  y = Number.isFinite(y) ? y : 0;
  const magnitude = Math.hypot(x, y);
  if (magnitude <= deadzone) return { x: 0, y: 0 };
  const strength = Math.pow(Math.min(1, (magnitude - deadzone) / (1 - deadzone)), curve);
  return { x: (x / magnitude) * strength, y: (y / magnitude) * strength };
}
function cyclePadSensitivity() {
  padSensitivity = padSensitivity === 1 ? 1.4 : padSensitivity === 1.4 ? 0.65 : 1;
  const label = padSensitivity === 0.65 ? 'SUAVE' : padSensitivity === 1 ? 'NORMAL' : 'RÁPIDA';
  for (const id of ['padSensitivityHome', 'padSensitivityPause'])
    $(id).textContent = 'CÂMERA: ' + label;
}

function setupGamepad() {
  $('padErase').onclick = erasePadChar;
  $('padDone').onclick = () => closePadKeyboard(true);
  $('padCancel').onclick = () => closePadKeyboard(false);
  window.addEventListener('gamepaddisconnected', () => {
    clearPadInput();
  });
  $('padSensitivityHome').onclick = cyclePadSensitivity;
  $('padSensitivityPause').onclick = cyclePadSensitivity;
}

export {
  closePadKeyboard,
  focusPad,
  padActive,
  padEditor,
  padInput,
  padSensitivity,
  pollController,
  setupGamepad,
};

// Seleção de modo (Normal/Hardcore) e de fase.
import { $ } from './dom.js';
import { reset } from './engine.js';
import { applySnapshot, isAdmin, net, roomAction, roomPayload, showLobby } from './net.js';
import { game } from './state.js';

let selectedMode = 'normal',
  modeBusy = false;
let levelBusy = false;
function updateLevelButtons() {}
function updateModeUI() {
  const hard = game.activeMode === 'hardcore';
  $('modeBadge').hidden = !hard;
  document.body.classList.toggle('hardcore-mode', hard);
  $('coinHud').hidden = hard && !isAdmin();
  $('keyboardHints').textContent =
    'WASD MOVER · MOUSE OLHAR · SHIFT CORRER · F LANTERNA' + (hard ? '' : ' · V REVIVER (25)');
  $('padHints').textContent =
    'LS MOVER · RS OLHAR · LB / L1 CORRER · X / □ LANTERNA' +
    (hard ? '' : ' · Y / △ REVIVER') +
    ' · START MENU';
  $('homeIntro').textContent =
    selectedMode === 'hardcore'
      ? 'Encontrem os fusíveis de cada fase e a saída. Dois monstros caçam vocês. Sem moedas e sem segunda chance.'
      : 'Encontrem os fusíveis de cada fase e escapem juntos. As moedas reaparecem em 10 segundos; 25 moedas revivem a equipe.';
}
function updateModeButtons() {
  for (const b of document.querySelectorAll('[data-mode]')) {
    const lobby = b.dataset.place === 'lobby',
      mode = lobby && net ? net.room.mode || 'normal' : selectedMode;
    b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    b.disabled =
      lobby &&
      (!net || net.room.host !== net.id || net.room.status === 'playing' || modeBusy || levelBusy);
  }
  if (net)
    $('lobbyModeNote').textContent =
      (net.room.mode === 'hardcore'
        ? 'Hardcore: dois monstros, sem moedas e sem reviver.'
        : 'Normal: moedas reaparecem no mesmo lugar em 10 segundos.') +
      (net.room.host === net.id ? '' : ' O anfitrião escolhe o modo.');
}
async function selectMode(mode, place = 'home') {
  if (!['normal', 'hardcore'].includes(mode)) return;
  if (place === 'home') {
    selectedMode = mode;
    reset(93451, game.selectedLevel, mode);
    updateModeButtons();
    return;
  }
  if (!net || modeBusy || levelBusy || net.room.host !== net.id || net.room.status === 'playing')
    return;
  const session = net;
  modeBusy = true;
  updateModeButtons();
  try {
    const data = await roomAction('mode', { ...roomPayload(), mode });
    if (net === session) {
      applySnapshot(data);
      showLobby();
    }
  } catch (e) {
    $('lobbyStatus').textContent = e.message;
  } finally {
    modeBusy = false;
    updateModeButtons();
  }
}

function setupModes() {
  for (const b of document.querySelectorAll('[data-mode]'))
    b.onclick = () => selectMode(b.dataset.mode, b.dataset.place);
}

export { selectedMode, setupModes, updateLevelButtons, updateModeButtons, updateModeUI };

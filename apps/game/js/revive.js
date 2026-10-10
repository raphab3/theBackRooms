// Reviver jogadores (solo e equipe).
import { initAudio } from './audio.js';
import { builder } from './builder.js';
import { $ } from './dom.js';
import { lock, resetMotion, say } from './engine.js';
import { missionAdd, missionSet } from './missions.js';
import { applySnapshot, isAdmin, net, roomAction, roomPayload, showPanel } from './net.js';
import { game } from './state.js';

function updateRescueUI() {
  const hardcore = game.activeMode === 'hardcore' && !isAdmin();
  $('coinHud').hidden = hardcore;
  $('rescuePanel').hidden = hardcore;
  const hasDead = net ? net.room.players.some(p => !p.alive) : game.state === 'lost';
  const active = net
    ? ['playing', 'lost'].includes(net.room.status)
    : ['playing', 'paused', 'lost'].includes(game.state);
  const enough = isAdmin() || game.coinBalance >= 25,
    enabled = !hardcore && active && hasDead && enough && !game.reviveBusy;
  $('coinCount').textContent = isAdmin() ? '∞' : String(game.coinBalance);
  $('menuCoinCount').textContent = isAdmin() ? '∞' : String(game.coinBalance);
  $('reviveHud').disabled = !enabled;
  $('reviveMenu').disabled = !enabled;
  $('reviveHud').textContent = game.reviveBusy ? 'REVIVENDO…' : 'V · REVIVER · 25';
  $('reviveMenu').textContent = game.reviveBusy ? 'REVIVENDO…' : 'V · REVIVER TODOS · 25 MOEDAS';
  $('rescuePanel').hidden = hardcore || !active || !$('homePanel').hidden;
  $('rescueHint').textContent = !hasDead
    ? '25 moedas revivem todos os capturados.'
    : enough
      ? 'Aperte V ou toque no botão para voltar à expedição.'
      : 'Faltam ' + (25 - game.coinBalance) + ' moedas para reviver.';
}
async function reviveAll() {
  if (game.activeMode === 'hardcore' && !isAdmin()) {
    say('Hardcore: não é possível reviver.');
    return;
  }
  if (game.reviveBusy) return;
  const feedback = text => {
    say(text);
    $('rescueMessage').textContent = text;
  };
  const hasDead = net ? net.room.players.some(p => !p.alive) : game.state === 'lost';
  if (!hasDead) {
    feedback('Todos os exploradores estão vivos.');
    return;
  }
  missionSet('coins', game.coinBalance);
  if (!isAdmin() && game.coinBalance < 25) {
    feedback('Você precisa de 25 moedas para reviver.');
    return;
  }
  if (net) {
    const session = net;
    game.reviveBusy = true;
    updateRescueUI();
    try {
      const data = await roomAction('revive', roomPayload());
      if (net !== session) return;
      applySnapshot(data);
      missionAdd('rescues');
      feedback('Equipe revivida! 25 moedas utilizadas.');
    } catch (e) {
      feedback(e.message);
    } finally {
      game.reviveBusy = false;
      updateRescueUI();
    }
    return;
  }
  resetMotion();
  game.touchX = null;
  if (!builder.custom) missionAdd('rescues');
  if (!isAdmin()) game.coinBalance -= 25;
  game.player = builder.custom ? { ...builder.custom.spawn } : { x: 1.5, y: 1.5, a: 0 };
  game.enemy = game.soloEnemySpawn ? { ...game.soloEnemySpawn } : null;
  if (builder.custom)
    game.smile = builder.custom.monsters[1]
      ? { ...builder.custom.monsters[1], type: 'smile' }
      : null;
  game.enemyPath = [];
  game.pathTimer = 0;
  game.stamina = 100;
  game.soloProtectedUntil = game.elapsed + 5;
  game.state = 'playing';
  game.keys = {};
  document.body.classList.add('playing');
  showPanel('pause');
  initAudio();
  lock();
  feedback('Você reviveu! 5 segundos de proteção.');
  updateRescueUI();
}

function setupRevive() {
  $('reviveHud').onclick = () => reviveAll();
  $('reviveMenu').onclick = () => reviveAll();
}

export { reviveAll, setupRevive, updateRescueUI };

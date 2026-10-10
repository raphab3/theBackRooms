// Multiplayer: salas, sincronização por polling, lobby e trilha de movimento.
import { PHASE_ORDER } from '../world.js';
import { initAudio, syncGameMusic, syncMenuMusic, tone } from './audio.js';
import { builder, openWorkshop, returnToBuilder } from './builder.js';
import { closeChat, renderChat } from './chat.js';
import { $ } from './dom.js';
import { finish, lock, phaseIntro, reset, resetMotion, say, start, updateHud } from './engine.js';
import { enterLandscape } from './fullscreen.js';
import { focusPad, padActive } from './gamepad.js';
import { LEVEL_INFO } from './levels.js';
import { missionSet, recordMissionWin } from './missions.js';
import { selectedMode, updateLevelButtons, updateModeButtons } from './modes.js';
import { drawExplorer } from './render.js';
import { updateRescueUI } from './revive.js';
import { game } from './state.js';

let movementTrail = [],
  movementOrdinal = 0,
  movementSentOrdinal = 0,
  movementAnchor = { x: 1.5, y: 1.5 },
  movementWaiting = false;
let net = null,
  remotePlayers = [],
  remoteTargets = [],
  netBusy = false,
  netSeq = 0,
  pollTimer = null,
  sceneRound = -1;
function showPanel(which) {
  $('adminPanel').hidden = !isAdmin();
  document.body.classList.toggle(
    'game-menu',
    which === 'pause' || which === 'missions' || which === 'leaderboard',
  );
  $('overlay').scrollTop = 0;
  game.padNavDirection = '';
  game.padNavNext = 0;
  for (const id of ['home', 'lobby', 'pause', 'missions', 'leaderboard'])
    $(id + 'Panel').hidden = id !== which;
  updateRescueUI();
  if (padActive) {
    const first =
      which === 'missions'
        ? $('closeMissions')
        : which === 'leaderboard'
          ? $('closeLeaderboard')
          : which === 'pause'
            ? $('start')
            : which === 'lobby'
              ? $('launch')
              : $('createRoom');
    if (!first.disabled) focusPad(first);
  }
}
function busyHome(b) {
  $('createRoom').disabled = b;
  $('joinRoom').disabled = b;
  $('solo').disabled = b;
}
async function requestRoom(action, payload, path = '/api/rooms/') {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(path + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    let data;
    try {
      data = await response.json();
    } catch {
      throw Error('Não foi possível conectar. Atualize a página e tente de novo.');
    }
    if (!response.ok) {
      const error = Error(data.error || 'A sala não respondeu.');
      error.status = response.status;
      throw error;
    }
    return data;
  } catch (e) {
    if (e.name === 'AbortError')
      throw Error('A conexão demorou demais. Confira a internet e tente novamente.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
function isAdmin() {
  return $('nickname').value.trim().toLowerCase() === 'lucca416453416453admin';
}
function nameInput() {
  let name = $('nickname').value.trim();
  if (!name) {
    $('nickname').focus();
    throw Error('Escreva seu nome para entrar.');
  }
  return name;
}
async function connectRoom(action) {
  void enterLandscape();
  $('homeError').textContent = '';
  try {
    const name = nameInput(),
      code = $('roomCode').value.trim().toUpperCase();
    if (action === 'join' && !/^[A-Z2-9]{6}$/.test(code))
      throw Error('Digite o código de 6 caracteres enviado pelo anfitrião.');
    busyHome(true);
    const data = await requestRoom(action, {
      name,
      code,
      level: PHASE_ORDER[0],
      mode: selectedMode,
      campaign: true,
    });
    net = {
      id: data.id,
      token: data.token,
      code: data.room.code,
      connected: true,
      dead: false,
      room: data.room,
    };
    netSeq = 0;
    sceneRound = -1;
    remotePlayers = [];
    applySnapshot(data, true);
    if (data.room.status === 'lobby') showLobby();
    schedulePoll();
  } catch (e) {
    $('homeError').textContent = e.message;
  } finally {
    busyHome(false);
  }
}
function roomPayload() {
  recordMovement();
  // Keep local movement independent of network latency. Send bounded prefixes,
  // retaining every unacknowledged turn and an immutable in-flight endpoint.
  const trail = [];
  let x = movementAnchor.x,
    y = movementAnchor.y,
    distance = 0;
  for (const point of movementTrail) {
    const d = Math.hypot(point[1] - x, point[2] - y);
    if (trail.length >= 96 || (trail.length && distance + d > 5)) break;
    trail.push([...point]);
    distance += d;
    x = point[1];
    y = point[2];
  }
  if (trail.length) movementSentOrdinal = Math.max(movementSentOrdinal, trail.at(-1)[0]);
  return {
    code: net.code,
    id: net.id,
    token: net.token,
    round: net.room.round,
    seq: ++netSeq,
    x,
    y,
    a: game.player.a,
    respawns: net.respawns || 0,
    trail,
  };
}
function schedulePoll() {
  clearTimeout(pollTimer);
  if (net)
    pollTimer = setTimeout(
      syncRoom,
      net.room.status === 'playing' ? (movementTrail.length && !movementWaiting ? 30 : 180) : 700,
    );
}
async function syncRoom() {
  if (!net || netBusy) return;
  const session = net;
  netBusy = true;
  try {
    const data = await requestRoom('sync', roomPayload());
    if (net !== session) return;
    net.connected = true;
    applySnapshot(data);
  } catch (e) {
    if (net !== session) return;
    net.connected = false;
    game.keys = {};
    $('connection').textContent = 'RECONECTANDO…';
    $('lobbyStatus').textContent = e.message;
    if (e.status === 401 || e.status === 404) {
      await leaveRoom(false);
      $('homeError').textContent = e.message;
    }
  } finally {
    netBusy = false;
    schedulePoll();
  }
}
function applySnapshot(data, initial = false) {
  const room = data.room;
  if (!net) return;
  if (!initial && room.revision < net.room.revision) return;
  const previousCount = game.fuses.filter(f => f.taken).length,
    oldStatus = net.room.status;
  net.room = room;
  net.connected = true;
  renderChat();
  $('connection').textContent = 'EQUIPE CONECTADA';
  $('roomBadge').textContent = 'SALA ' + room.code;
  $('onlineHud').hidden = false;
  if (sceneRound !== room.round || initial) {
    reset(room.seed, room.level || 'backrooms', room.mode || 'normal');
    sceneRound = room.round;
    netSeq = 0;
    net.dead = false;
    const mine = room.players.find(p => p.id === net.id);
    if (mine) {
      game.player.x = mine.x;
      game.player.y = mine.y;
      game.player.a = mine.a;
      resetMovementTrail();
    }
    if (room.status === 'playing') {
      game.state = 'playing';
      showPanel('pause');
      document.body.classList.add('playing');
      syncMenuMusic();
      syncGameMusic();
      lock();
      say(phaseIntro(room.level));
    } else {
      game.state = 'lobby';
    }
  }
  if (Number.isSafeInteger(data.ackMovement)) {
    const acknowledged = movementTrail.filter(p => p[0] <= data.ackMovement).at(-1);
    if (acknowledged) movementAnchor = { x: acknowledged[1], y: acknowledged[2] };
    movementTrail = movementTrail.filter(p => p[0] > data.ackMovement);
  }
  movementWaiting = data.positionAccepted === false && data.movementReason === 'speed';
  if (data.positionAccepted === false && !movementWaiting && data.movementReason !== 'respawn') {
    const mine = room.players.find(p => p.id === net.id);
    if (mine) {
      game.player.x = mine.x;
      game.player.y = mine.y;
      resetMovementTrail(data.ackMovement || 0);
    }
  }
  if (movementWaiting) $('connection').textContent = 'SINCRONIZANDO MOVIMENTO…';
  game.coins.forEach(c => (c.taken = (room.collectedCoins || []).includes(c.id)));
  game.coinBalance = room.balance || 0;
  if (room.status !== 'lobby') {
    missionSet('coins', game.coinBalance);
    missionSet('fuses', room.fuses.filter(Boolean).length);
  }
  game.elapsed = room.started ? Math.max(0, (room.now - room.started) / 1000) : 0;
  game.fuses.forEach((f, i) => (f.taken = room.fuses[i]));
  game.enemy = { ...room.enemy };
  game.smile = room.smile ? { ...room.smile } : null;
  updateHud();
  if (room.fuses.filter(Boolean).length > previousCount && !initial) {
    tone(700, 0.2);
    say(
      room.fuses.every(Boolean)
        ? 'A equipe restaurou a energia! Procurem a saída verde.'
        : 'Sua equipe encontrou um fusível!',
    );
  }
  remoteTargets = room.players
    .filter(p => p.id !== net.id)
    .map(p => ({ ...p, received: performance.now() }));
  remotePlayers = remoteTargets.map(p => {
    const old = remotePlayers.find(v => v.id === p.id);
    return { ...p, x: old?.x ?? p.x, y: old?.y ?? p.y };
  });
  $('teamStatus').replaceChildren(
    ...room.players.map(p => {
      const div = document.createElement('div');
      div.textContent = (p.alive ? '● ' : '× ') + p.name + (p.id === net.id ? ' (você)' : '');
      div.style.color = p.alive ? p.color : '#a59988';
      return div;
    }),
  );
  const mine = room.players.find(p => p.id === net.id);
  if (
    mine &&
    room.status === 'playing' &&
    mine.alive &&
    (net.dead || (mine.respawns || 0) > (net.respawns || 0))
  ) {
    net.dead = false;
    resetMotion();
    game.keys = {};
    game.touchX = null;
    game.player.x = mine.x;
    game.player.y = mine.y;
    game.player.a = mine.a;
    resetMovementTrail();
    game.stamina = 100;
    game.state = 'playing';
    document.body.classList.add('playing');
    showPanel('pause');
    say('Você reviveu! 5 segundos de proteção.');
  }
  net.respawns = mine?.respawns || 0;
  if (room.status === 'won') recordMissionWin();
  if (room.status === 'won' && room.campaign && PHASE_ORDER[PHASE_ORDER.indexOf(room.level) + 1]) {
    $('story').textContent = 'Fase concluída!';
    $('details').textContent =
      'A equipe avança para ' +
      LEVEL_INFO[PHASE_ORDER[PHASE_ORDER.indexOf(room.level) + 1]].name +
      ' em instantes…';
  }
  if (room.status === 'won' || room.status === 'lost') {
    if (game.state !== room.status && $('lobbyPanel').hidden) {
      finish(room.status === 'won');
      $('story').textContent =
        room.status === 'won' ? 'A equipe encontrou a saída!' : 'A expedição chegou ao fim.';
      $('details').textContent =
        room.status === 'won'
          ? 'Vocês escaparam juntos em ' +
            Math.floor(game.elapsed / 60) +
            'min ' +
            Math.floor(game.elapsed % 60) +
            's.'
          : 'Todos os exploradores foram capturados. Voltem à sala para tentar novamente.';
    }
  } else if (mine && !mine.alive && !net.dead) {
    net.dead = true;
    finish(false);
    $('story').textContent = 'Você foi capturado.';
    $('details').textContent =
      'Sua equipe continua na expedição. Aguarde o resultado ou acompanhe pela sala.';
  }
  if (room.status === 'won' && room.campaign) {
    const next = PHASE_ORDER[PHASE_ORDER.indexOf(room.level) + 1];
    $('story').textContent = next ? 'Fase concluída!' : 'Vocês voltaram ao mundo normal!';
    $('details').textContent = next
      ? 'A equipe avança para ' + LEVEL_INFO[next].name + ' em instantes…'
      : 'O passado ficou para trás. Vocês escaparam das Backrooms Glitch juntos!';
    $('start').hidden = !!next;
  } else $('start').hidden = false;
  updateRescueUI();
  if (!$('lobbyPanel').hidden) renderLobby();
}
function interpolateRemote() {
  for (const p of remotePlayers) {
    const target = remoteTargets.find(t => t.id === p.id);
    if (!target) continue;
    let d = Math.hypot(target.x - p.x, target.y - p.y);
    if (d > 2) {
      p.x = target.x;
      p.y = target.y;
    } else {
      p.x += (target.x - p.x) * 0.22;
      p.y += (target.y - p.y) * 0.22;
    }
  }
}
function showLobby() {
  if (!net) return;
  game.state = 'lobby';
  game.keys = {};
  document.body.classList.remove('playing');
  syncMenuMusic();
  syncGameMusic();
  document.exitPointerLock?.();
  showPanel('lobby');
  renderLobby();
}
function renderLobby() {
  if (!net) return;
  updateLevelButtons();
  updateModeButtons();
  const room = net.room,
    host = room.host === net.id;
  $('lobbyCode').textContent = room.code;
  $('lobbyHelp').textContent = 'Mesmo código, mesmo labirinto. PC e celular podem jogar juntos.';
  $('roster').replaceChildren(
    ...room.players.map(p => {
      const row = document.createElement('div');
      row.className = 'roster-row';
      const avatar = document.createElement('canvas');
      avatar.width = 60;
      avatar.height = 90;
      drawExplorer(avatar.getContext('2d'), 5, 0, 50, 90, p.color);
      const name = document.createElement('strong');
      name.textContent = p.name + (p.id === net.id ? ' (você)' : '');
      const badge = document.createElement('small');
      badge.textContent = !p.alive ? 'CAPTURADO' : p.id === room.host ? 'ANFITRIÃO' : 'PRONTO';
      row.append(avatar, name, badge);
      return row;
    }),
  );
  $('lobbyStatus').textContent = !net.connected
    ? 'Conexão interrompida. Tentando reconectar…'
    : room.status === 'playing'
      ? 'A expedição está em andamento.'
      : room.status === 'won'
        ? 'A equipe venceu! O anfitrião pode iniciar outra partida.'
        : room.status === 'lost'
          ? 'O anfitrião pode iniciar uma nova tentativa.'
          : room.players.length +
            ' / 4 jogadores · ' +
            (host ? 'Inicie quando todos estiverem aqui.' : 'Aguardando o anfitrião iniciar.');
  $('launch').textContent =
    room.status === 'playing'
      ? net.dead
        ? 'AGUARDE SUA EQUIPE'
        : 'VOLTAR AO JOGO'
      : room.status === 'lobby'
        ? 'INICIAR EXPEDIÇÃO'
        : 'JOGAR NOVAMENTE';
  const advancing =
    room.campaign && room.status === 'won' && !!PHASE_ORDER[PHASE_ORDER.indexOf(room.level) + 1];
  if (advancing) {
    $('launch').textContent = 'AVANÇANDO PARA A PRÓXIMA FASE…';
    $('lobbyStatus').textContent = 'Fase concluída. A equipe avança automaticamente.';
  }
  $('launch').disabled =
    advancing || !net.connected || (room.status === 'playing' ? net.dead : !host);
}
function resumeOnline() {
  void enterLandscape();
  if (!net) return;
  if (net.room.status !== 'playing' || net.dead) {
    showLobby();
    return;
  }
  game.state = 'playing';
  document.body.classList.add('playing');
  syncGameMusic();
  initAudio();
  lock();
}
async function launchRoom() {
  void enterLandscape();
  if (!net) return;
  if (net.room.status === 'playing') {
    resumeOnline();
    return;
  }
  $('launch').disabled = true;
  try {
    const session = net;
    const data = await requestRoom('start', roomPayload());
    if (net !== session) return;
    applySnapshot(data);
    resumeOnline();
  } catch (e) {
    $('lobbyStatus').textContent = e.message;
  } finally {
    if (net) renderLobby();
  }
}
async function leaveRoom(send = true) {
  closeChat(false);
  const old = net;
  net = null;
  renderChat();
  clearTimeout(pollTimer);
  remotePlayers = [];
  remoteTargets = [];
  game.keys = {};
  game.state = 'ready';
  document.body.classList.remove('playing');
  document.exitPointerLock?.();
  $('onlineHud').hidden = true;
  showPanel('home');
  $('notice').textContent = '';
  $('rescueMessage').textContent = '';
  $('homeError').textContent = '';
  reset(93451);
  syncMenuMusic();
  syncGameMusic();
  if (send && old)
    requestRoom('leave', { code: old.code, id: old.id, token: old.token }).catch(() => {});
}
function resetMovementTrail(ordinal = 0) {
  movementTrail = [];
  movementOrdinal = ordinal;
  movementSentOrdinal = ordinal;
  movementAnchor = { x: game.player.x, y: game.player.y };
  movementWaiting = false;
}
function recordMovement() {
  if (!net || game.state !== 'playing' || net.dead) return;
  const last = movementTrail.at(-1),
    x = Math.round(game.player.x * 1000) / 1000,
    y = Math.round(game.player.y * 1000) / 1000;
  const px = last ? last[1] : movementAnchor.x,
    py = last ? last[2] : movementAnchor.y;
  if (Math.hypot(x - px, y - py) <= 0.001) return;
  const previous = movementTrail.at(-2),
    ax = previous ? previous[1] : movementAnchor.x,
    ay = previous ? previous[2] : movementAnchor.y;
  // Only collapse exact straight segments; corners and already-sent samples
  // must survive retries. Short segments also bound each transmitted step.
  if (
    last &&
    last[0] > movementSentOrdinal &&
    Math.abs((px - ax) * (y - ay) - (py - ay) * (x - ax)) < 1e-9 &&
    (px - ax) * (x - px) + (py - ay) * (y - py) >= 0 &&
    Math.hypot(x - ax, y - ay) <= 0.2
  ) {
    last[1] = x;
    last[2] = y;
  } else movementTrail.push([++movementOrdinal, x, y]);
}

function setupNet() {
  $('createRoom').onclick = () => connectRoom('create');
  $('joinRoom').onclick = () => connectRoom('join');
  $('launch').onclick = launchRoom;
  $('leaveLobby').onclick = () => leaveRoom();
  $('backMenu').onclick = () =>
    builder.custom ? (builder.testing ? returnToBuilder() : openWorkshop('gallery')) : leaveRoom();
  $('solo').onclick = () => {
    try {
      nameInput();
      game.selectedLevel = PHASE_ORDER[0];
      game.state = 'ready';
      showPanel('pause');
      start();
    } catch (e) {
      $('homeError').textContent = e.message;
    }
  };
  $('copyCode').onclick = async () => {
    if (!net) return;
    const invitation = location.origin + '/?sala=' + net.code;
    try {
      await navigator.clipboard.writeText(invitation);
      $('copyCode').textContent = 'CONVITE COPIADO';
      setTimeout(() => ($('copyCode').textContent = 'COPIAR CONVITE'), 2000);
    } catch {
      $('lobbyStatus').textContent = 'Envie este código aos amigos: ' + net.code;
    }
  };
  $('roomCode').addEventListener('keydown', e => {
    if (e.key === 'Enter') connectRoom('join');
  });
}

export {
  applySnapshot,
  interpolateRemote,
  isAdmin,
  leaveRoom,
  nameInput,
  net,
  recordMovement,
  remotePlayers,
  requestRoom,
  resetMovementTrail,
  resumeOnline,
  roomPayload,
  setupNet,
  showLobby,
  showPanel,
};

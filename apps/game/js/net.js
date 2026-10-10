// Multiplayer: salas, WebSocket com predição/interpolação e lobby.
import { PHASE_ORDER } from '@backrooms/shared/world.js';
import { initAudio, syncGameMusic, syncMenuMusic, tone } from './audio.js';
import { builder, openWorkshop, returnToBuilder } from './builder.js';
import { closeChat, renderChat } from './chat.js';
import { $ } from './dom.js';
import { finish, lock, phaseIntro, reset, resetMotion, say, start, updateHud } from './engine.js';
import { enterLandscape } from './fullscreen.js';
import { focusPad, padActive } from './gamepad.js';
import { LEVEL_INFO } from './levels.js';
import { enterExplorer, missionSet, recordMissionWin } from './missions.js';
import { selectedMode, updateLevelButtons, updateModeButtons } from './modes.js';
import { drawExplorer } from './render.js';
import { updateRescueUI } from './revive.js';
import { INPUT_INTERVAL_MS, PredictionHistory, SnapshotBuffer, reconnectDelay } from './netsync.js';
import { game } from './state.js';

const REQUEST_TIMEOUT_MS = 8000,
  HEARTBEAT_MS = 1000,
  PING_MS = 5000;

const history = new PredictionHistory(),
  remoteBuffer = new SnapshotBuffer();
const pending = new Map();
let net = null,
  remotePlayers = [],
  netSeq = 0,
  socket = null,
  inputTimer = null,
  reconnectTimer = null,
  reconnectAttempt = 0,
  lastBeat = 0,
  lastPing = 0,
  lastRtt,
  requestId = 0,
  sceneRound = -1;
function showPanel(which) {
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
    enterRoom(data);
  } catch (e) {
    $('homeError').textContent = e.message;
  } finally {
    busyHome(false);
  }
}
function enterRoom(data) {
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
  remoteBuffer.clear();
  applySnapshot(data, true);
  if (data.room.status === 'lobby') showLobby();
  openSocket();
}
// Chegada pelo portal do lobby 3D: /#travel={code,id,token,name} entra direto na partida.
async function resumeTravel() {
  const raw = new URLSearchParams((location.hash || '').slice(1)).get('travel');
  if (!raw) return;
  window.history.replaceState(null, '', location.pathname + location.search);
  let travel;
  try {
    travel = JSON.parse(raw);
  } catch {
    return;
  }
  $('nickname').value = travel.name || '';
  busyHome(true);
  try {
    // Mesmo login de missões da tela "Quem vai explorar?", sem pedir o nome de novo.
    await enterExplorer();
    const data = await requestRoom('resume', {
      code: travel.code,
      id: travel.id,
      token: travel.token,
    });
    enterRoom(data);
  } catch (e) {
    $('homeError').textContent = e.message;
  } finally {
    busyHome(false);
  }
}
// Protocolo do RoomDO: {action, reqId, ...corpo} -> {type:'result'|'error', reqId, ...}; o servidor
// também empurra {type:'room', room} (sala inteira) a cada mudança e a 20 Hz durante a partida.
function roomPayload() {
  return {
    id: net.id,
    token: net.token,
    round: net.room.round,
    seq: ++netSeq,
    x: game.player.x,
    y: game.player.y,
    a: game.player.a,
    respawns: net.respawns || 0,
    ...(lastRtt === undefined ? {} : { rtt: lastRtt }),
  };
}
function roomAction(action, payload = roomPayload()) {
  return new Promise((resolve, reject) => {
    if (socket?.readyState !== 1) return reject(Error('Sem conexão com a sala. Reconectando…'));
    const reqId = ++requestId,
      timer = setTimeout(() => {
        pending.delete(reqId);
        reject(Error('A conexão demorou demais. Confira a internet e tente novamente.'));
      }, REQUEST_TIMEOUT_MS);
    pending.set(reqId, { resolve, reject, timer, sent: performance.now() });
    socket.send(JSON.stringify({ ...payload, action, reqId }));
  });
}
function failPending(error) {
  for (const { reject, timer } of pending.values()) {
    clearTimeout(timer);
    reject(error);
  }
  pending.clear();
}
function sendInput() {
  if (!net || socket?.readyState !== 1 || !net.joined) return;
  const now = performance.now(),
    live = game.state === 'playing' && net.room.status === 'playing' && !net.dead;
  // Parado, só um batimento por segundo mantém o jogador ativo na sala.
  if (!live && now - lastBeat < HEARTBEAT_MS) return;
  lastBeat = now;
  // A cada 5 s o sync vai com reqId: a resposta mede o RTT, que segue nos próximos syncs (telemetria).
  if (now - lastPing >= PING_MS) {
    lastPing = now;
    void roomAction('sync').catch(() => {});
  } else socket.send(JSON.stringify({ ...roomPayload(), action: 'sync' }));
}
function openSocket() {
  clearTimeout(reconnectTimer);
  if (!net) return;
  const session = net,
    scheme = location.protocol === 'http:' ? 'ws:' : 'wss:',
    ws = new WebSocket(scheme + '//' + location.host + '/api/rooms/' + net.code + '/ws');
  socket = ws;
  session.joined = false;
  ws.onmessage = event => {
    if (net === session && socket === ws) handleServerMessage(event.data);
  };
  ws.onclose = () => {
    if (net === session && socket === ws) lostConnection();
  };
  ws.onerror = () => {};
  clearInterval(inputTimer);
  inputTimer = setInterval(sendInput, INPUT_INTERVAL_MS);
}
function lostConnection() {
  socket = null;
  net.connected = false;
  net.joined = false;
  game.keys = {};
  failPending(Error('Conexão perdida. Tentando reconectar…'));
  const wait = reconnectDelay(reconnectAttempt++);
  $('connection').textContent = 'RECONECTANDO…';
  $('lobbyStatus').textContent = 'Conexão interrompida. Tentando reconectar…';
  say('Conexão perdida. Reconectando em ' + wait / 1000 + 's…');
  if (!$('lobbyPanel').hidden) renderLobby();
  reconnectTimer = setTimeout(openSocket, wait);
}
function closeSocket() {
  clearTimeout(reconnectTimer);
  clearInterval(inputTimer);
  failPending(Error('Você saiu da sala.'));
  const old = socket;
  socket = null;
  reconnectAttempt = 0;
  try {
    old?.close(1000);
  } catch {}
}
function handleServerMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  if (msg.type === 'room') {
    // A primeira sala de cada conexão confirma a (re)entrada; é também o estado completo.
    reconnectAttempt = 0;
    net.joined = true;
    applySnapshot({ room: msg.room });
    pushRemote(msg.room.players);
  } else if (msg.type === 'result' || msg.type === 'error') {
    const request = pending.get(msg.reqId);
    if (request) {
      pending.delete(msg.reqId);
      clearTimeout(request.timer);
      lastRtt = Math.round(performance.now() - request.sent);
      if (msg.type === 'result') request.resolve(msg);
      else request.reject(Object.assign(Error(msg.error), { status: msg.status }));
    }
    if (msg.type === 'error' && (msg.status === 401 || msg.status === 404)) {
      const message = msg.error;
      void leaveRoom(false).then(() => ($('homeError').textContent = message));
    } else if (msg.type === 'error' && !request) say(msg.error);
  }
}
function pushRemote(players) {
  remoteBuffer.push(
    performance.now(),
    players.filter(p => p.id !== net.id),
  );
}
function applySnapshot(data, initial = false) {
  const room = data.room;
  if (!net) return;
  if (!initial && room.revision < net.room.revision) return;
  const previousCount = game.fuses.filter(f => f.taken).length;
  net.room = room;
  net.connected = true;
  renderChat();
  $('connection').textContent = 'EQUIPE CONECTADA';
  $('roomBadge').textContent = 'SALA ' + room.code;
  $('onlineHud').hidden = false;
  if (sceneRound !== room.round || initial) {
    reset(room.seed, room.level || 'backrooms', room.mode || 'normal');
    sceneRound = room.round;
    net.dead = false;
    const mine = room.players.find(p => p.id === net.id);
    if (mine) {
      game.player.x = mine.x;
      game.player.y = mine.y;
      game.player.a = mine.a;
      history.clear();
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
  const me = room.players.find(p => p.id === net.id);
  if (me && game.state === 'playing' && me.alive && !net.dead && history.diverged(me.x, me.y)) {
    game.player.x = me.x;
    game.player.y = me.y;
    history.clear();
  }
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
  remotePlayers = room.players
    .filter(p => p.id !== net.id)
    .map(p => {
      const old = remotePlayers.find(v => v.id === p.id);
      return { ...p, x: old?.x ?? p.x, y: old?.y ?? p.y, a: old?.a ?? p.a };
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
    history.clear();
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
function updateRemotePlayers(now) {
  for (const p of remotePlayers) {
    const at = remoteBuffer.sample(p.id, now);
    if (at) Object.assign(p, at);
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
    const session = net,
      data = await roomAction('start');
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
  if (send && net) {
    try {
      await roomAction('leave');
    } catch {}
  }
  net = null;
  renderChat();
  closeSocket();
  remotePlayers = [];
  remoteBuffer.clear();
  history.clear();
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
}
function recordPrediction() {
  if (!net || game.state !== 'playing' || net.dead) return;
  history.record(performance.now(), game.player.x, game.player.y);
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
  void resumeTravel();
}

export {
  applySnapshot,
  leaveRoom,
  nameInput,
  net,
  recordPrediction,
  remotePlayers,
  requestRoom,
  resumeOnline,
  roomAction,
  roomPayload,
  setupNet,
  showLobby,
  showPanel,
  updateRemotePlayers,
};

// Expedição em 3D: a mesma sala (RoomDO) do jogo clássico, desenhada em primeira pessoa.
// Chega pelo portal do lobby com #travel={code,id,token,name}; no fim, volta ao lobby.
import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { FIRE, traceShot } from '@backrooms/shared/combat.js';
import { ITEMS, SALVAGE_MS, SALVAGE_REACH, countItem } from '@backrooms/shared/loot.js';
import { createWorld } from '@backrooms/shared/world.js';
import { Avatar } from '../lobby/avatar.js';
import { createHum } from '../lobby/hum.js';
import { setupLandscape } from '../lobby/landscape.js';
import { RemoteBuffer } from '../lobby/net.js';
import { bindQualitySelect, createPipeline } from '../lobby/quality.js';
import { createStats } from '../lobby/stats.js';
import { createEffects, createSfx } from './effects.js';
import { S, buildLevel } from './level.js';

const $ = id => document.getElementById(id);
const WALK = 1.85, // células/s, como no jogo clássico
  RUN = 3.1,
  RADIUS = 0.2,
  EYE = 1.6,
  SEND_MS = 1000 / 30,
  IDLE_SEND_MS = 1000,
  CORRECTION = 0.5,
  RETURN_MS = 8000,
  RETURN_KEY = 'backrooms.lobbyReturn';

// --- Renderização ---
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
$('view').append(renderer.domElement);
const labels = new CSS2DRenderer();
Object.assign(labels.domElement.style, {
  position: 'fixed',
  inset: '0',
  pointerEvents: 'none',
  zIndex: '1',
});
document.body.append(labels.domElement);
const scene = new THREE.Scene(),
  camera = new THREE.PerspectiveCamera(70, 1, 0.05, 60);
camera.rotation.order = 'YXZ';
scene.add(camera);
const lantern = new THREE.SpotLight(0xfff4d8, 18, 16, 0.5, 0.45, 1.4);
lantern.position.set(0.15, -0.15, 0);
lantern.target.position.set(0, 0, -1);
camera.add(lantern, lantern.target);
// Braço-Arma em primeira pessoa: manga, antebraço e o canhão que brilha ao carregar.
const arm = new THREE.Group(),
  cannonGlow = new THREE.MeshBasicMaterial({ color: 0xff8a2a });
arm.add(
  new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.06, 0.28),
    new THREE.MeshLambertMaterial({ color: 0x6d737b }),
  ),
);
const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.085, 0.08), cannonGlow);
muzzle.position.z = -0.17;
arm.add(muzzle);
arm.position.set(0.2, -0.17, -0.45);
camera.add(arm);
const effects = createEffects(scene),
  sfx = createSfx(),
  seenEffects = new Set();
const ICONS = { scrap: '🔩', almond: '💧', core_fire: '🔥' };
let myBag = [],
  salvage = null; // { pile, start } enquanto segura E
let chargeStart = 0,
  recoil = 0,
  shake = 0,
  lastShot = 0;
const pipeline = createPipeline(renderer, scene, camera),
  hum = createHum();
bindQualitySelect($('quality'), pipeline);
const stats = createStats(renderer, pipeline);
function resize() {
  pipeline.resize();
  labels.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// --- Estado ---
const keys = new Set(),
  buffer = new RemoteBuffer(),
  remotes = new Map(),
  me = { x: 1.5, y: 1.5, a: 0, pitch: 0, stamina: 100, respawns: 0, alive: true };
let ticket = null,
  room = null,
  world = null,
  level = null,
  ws = null,
  seq = 0,
  reqId = 0,
  lastSend = 0,
  lastSent = '',
  ended = false,
  stick = { x: 0, y: 0 },
  touchRun = false;

function payload() {
  return {
    id: ticket.id,
    token: ticket.token,
    round: room.round,
    seq: ++seq,
    x: me.x,
    y: me.y,
    a: me.a,
    respawns: me.respawns,
  };
}
function send(action, extra = {}) {
  if (ws?.readyState === 1)
    ws.send(JSON.stringify({ ...payload(), ...extra, action, reqId: ++reqId }));
}

let noticeTimer = 0;
function notice(text) {
  $('notice').textContent = text;
  $('notice').classList.add('show');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => $('notice').classList.remove('show'), 3000);
}

// --- Entrada na sala ---
async function start() {
  const raw = new URLSearchParams(location.hash.slice(1)).get('travel');
  try {
    ticket = JSON.parse(raw);
    if (!ticket?.code || !ticket.id || !ticket.token) throw Error();
  } catch {
    return fail('Entre na expedição pelo portal do lobby.');
  }
  // Sem o bilhete na URL, recarregar a página não reaproveita a credencial.
  history.replaceState(null, '', location.pathname);
  try {
    const response = await fetch('/api/rooms/resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: ticket.code, id: ticket.id, token: ticket.token }),
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'A expedição não respondeu.');
    applyRoom(data.room, true);
    world = createWorld(room.seed, room.level);
    level = buildLevel(scene, world);
    // O servidor nasce todo mundo com ângulo 0; vira para o primeiro corredor aberto.
    const cell = (dx, dy) => world.grid[Math.floor(me.y) + dy]?.[Math.floor(me.x) + dx] === 0;
    me.a =
      [0, Math.PI / 2, Math.PI, -Math.PI / 2].find(a =>
        cell(Math.round(Math.cos(a)), Math.round(Math.sin(a))),
      ) ?? 0;
    pipeline.warm();
    connect();
    $('loading').hidden = true;
    $('hud').hidden = false;
  } catch (e) {
    fail(e.message);
  }
}
function fail(message) {
  $('loadingError').textContent = message;
  $('loadingBack').hidden = false;
}

function connect() {
  const scheme = location.protocol === 'http:' ? 'ws:' : 'wss:';
  ws = new WebSocket(`${scheme}//${location.host}/api/rooms/${ticket.code}/ws`);
  ws.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'room') applyRoom(msg.room);
    else if (msg.type === 'result' && msg.room) applyRoom(msg.room);
    else if (msg.type === 'error' && msg.error) notice(msg.error);
  };
  ws.onclose = () => {
    if (!ended) setTimeout(connect, 1500);
  };
}

function applyRoom(next, first = false) {
  room = next;
  const self = room.players.find(p => p.id === ticket.id);
  if (self) {
    // Reviveu (o servidor conta os renascimentos): volta para o início.
    if (first || self.respawns !== me.respawns) {
      me.x = self.x;
      me.y = self.y;
      me.respawns = self.respawns;
    } else if (Math.hypot(self.x - me.x, self.y - me.y) > CORRECTION) {
      me.x = self.x;
      me.y = self.y;
    }
    me.alive = self.alive;
    // Avisa o que entrou na mochila desde o último estado.
    if (!first)
      for (const item of Object.keys(ITEMS)) {
        const diff = countItem(self.bag || [], item) - countItem(myBag, item);
        if (diff > 0) notice(`+${diff} ${ITEMS[item].name}`);
      }
    myBag = self.bag || [];
    me.carrying = self.carrying || 0;
  }
  buffer.push(
    performance.now(),
    room.players
      .filter(p => p.id !== ticket.id)
      .map(p => ({
        id: p.id,
        x: p.x * S,
        z: p.y * S,
        yaw: Math.PI / 2 - p.a,
        anim: p.alive ? 'walk' : 'down',
      })),
  );
  syncRemotes();
  renderHud();
  renderChat();
  // Tiros dos colegas (os meus já foram desenhados na hora do clique).
  for (const e of room.effects || []) {
    if (seenEffects.has(e.id)) continue;
    seenEffects.add(e.id);
    if (e.by === ticket.id || !level) continue;
    effects.fire(
      new THREE.Vector3(e.from.x * S, 1.3, e.from.y * S),
      new THREE.Vector3(e.to.x * S, 1.3, e.to.y * S),
      e.kind === 'charged',
    );
    sfx.shot(e.kind === 'charged');
  }
  if (seenEffects.size > 200) seenEffects.clear();
  if ((room.status === 'won' || room.status === 'lost') && !ended) finish(room.status === 'won');
}

function syncRemotes() {
  const seen = new Set();
  for (const p of room.players) {
    if (p.id === ticket.id) continue;
    seen.add(p.id);
    if (!remotes.has(p.id)) {
      const avatar = new Avatar({ name: p.name, color: p.color, skin: p.skin || 'a' });
      void avatar.ready.then(() => pipeline.warm({ passes: false }));
      remotes.set(p.id, avatar);
      scene.add(avatar.root);
    }
  }
  for (const [id, avatar] of remotes)
    if (!seen.has(id)) {
      avatar.dispose();
      remotes.delete(id);
    }
}

function renderHud() {
  const got = room.fuses.filter(Boolean).length;
  $('fuseCount').textContent = `${got} / ${room.fuses.length}`;
  $('coins').textContent = room.balance;
  $('team').innerHTML = '';
  for (const p of room.players) {
    const line = document.createElement('div');
    line.textContent =
      (p.id === ticket.id ? `${p.name} (você)` : p.name) + (p.alive ? '' : ' · pego');
    line.style.color = p.color;
    line.classList.toggle('out', !p.alive);
    $('team').append(line);
  }
  $('down').hidden = me.alive || ended;
  const slots = [];
  for (let i = 0; i < 12; i++) {
    const slot = myBag[i];
    slots.push(
      `<div class="slot" title="${slot ? ITEMS[slot.item].name : ''}">${slot ? `${ICONS[slot.item]}<b>${slot.qty}</b>` : ''}</div>`,
    );
  }
  if (me.carrying)
    slots.push(`<div class="carrying">carregando ${me.carrying} mochila(s) de colegas</div>`);
  const html = slots.join('');
  if (html !== $('bag').dataset.html) $('bag').innerHTML = $('bag').dataset.html = html;
}

function finish(won) {
  ended = true;
  send('sync');
  const seconds = Math.round(((room.finished || room.now) - room.started) / 1000);
  $('endTitle').textContent = won ? 'A equipe encontrou a saída!' : 'A expedição chegou ao fim.';
  $('endSummary').textContent =
    `Tempo ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} · ` +
    `fusíveis ${room.fuses.filter(Boolean).length}/${room.fuses.length} · ` +
    `quedas ${room.players.filter(p => !p.alive).length} · voltando ao lobby…`;
  const mine = room.extracted?.[ticket.id] || {},
    loot = Object.entries(mine)
      .map(([item, qty]) => `${qty} ${ITEMS[item].name}`)
      .join(', ');
  $('endLoot').textContent = won
    ? loot
      ? `Você levou: ${loot}. Guardado no seu estoque.`
      : 'Você não trouxe nada desta vez.'
    : 'A mochila ficou para trás.';
  $('end').hidden = false;
  $('down').hidden = true;
  setTimeout(backToLobby, RETURN_MS);
}
function backToLobby() {
  ws?.close();
  let target = '/lobby/';
  try {
    if (sessionStorage.getItem(RETURN_KEY)) target += '#return';
  } catch {}
  location.href = target;
}
$('backLobby').onclick = backToLobby;

// --- Braço de Fogo: clique (ou espaço) atira; segurar 1,2 s carrega o tiro ---
function startCharge() {
  if (!chargeStart && me.alive && !ended) chargeStart = performance.now();
}
function releaseShot() {
  if (!chargeStart) return;
  const held = performance.now() - chargeStart,
    wantsCharged = held >= FIRE.charged.chargeMs,
    // Sem Amêndoa na mochila, o tiro carregado vira um tiro normal.
    kind = wantsCharged && countItem(myBag, 'almond') ? 'charged' : 'primary';
  if (wantsCharged && kind === 'primary') notice('Sem Amêndoa para o tiro carregado.');
  chargeStart = 0;
  const now = performance.now();
  if (!room || !me.alive || ended || now - lastShot < FIRE[kind].cooldownMs) return;
  lastShot = now;
  send('shoot', { kind });
  // Desenha na hora com o mesmo traçado do servidor (o dano chega no próximo estado da sala).
  const enemy = room.enemy.dead ? null : room.enemy,
    shot = traceShot(world.grid, me, me.a, enemy, kind),
    from = new THREE.Vector3();
  muzzle.getWorldPosition(from);
  effects.fire(from, new THREE.Vector3(shot.end.x * S, 1.3, shot.end.y * S), kind === 'charged');
  sfx.shot(kind === 'charged');
  recoil = kind === 'charged' ? 1 : 0.5;
  if (kind === 'charged') {
    shake = 0.35;
    if (shot.hit) setTimeout(() => sfx.boom(), 150);
  }
}

// --- Sucata: segurar E perto de um monte por 2 s ---
function nearestPile() {
  let best = null;
  for (const pile of room?.loot?.piles || []) {
    const d = Math.hypot(pile.x - me.x, pile.y - me.y);
    if (d <= SALVAGE_REACH && (!best || d < best.d)) best = { id: pile.id, d };
  }
  return best?.id ?? null;
}
function startSalvage() {
  const pile = nearestPile();
  if (pile === null || salvage || !me.alive || ended) return;
  salvage = { pile, start: performance.now() };
  send('salvageStart', { pile });
}
function stopSalvage() {
  salvage = null;
}
function stepSalvage(now) {
  const pile = nearestPile();
  if (salvage && (pile !== salvage.pile || !me.alive)) salvage = null;
  if (salvage && now - salvage.start >= SALVAGE_MS) {
    send('salvage', { pile: salvage.pile });
    salvage = null;
  }
  $('prompt').hidden = pile === null || ended;
  if (pile !== null) {
    const progress = salvage ? Math.min(1, (now - salvage.start) / SALVAGE_MS) : 0;
    $('prompt').innerHTML =
      `Segure <b>E</b> para desmontar a sucata<div class="bar" style="width:${progress * 100}%"></div>`;
  }
}

// --- Entrada: teclado, botão direito/arrastar gira, joystick no celular ---
addEventListener('keydown', e => {
  if (e.key === 'Enter' && room && !ended) return openChat();
  if (e.code === 'Space' && !e.repeat) startCharge();
  if (e.code === 'KeyE' && !e.repeat) startSalvage();
  keys.add(e.code);
  if (e.code === 'KeyF') lantern.visible = !lantern.visible;
  if (e.code === 'KeyV') send('revive');
});
addEventListener('keyup', e => {
  if (e.code === 'Space') releaseShot();
  if (e.code === 'KeyE') stopSalvage();
  keys.delete(e.code);
});
addEventListener('blur', () => keys.clear());
const canvas = renderer.domElement,
  drags = new Map();
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse' && e.button === 0) {
    startCharge();
    return;
  }
  if (e.pointerType === 'mouse' && e.button !== 2) return;
  drags.set(e.pointerId, { x: e.clientX, y: e.clientY });
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  const d = drags.get(e.pointerId);
  if (!d) return;
  me.a += (e.clientX - d.x) * 0.005;
  me.pitch = Math.max(-1.1, Math.min(1.1, me.pitch - (e.clientY - d.y) * 0.004));
  d.x = e.clientX;
  d.y = e.clientY;
});
const release = e => {
  if (e.pointerType === 'mouse' && e.button === 0) releaseShot();
  drags.delete(e.pointerId);
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
const stickEl = $('stick'),
  knob = $('knob');
stickEl.addEventListener('pointerdown', e => {
  e.stopPropagation();
  stickEl.setPointerCapture(e.pointerId);
});
stickEl.addEventListener('pointermove', e => {
  if (!stickEl.hasPointerCapture(e.pointerId)) return;
  const r = stickEl.getBoundingClientRect(),
    x = (e.clientX - r.left - r.width / 2) / (r.width / 2),
    y = (e.clientY - r.top - r.height / 2) / (r.height / 2),
    len = Math.max(1, Math.hypot(x, y));
  stick = { x: x / len, y: y / len };
  knob.style.transform = `translate(${stick.x * 35}px, ${stick.y * 35}px)`;
});
for (const type of ['pointerup', 'pointercancel'])
  stickEl.addEventListener(type, () => {
    stick = { x: 0, y: 0 };
    knob.style.transform = '';
  });
// Barra de ações: tocar/clicar faz o mesmo que a tecla; atirar e desmontar respeitam o segurar.
const holdActions = {
  fire: [startCharge, releaseShot],
  use: [startSalvage, stopSalvage],
};
const ACTIONS = {
  run: b => b.classList.toggle('on', (touchRun = !touchRun)),
  light: () => (lantern.visible = !lantern.visible),
  revive: () => send('revive'),
  chat: () => openChat(),
};
for (const b of document.querySelectorAll('#actions button')) {
  const hold = holdActions[b.dataset.action];
  if (hold) {
    b.addEventListener('pointerdown', e => {
      e.stopPropagation();
      hold[0]();
    });
    b.addEventListener('pointerup', hold[1]);
    b.addEventListener('pointercancel', hold[1]);
    b.addEventListener('pointerleave', hold[1]);
  } else
    b.onclick = e => {
      e.currentTarget.blur();
      ACTIONS[b.dataset.action]?.(b);
    };
}

// --- Chat da equipe (mensagens da sala) ---
function openChat() {
  $('chatInput').hidden = false;
  $('chatInput').focus();
  keys.clear();
}
$('chatInput').addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Enter') {
    const text = $('chatInput').value.trim();
    if (text) send('chat', { text, messageId: crypto.randomUUID() });
    $('chatInput').value = '';
  }
  if (e.key === 'Enter' || e.key === 'Escape') {
    $('chatInput').hidden = true;
    $('chatInput').blur();
  }
});
$('chatInput').addEventListener('keyup', e => e.stopPropagation());
const seenMessages = new Set();
function renderChat() {
  const messages = (room.messages || []).slice(-8);
  for (const m of messages) {
    if (seenMessages.has(m.id)) continue;
    seenMessages.add(m.id);
    if (m.sender !== ticket.id) remotes.get(m.sender)?.say(m.text, performance.now());
  }
  $('chatLog').replaceChildren(
    ...messages.map(m => {
      const li = document.createElement('li'),
        who = document.createElement('b');
      who.textContent = m.name + ': ';
      who.style.color = m.color;
      li.append(who, document.createTextNode(m.text));
      return li;
    }),
  );
}

// --- Simulação local (o servidor confere velocidade e paredes) ---
const open = (x, y) => world.grid[Math.floor(y)]?.[Math.floor(x)] === 0;
const free = (x, y) =>
  open(x - RADIUS, y - RADIUS) &&
  open(x + RADIUS, y - RADIUS) &&
  open(x - RADIUS, y + RADIUS) &&
  open(x + RADIUS, y + RADIUS);
function stepSelf(dt, now) {
  const turn = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0);
  me.a += turn * dt * 2.4;
  const fwd =
      (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) -
      (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) -
      stick.y,
    side = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0) + stick.x,
    len = Math.min(1, Math.hypot(fwd, side)),
    moving = me.alive && !ended && len > 0.05,
    run = moving && (keys.has('ShiftLeft') || keys.has('ShiftRight') || touchRun) && me.stamina > 1,
    speed = moving ? (run ? RUN : WALK) * len : 0;
  me.stamina = Math.max(0, Math.min(100, me.stamina + dt * (run ? -24 : 15)));
  if (speed) {
    const norm = Math.hypot(fwd, side),
      dx = (Math.cos(me.a) * fwd - Math.sin(me.a) * side) / norm,
      dy = (Math.sin(me.a) * fwd + Math.cos(me.a) * side) / norm,
      nx = me.x + dx * speed * dt,
      ny = me.y + dy * speed * dt;
    if (free(nx, me.y)) me.x = nx;
    if (free(me.x, ny)) me.y = ny;
  }
  // 30 Hz andando; 1 Hz parado, para o servidor saber que a equipe continua ali.
  const state = `${me.x.toFixed(2)}|${me.y.toFixed(2)}|${me.a.toFixed(2)}`;
  if (!ended && now - lastSend >= (state !== lastSent ? SEND_MS : IDLE_SEND_MS)) {
    lastSend = now;
    lastSent = state;
    if (ws?.readyState === 1) ws.send(JSON.stringify({ ...payload(), action: 'sync' }));
  }
  $('staminaFill').style.width = me.stamina + '%';
  camera.position.set(me.x * S, EYE + (speed ? Math.abs(Math.sin(now / 160)) * 0.04 : 0), me.y * S);
  camera.rotation.set(me.pitch, -me.a - Math.PI / 2, 0);
  if (shake > 0) {
    camera.rotation.x += (Math.random() - 0.5) * shake * 0.1;
    camera.rotation.y += (Math.random() - 0.5) * shake * 0.1;
    shake = Math.max(0, shake - dt * 1.5);
  }
  // Coice do braço e brilho/mira crescendo enquanto carrega.
  recoil = Math.max(0, recoil - dt * 6);
  arm.position.z = -0.45 + recoil * 0.06;
  const charge = chargeStart ? Math.min(1, (now - chargeStart) / FIRE.charged.chargeMs) : 0;
  cannonGlow.color.setRGB(1, 0.54 - charge * 0.35, 0.16 - charge * 0.16);
  muzzle.scale.setScalar(1 + charge * 0.35 + (charge === 1 ? Math.sin(now / 40) * 0.05 : 0));
  $('crosshair').style.transform = `scale(${1 + charge * 3})`;
  $('crosshair').classList.toggle('charged', charge === 1);
}

let last = performance.now();
let frameStart = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const frameMs = now - frameStart;
  frameStart = now;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (room && world) {
    stepSelf(dt, now);
    level.update(room, now / 1000);
    effects.update(dt);
    stepSalvage(now);
    level.moveEnemy(room.enemy, dt);
    // Zumbido mais forte embaixo das luminárias.
    hum.set(1 - Math.min(1, level.nearestLamp(me.x * S, me.y * S) / 5));
    for (const [id, avatar] of remotes) {
      const s = buffer.sample(id, now);
      if (!s) continue;
      avatar.root.position.set(s.x, 0, s.z);
      avatar.root.rotation.y = s.yaw;
      avatar.update(dt, { speed: s.anim === 'down' ? 0 : s.speed, anim: s.anim }, now);
    }
    const seconds = Math.max(0, Math.floor((Date.now() - room.started) / 1000));
    $('clock').textContent =
      `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
  stats.begin();
  pipeline.render(dt * 1000, now);
  labels.render(scene, camera);
  stats.end(frameMs, now);
}
requestAnimationFrame(frame);
setupLandscape();
void start();

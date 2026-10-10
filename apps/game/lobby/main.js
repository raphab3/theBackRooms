// Lobby 3D (Posto Zero): menu, jogador local, câmera em 3ª pessoa, outros jogadores e portais.
import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { LOBBY_BOUNDS, RUN_SPEED, SKINS } from '@backrooms/shared/lobby.js';
import { Avatar, preloadSkins } from './avatar.js';
import { RemoteBuffer, enterLobby, openLobbySocket } from './net.js';
import { createHum } from './hum.js';
import { enterLandscape, setupLandscape } from './landscape.js';
import { bindQualitySelect, createPipeline } from './quality.js';
import { createStats } from './stats.js';
import { PILLARS, PILLAR_RADIUS, animateLobby, buildLobby } from './scene.js';

const $ = id => document.getElementById(id);
const NAME_KEY = 'backrooms.explorerName',
  SKIN_KEY = 'backrooms.skin',
  RETURN_KEY = 'backrooms.lobbyReturn',
  WALK_SPEED = 3.6,
  GRAVITY = 16,
  JUMP_SPEED = 5.2,
  SEND_MS = 50, // 20 Hz
  IDLE_SEND_MS = 1000,
  CAMERA_DISTANCE = 5.2,
  EMOTE_KEYS = { Digit1: 'wave', Digit2: 'point', Digit3: 'dance' };

// --- Renderização ---
const view = $('view'),
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
view.append(renderer.domElement);
const labels = new CSS2DRenderer();
labels.domElement.style.position = 'fixed';
labels.domElement.style.inset = '0';
labels.domElement.style.pointerEvents = 'none';
labels.domElement.style.zIndex = '1';
document.body.append(labels.domElement);
const scene = new THREE.Scene(),
  camera = new THREE.PerspectiveCamera(60, 1, 0.1, 80),
  portals = buildLobby(scene),
  pipeline = createPipeline(renderer, scene, camera),
  hum = createHum();
bindQualitySelect($('quality'), pipeline);
pipeline.warm();
const stats = createStats(renderer, pipeline);
hum.set(0.5);
function resize() {
  pipeline.resize();
  labels.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// --- Estado ---
const buffer = new RemoteBuffer(),
  remotes = new Map(), // id → Avatar
  keys = new Set(),
  me = {
    id: null,
    x: 0,
    z: 9,
    yaw: Math.PI,
    y: 0,
    vy: 0,
    anim: 'idle',
    emote: null,
    emoteN: 0,
    emoteUntil: 0,
  };
let socket = null,
  self = null,
  lobbyLabel = '',
  serverOffset = 0,
  camYaw = 0,
  camPitch = 0.35,
  lastSend = 0,
  lastSent = '',
  stick = { x: 0, y: 0 },
  invitedBy = null,
  playersInLobby = 0;

// --- Menu ---
$('nickname').value = localStorage.getItem(NAME_KEY) || '';
let skin = SKINS.includes(localStorage.getItem(SKIN_KEY))
  ? localStorage.getItem(SKIN_KEY)
  : SKINS[Math.floor(Math.random() * SKINS.length)];
for (const s of SKINS) {
  const button = document.createElement('button'),
    img = document.createElement('img');
  img.src = `/models/characters/previews/character-${s}.png`;
  img.alt = 'Personagem ' + s.toUpperCase();
  button.append(img);
  button.classList.toggle('on', s === skin);
  button.onclick = () => {
    skin = s;
    localStorage.setItem(SKIN_KEY, s);
    for (const b of $('skins').children) b.classList.toggle('on', b === button);
  };
  $('skins').append(button);
}
function nameInput() {
  const name = $('nickname').value.trim();
  if (!name) {
    $('nickname').focus();
    throw Error('Escreva seu nome para entrar.');
  }
  localStorage.setItem(NAME_KEY, name);
  return name;
}
async function join(action) {
  void enterLandscape(); // o clique em "Entrar" é o gesto que o navegador exige
  $('menuError').textContent = '';
  try {
    const name = nameInput(),
      body = { name };
    if (action === 'join') {
      body.code = $('code').value.trim().toUpperCase();
      if (!/^[A-Z2-9]{6}$/.test(body.code)) throw Error('Digite o código de 6 caracteres.');
    }
    for (const b of document.querySelectorAll('#menu button')) b.disabled = true;
    const lobby = await enterLobby(action, body);
    await connectLobby(lobby.key, label(lobby), name);
  } catch (e) {
    $('menuError').textContent = e.message;
  } finally {
    for (const b of document.querySelectorAll('#menu button')) b.disabled = false;
  }
}
const label = lobby =>
  lobby.code
    ? `Lobby privado · código <b>${lobby.code}</b>`
    : `Lobby público · grupo ${lobby.key.split('-')[1]}`;
async function connectLobby(key, text, name) {
  await preloadSkins([skin]);
  lobbyLabel = text;
  // Guardado para voltar ao mesmo lobby depois da expedição.
  try {
    sessionStorage.setItem(RETURN_KEY, JSON.stringify({ key, text, name }));
  } catch {}
  socket = openLobbySocket(key, name, skin, onMessage, onClose);
}
// Volta da expedição (/lobby/#return): entra direto no mesmo lobby, sem passar pelo menu.
function returnToLobby() {
  if (location.hash !== '#return') return;
  history.replaceState(null, '', location.pathname);
  try {
    const saved = JSON.parse(sessionStorage.getItem(RETURN_KEY));
    if (saved?.key && saved.name) void connectLobby(saved.key, saved.text, saved.name);
  } catch {}
}
$('public').onclick = () => join('public');
$('private').onclick = () => join('private');
$('join').onclick = () => join('join');
$('code').addEventListener('keydown', e => e.key === 'Enter' && join('join'));

function onClose(event) {
  socket = null;
  for (const avatar of remotes.values()) avatar.dispose();
  remotes.clear();
  self?.dispose();
  self = null;
  $('hud').hidden = true;
  $('menu').hidden = false;
  $('menuError').textContent =
    event.reason && event.reason !== 'travel' ? event.reason : 'A conexão com o lobby caiu.';
}

// --- Mensagens do servidor ---
function onMessage(m) {
  if (m.t === 'welcome') {
    me.id = m.id;
    $('menu').hidden = true;
    $('hud').hidden = false;
  } else if (m.t === 'snap') {
    serverOffset = m.now - Date.now();
    buffer.push(performance.now(), m.players);
    playersInLobby = m.players.length;
    syncAvatars(m.players);
    m.portals.forEach((state, i) => portals[i].set(state, serverOffset));
    updateTeamSize(m.portals);
  } else if (m.t === 'correct') {
    me.x = m.x;
    me.z = m.z;
  } else if (m.t === 'chat') {
    addChat(m.name, m.color, m.text);
    (m.id === me.id ? self : remotes.get(m.id))?.say(m.text, performance.now());
  } else if (m.t === 'notice' || m.t === 'error') notice(m.text || m.error);
  else if (m.t === 'invited') {
    invitedBy = m.from;
    $('inviteText').textContent = `${m.name} te convidou para o grupo.`;
    $('invite').hidden = false;
  } else if (m.t === 'travel') travel(m);
}

function syncAvatars(players) {
  const seen = new Set();
  for (const p of players) {
    seen.add(p.id);
    if (p.id === me.id) {
      if (!self) {
        self = new Avatar({ name: p.name, color: p.color, skin: p.skin, self: true });
        void self.ready.then(() => pipeline.warm());
        scene.add(self.root);
        Object.assign(me, { x: p.x, z: p.z, yaw: p.yaw });
        camYaw = p.yaw + Math.PI;
      }
      self.setParty(!!p.party);
      continue;
    }
    let avatar = remotes.get(p.id);
    if (!avatar) {
      avatar = new Avatar({ name: p.name, color: p.color, skin: p.skin });
      avatar.id = p.id;
      remotes.set(p.id, avatar);
      scene.add(avatar.root);
    }
    avatar.setParty(!!p.party && p.party === players.find(v => v.id === me.id)?.party);
  }
  for (const [id, avatar] of remotes)
    if (!seen.has(id)) {
      avatar.dispose();
      remotes.delete(id);
    }
}

function travel(m) {
  $('hud').hidden = true;
  $('travel').hidden = false;
  socket?.close();
  socket = null;
  const ticket = { code: m.code, id: m.id, token: m.token, name: m.name };
  setTimeout(() => {
    location.href = '/expedicao/#travel=' + encodeURIComponent(JSON.stringify(ticket));
  }, 600);
}

// --- HUD ---
// Quem chegou primeiro na plataforma escolhe quantos esperar; quem só entrou vê a escolha.
let teamPortal = null;
function updateTeamSize(states) {
  const mine = states.find(p => p.slots.includes(me.id));
  teamPortal = mine?.owner === me.id ? mine.id : null;
  $('teamSize').hidden = !mine;
  if (!mine) return;
  $('teamSizeButtons').hidden = !teamPortal;
  $('teamSizeText').textContent = teamPortal
    ? 'Quantos no time?'
    : mine.target
      ? `Time de ${mine.target} escolhido`
      : 'Esperando o primeiro escolher o time…';
  for (const b of $('teamSizeButtons').children)
    b.classList.toggle('on', Number(b.dataset.n) === mine.target);
}
for (const b of $('teamSizeButtons').children)
  b.onclick = () =>
    teamPortal && socket?.send({ t: 'portalTarget', portal: teamPortal, n: Number(b.dataset.n) });

let noticeTimer = 0;
function notice(text) {
  $('notice').textContent = text;
  $('notice').classList.add('show');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => $('notice').classList.remove('show'), 3000);
}
function addChat(name, color, text) {
  const li = document.createElement('li'),
    who = document.createElement('b');
  who.textContent = name + ': ';
  who.style.color = color;
  li.append(who, document.createTextNode(text));
  $('chatLog').append(li);
  while ($('chatLog').children.length > 8) $('chatLog').firstChild.remove();
}
function openChat() {
  $('chatInput').hidden = false;
  $('chatInput').focus();
  keys.clear();
}
$('chatInput').addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Enter') {
    const text = $('chatInput').value.trim();
    if (text) socket?.send({ t: 'chat', text });
    $('chatInput').value = '';
  }
  if (e.key === 'Enter' || e.key === 'Escape') {
    $('chatInput').hidden = true;
    $('chatInput').blur();
  }
});
$('acceptInvite').onclick = () => {
  socket?.send({ t: 'accept', from: invitedBy });
  $('invite').hidden = true;
};
$('declineInvite').onclick = () => ($('invite').hidden = true);

// --- Entrada: teclado, mouse/toque para câmera, clique em jogador para convidar ---
function emote(e) {
  socket?.send({ t: 'emote', e });
  me.emote = e;
  me.emoteN++;
  me.emoteUntil = performance.now() + 3000;
}
function jump() {
  if (me.y <= 0) me.vy = JUMP_SPEED;
}
addEventListener('keydown', e => {
  if (!socket || document.activeElement === $('chatInput')) return;
  if (e.key === 'Enter') return openChat();
  if (e.code === 'Space') jump();
  if (EMOTE_KEYS[e.code]) emote(EMOTE_KEYS[e.code]);
  if (e.code === 'KeyG') socket.send({ t: 'leaveParty' });
  keys.add(e.code);
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const raycaster = new THREE.Raycaster(),
  drags = new Map();
renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());
renderer.domElement.addEventListener('pointerdown', e => {
  // Mouse: o botão direito gira a câmera e o esquerdo só clica. Toque: arrastar gira.
  const rotate = e.pointerType !== 'mouse' || e.button === 2;
  drags.set(e.pointerId, { x: e.clientX, y: e.clientY, moved: 0, rotate });
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener('pointermove', e => {
  const d = drags.get(e.pointerId);
  if (!d) return;
  const dx = e.clientX - d.x,
    dy = e.clientY - d.y;
  d.x = e.clientX;
  d.y = e.clientY;
  d.moved += Math.abs(dx) + Math.abs(dy);
  if (!d.rotate) return;
  camYaw -= dx * 0.006;
  camPitch = Math.min(1.2, Math.max(-0.1, camPitch + dy * 0.004));
});
renderer.domElement.addEventListener('pointerup', e => {
  const d = drags.get(e.pointerId);
  drags.delete(e.pointerId);
  // Convite só num clique curto com o botão esquerdo, ou num toque sem arrastar.
  if (!d || !socket || d.moved > 8 || (d.rotate && e.pointerType === 'mouse')) return;
  // Toque/clique curto num boneco: convida para o grupo.
  raycaster.setFromCamera(
    new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1),
    camera,
  );
  const hit = raycaster
    .intersectObjects(
      [...remotes.values()].map(a => a.root),
      true,
    )
    .find(h => h.object.userData.avatar);
  if (hit) socket.send({ t: 'invite', to: hit.object.userData.avatar.id });
});

// Joystick virtual (celular).
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
const releaseStick = () => {
  stick = { x: 0, y: 0 };
  knob.style.transform = '';
};
stickEl.addEventListener('pointerup', releaseStick);
stickEl.addEventListener('pointercancel', releaseStick);
// Barra de ações (mesmas ações do teclado; no celular é o único jeito de usá-las).
const ACTIONS = {
  jump,
  wave: () => emote('wave'),
  point: () => emote('point'),
  dance: () => emote('dance'),
  chat: () => openChat(),
  party: () => socket?.send({ t: 'leaveParty' }),
};
for (const b of document.querySelectorAll('#actions button'))
  b.onclick = e => {
    e.currentTarget.blur(); // Enter/Espaço não podem "clicar" o botão de novo pelo teclado
    ACTIONS[b.dataset.action]?.();
  };

// --- Simulação local ---
function collide() {
  me.x = Math.min(LOBBY_BOUNDS.maxX, Math.max(LOBBY_BOUNDS.minX, me.x));
  me.z = Math.min(LOBBY_BOUNDS.maxZ, Math.max(LOBBY_BOUNDS.minZ, me.z));
  for (const p of PILLARS) {
    const dx = me.x - p.x,
      dz = me.z - p.z,
      dist = Math.hypot(dx, dz),
      min = PILLAR_RADIUS + 0.35;
    if (dist < min && dist > 0) {
      me.x = p.x + (dx / dist) * min;
      me.z = p.z + (dz / dist) * min;
    }
  }
}
function stepSelf(dt, now) {
  const fwd =
      (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) -
      (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) -
      stick.y,
    side =
      (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) -
      (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) +
      stick.x,
    len = Math.min(1, Math.hypot(fwd, side)),
    running = keys.has('ShiftLeft') || keys.has('ShiftRight') || Math.hypot(stick.x, stick.y) > 0.9,
    speed = len > 0.05 ? (running ? RUN_SPEED - 0.5 : WALK_SPEED) * len : 0;
  if (speed) {
    // Frente = para longe da câmera.
    const fx = -Math.sin(camYaw),
      fz = -Math.cos(camYaw),
      dx = (fx * fwd + -fz * side) / (Math.hypot(fwd, side) || 1),
      dz = (fz * fwd + fx * side) / (Math.hypot(fwd, side) || 1);
    me.x += dx * speed * dt;
    me.z += dz * speed * dt;
    const target = Math.atan2(dx, dz),
      turn = ((((target - me.yaw) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
    me.yaw += turn * Math.min(1, dt * 12);
    me.emote = null;
  }
  collide();
  me.vy -= GRAVITY * dt;
  me.y = Math.max(0, me.y + me.vy * dt);
  if (me.y === 0) me.vy = 0;
  if (me.emote && now > me.emoteUntil) me.emote = null;
  me.anim = me.y > 0 ? 'jump' : speed > WALK_SPEED + 0.5 ? 'run' : speed ? 'walk' : 'idle';
  // 20 Hz enquanto algo muda; 1 Hz parado, só para manter a presença.
  const state = `${me.x.toFixed(2)}|${me.z.toFixed(2)}|${me.yaw.toFixed(2)}|${me.anim}`;
  if (now - lastSend >= (state !== lastSent ? SEND_MS : IDLE_SEND_MS)) {
    lastSend = now;
    lastSent = state;
    socket?.send({ t: 'move', x: me.x, z: me.z, yaw: me.yaw, anim: me.anim });
  }
  self.root.position.set(me.x, 0, me.z);
  self.root.rotation.y = me.yaw;
  self.update(dt, { speed, anim: me.anim, emote: me.emote, emoteN: me.emoteN, jumpY: me.y }, now);
}

const cameraTarget = new THREE.Vector3(),
  cameraDesired = new THREE.Vector3();
function updateCamera(dt) {
  const target = cameraTarget.set(me.x, 1.6 + me.y * 0.5, me.z),
    desired = cameraDesired.set(
      me.x + Math.sin(camYaw) * Math.cos(camPitch) * CAMERA_DISTANCE,
      1.6 + Math.sin(camPitch) * CAMERA_DISTANCE,
      me.z + Math.cos(camYaw) * Math.cos(camPitch) * CAMERA_DISTANCE,
    );
  desired.y = Math.min(3.1, Math.max(0.4, desired.y));
  camera.position.lerp(desired, Math.min(1, dt * 10));
  camera.lookAt(target);
}

// Testes automatizados (?debug): leem e movem o jogador local sem teclado.
if (new URLSearchParams(location.search).has('debug')) window.lobbyDebug = { me, keys };

// --- Laço principal ---
let last = performance.now();
let frameStart = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const frameMs = now - frameStart;
  frameStart = now;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (self) {
    stepSelf(dt, now);
    for (const [id, avatar] of remotes) {
      const s = buffer.sample(id, now);
      if (!s) continue;
      avatar.root.position.set(s.x, 0, s.z);
      avatar.root.rotation.y = s.yaw;
      avatar.update(
        dt,
        {
          speed: s.anim === 'idle' ? 0 : s.speed,
          anim: s.anim,
          emote: s.emote,
          emoteN: s.emoteN,
          jumpY: s.anim === 'jump' ? 0.45 : 0,
        },
        now,
      );
    }
    updateCamera(dt);
    $('lobbyInfo').innerHTML =
      `${lobbyLabel} · ${playersInLobby} jogador${playersInLobby === 1 ? '' : 'es'}`;
  } else {
    // Menu: câmera girando devagar pelo salão.
    camera.position.set(Math.sin(now / 9000) * 9, 2.6, Math.cos(now / 9000) * 9);
    camera.lookAt(0, 1.4, -6);
  }
  for (const portal of portals) portal.render(Date.now(), me.id);
  animateLobby(now / 1000);
  stats.begin();
  pipeline.render(dt * 1000, now);
  labels.render(scene, camera);
  stats.end(frameMs, now);
}
requestAnimationFrame(frame);
setupLandscape();
returnToLobby();

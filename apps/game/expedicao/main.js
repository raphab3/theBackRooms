// Expedição no mundo aberto (WorldDO): acampamento a céu aberto e edificações em volta. Cada
// jogador está numa zona; trocar de zona desmonta e monta a cena. Chega pelo portal do lobby com
// #travel={code,id,token,name}; sai pelo portal do acampamento (segurando E) de volta ao lobby.
import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { cannonColor } from '@backrooms/shared/arms.js';
import {
  BOSS,
  BOSS_UNLOCK_NIGHT,
  BUILDINGS,
  CARTOGRAPHER,
  GENERATOR,
  GENERATOR_CENTER,
  INSIDE_EXIT,
  LEAVE_MS,
  MAP_PRICE,
  PORTAL,
  REFUEL_REACH,
  USE_REACH,
  buildingSeed,
  createCamp,
} from '@backrooms/shared/camp.js';
import { FIRE, rayToWall, traceShot } from '@backrooms/shared/combat.js';
import { ITEMS, SALVAGE_MS, SALVAGE_REACH, countItem } from '@backrooms/shared/loot.js';
import { createWorld } from '@backrooms/shared/world.js';
import { Avatar } from '../lobby/avatar.js';
import { createHum } from '../lobby/hum.js';
import { setupLandscape } from '../lobby/landscape.js';
import { RemoteBuffer } from '../lobby/net.js';
import { bindQualitySelect, createPipeline } from '../lobby/quality.js';
import { createStats } from '../lobby/stats.js';
import { buildCamp } from './camp3d.js';
import { createEffects, createSfx } from './effects.js';
import { S, buildLevel } from './level.js';
import { drawMinimap } from './minimap.js';

const $ = id => document.getElementById(id);
const WALK = 1.85, // células/s, como no jogo clássico
  RUN = 3.1,
  RADIUS = 0.2,
  EYE = 1.6,
  SEND_MS = 1000 / 30,
  IDLE_SEND_MS = 1000,
  CORRECTION = 0.5,
  RETURN_MS = 6000,
  RETURN_KEY = 'backrooms.lobbyReturn',
  ICONS = { scrap: '🔩', almond: '💧', core_fire: '🔥' };

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
  camera = new THREE.PerspectiveCamera(70, 1, 0.05, 120);
camera.rotation.order = 'YXZ';
scene.add(camera);
const LANTERN_POWER = 18;
const lantern = new THREE.SpotLight(0xfff4d8, LANTERN_POWER, 16, 0.5, 0.45, 1.4);
// Acima e à esquerda do olho: o facho não pega no braço (senão ele estoura de tão claro).
lantern.position.set(-0.1, 0.12, 0);
lantern.target.position.set(0, 0, -1);
camera.add(lantern, lantern.target);
// Braço-Arma em primeira pessoa: antebraço e o canhão que brilha ao carregar.
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
const chargedColor = new THREE.Color(0xff3a10),
  effects = createEffects(scene),
  sfx = createSfx(),
  seenEffects = new Set(),
  pipeline = createPipeline(renderer, scene, camera),
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
  me = { x: 0, y: 0, a: -Math.PI / 2, pitch: 0, stamina: 100, alive: true, armLevel: 1 };
let ticket = null,
  view = null,
  camp = null,
  zoneId = null,
  zoneRoot = null,
  zoneGrid = null,
  zoneWorld = null,
  level = null,
  campScene = null,
  ws = null,
  seq = 0,
  reqId = 0,
  lastSend = 0,
  lastSent = '',
  ended = false,
  stick = { x: 0, y: 0 },
  touchRun = false,
  myBag = [],
  salvage = null, // { pile, start } enquanto segura E num monte
  leaveHold = null, // { start } enquanto segura E no portal
  chargeStart = 0,
  recoil = 0,
  shake = 0,
  lastShot = 0,
  explored = {}, // névoa do mini mapa por zona ('0'/'1' por célula), vinda do servidor
  mapShown = true,
  mapDrawnAt = 0,
  mapForced = false; // só o debug liga

function send(action, extra = {}) {
  if (ws?.readyState === 1) ws.send(JSON.stringify({ action, reqId: ++reqId, ...extra }));
}
let noticeTimer = 0;
function notice(text) {
  $('notice').textContent = text;
  $('notice').classList.add('show');
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => $('notice').classList.remove('show'), 3000);
}

// --- Entrada na expedição ---
function start() {
  const raw = new URLSearchParams(location.hash.slice(1)).get('travel');
  try {
    ticket = JSON.parse(raw);
    if (!ticket?.code || !ticket.id || !ticket.token) throw Error();
  } catch {
    return fail('Entre na expedição pelo portal do lobby.');
  }
  // Sem o bilhete na URL, recarregar a página não reaproveita a credencial.
  history.replaceState(null, '', location.pathname);
  connect();
}
function fail(message) {
  $('loadingError').textContent = message;
  $('loadingBack').hidden = false;
}

function connect() {
  const scheme = location.protocol === 'http:' ? 'ws:' : 'wss:';
  ws = new WebSocket(`${scheme}//${location.host}/api/world/${ticket.code}/ws`);
  ws.onopen = () => send('hello', { id: ticket.id, token: ticket.token });
  ws.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'world') applyView(msg.view);
    else if (msg.type === 'map') explored[msg.zone] = msg.cells;
    else if (msg.type === 'result' && msg.extracted) finish(msg.extracted[ticket.id] || {});
    else if (msg.type === 'error' && msg.error) {
      if (!view) fail(msg.error);
      else notice(msg.error);
    }
  };
  ws.onclose = () => {
    if (!ended) setTimeout(connect, 1500);
  };
}

// --- Zonas: acampamento ou o interior de uma edificação ---
function disposeZone() {
  if (!zoneRoot) return;
  // Os letreiros (CSS2D) não saem do DOM sozinhos quando o grupo é removido.
  zoneRoot.traverse(o => o.isCSS2DObject && o.element.remove());
  scene.remove(zoneRoot);
  for (const avatar of remotes.values()) avatar.dispose();
  remotes.clear();
  buffer.frames = [];
}
function enterZone(next) {
  disposeZone();
  zoneId = next.zone;
  zoneRoot = new THREE.Group();
  scene.add(zoneRoot);
  camp ??= createCamp(next.seed);
  me.x = next.me.x;
  me.y = next.me.y;
  if (zoneId === 'camp') {
    campScene = buildCamp(zoneRoot, camp, scene);
    level = null;
    zoneWorld = null;
    zoneGrid = camp.grid;
    lantern.visible = false;
    // Olha para o gerador ao chegar.
    me.a = Math.atan2(GENERATOR.y + 1 - me.y, GENERATOR.x + 1 - me.x);
  } else {
    const index = BUILDINGS.findIndex(b => b.id === zoneId);
    zoneWorld = createWorld(buildingSeed(next.seed, index), next.level);
    level = buildLevel(zoneRoot, zoneWorld, scene);
    campScene = null;
    zoneGrid = zoneWorld.grid;
    lantern.visible = true;
    const cell = (dx, dy) => zoneGrid[Math.floor(me.y) + dy]?.[Math.floor(me.x) + dx] === 0;
    me.a =
      [0, Math.PI / 2, Math.PI, -Math.PI / 2].find(a =>
        cell(Math.round(Math.cos(a)), Math.round(Math.sin(a))),
      ) ?? 0;
  }
  const building = BUILDINGS.find(b => b.id === zoneId);
  $('levelName').textContent = building ? building.name.toUpperCase() : 'ACAMPAMENTO';
  pipeline.warm();
}

function applyView(next) {
  const first = !view;
  view = next;
  if (first) {
    $('loading').hidden = true;
    $('hud').hidden = false;
  }
  if (view.zone !== zoneId) enterZone(view);
  else if (view.me && Math.hypot(view.me.x - me.x, view.me.y - me.y) > CORRECTION) {
    me.x = view.me.x;
    me.y = view.me.y;
  }
  if (view.me) {
    if (!first)
      for (const item of Object.keys(ITEMS)) {
        const diff = countItem(view.me.bag, item) - countItem(myBag, item);
        if (diff > 0) notice(`+${diff} ${ITEMS[item].name}`);
      }
    myBag = view.me.bag;
    me.alive = view.me.alive;
    me.armLevel = view.me.armLevel;
  }
  buffer.push(
    performance.now(),
    view.players.map(p => ({
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
  for (const e of view.effects) {
    if (seenEffects.has(e.id)) continue;
    seenEffects.add(e.id);
    if (e.by === ticket.id) continue;
    effects.fire(
      new THREE.Vector3(e.from.x * S, 1.3, e.from.y * S),
      new THREE.Vector3(e.to.x * S, 1.3, e.to.y * S),
      e.kind === 'charged',
    );
    sfx.shot(e.kind === 'charged');
  }
  if (seenEffects.size > 200) seenEffects.clear();
}

function syncRemotes() {
  const seen = new Set();
  for (const p of view.players) {
    seen.add(p.id);
    if (!remotes.has(p.id)) {
      const avatar = new Avatar({ name: p.name, color: p.color, skin: p.skin || 'a' });
      void avatar.ready.then(() => pipeline.warm({ passes: false }));
      remotes.set(p.id, avatar);
      zoneRoot.add(avatar.root);
    }
  }
  for (const [id, avatar] of remotes)
    if (!seen.has(id)) {
      avatar.dispose();
      remotes.delete(id);
    }
}

const zoneName = zone =>
  zone === 'camp' ? 'acampamento' : BUILDINGS.find(b => b.id === zone)?.name || zone;
const clockText = ms => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
function renderHud() {
  $('coins').textContent = view.balance;
  const night = view.clock.phase === 'night';
  $('cycle').textContent = night
    ? `🌙 Noite ${view.clock.night} · amanhece em ${clockText(view.clock.endsIn)}${view.monsters.length ? ` · ${view.monsters.length} monstros` : ''}`
    : `☀ Dia ${view.clock.night + 1} · anoitece em ${clockText(view.clock.endsIn)}`;
  const g = view.generator,
    gen = g.on
      ? `Gerador ⛽ ${Math.round(g.fuel)}% · ❤ ${Math.round(g.hp)}%`
      : `<span class="warn">GERADOR APAGADO · ${Math.max(0, Math.ceil((45000 - g.offFor) / 1000))} s para tudo acabar</span>`;
  if (gen !== $('gen').dataset.html) $('gen').innerHTML = $('gen').dataset.html = gen;
  if (view.status === 'failed' && !ended) failed();
  if (view.status === 'won' && !ended) won(view.me?.prize || {});
  const m = view.mission,
    mission = m
      ? m.done
        ? '✔ Luz religada'
        : `Missão: ${m.fuses.filter(Boolean).length}/${m.fuses.length} fusíveis → painel no fundo`
      : view.enemy?.boss
        ? view.enemy.dead
          ? `${BOSS.name} caiu!`
          : `${BOSS.name} · ❤ ${Math.ceil(view.enemy.hp)}/${view.enemy.maxHp}`
        : '';
  $('mission').hidden = !mission;
  if ($('mission').textContent !== mission) $('mission').textContent = mission;
  const team = view.team
    .map(
      p =>
        `<div style="color:${p.color}" class="${p.alive && !p.left ? '' : 'out'}">${escapeHtml(p.name)}${
          p.id === ticket.id ? ' (você)' : ''
        } · ${p.left ? 'voltou' : p.alive ? zoneName(p.zone) : 'pego'}</div>`,
    )
    .join('');
  if (team !== $('team').dataset.html) $('team').innerHTML = $('team').dataset.html = team;
  $('down').hidden = me.alive || ended;
  if (!me.alive)
    $('downText').textContent =
      `A mochila ficou onde você caiu. Volta ao acampamento em ${Math.ceil((view.me?.respawnIn || 0) / 1000)} s.`;
  const slots = [];
  for (let i = 0; i < 12; i++) {
    const slot = myBag[i];
    slots.push(
      `<div class="slot" title="${slot ? ITEMS[slot.item].name : ''}">${slot ? `${ICONS[slot.item]}<b>${slot.qty}</b>` : ''}</div>`,
    );
  }
  if (view.me?.carrying)
    slots.push(`<div class="carrying">carregando ${view.me.carrying} mochila(s) de colegas</div>`);
  const html = slots.join('');
  if (html !== $('bag').dataset.html) $('bag').innerHTML = $('bag').dataset.html = html;
}
const escapeHtml = text => String(text).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

function failed() {
  ended = true;
  $('endTitle').textContent = 'O gerador apagou';
  $('endSummary').textContent = 'A escuridão tomou o acampamento. A expedição fracassou.';
  $('endLoot').textContent = 'As mochilas ficaram para trás.';
  $('end').hidden = false;
  $('down').hidden = true;
  setTimeout(backToLobby, RETURN_MS);
}
function won(mine) {
  ended = true;
  const loot = Object.entries(mine)
    .map(([item, qty]) => `${qty} ${ITEMS[item].name}`)
    .join(', ');
  $('endTitle').textContent = 'Vitória!';
  $('endSummary').textContent = `${BOSS.name} caiu. A equipe venceu a expedição.`;
  $('endLoot').textContent = loot
    ? `Você levou: ${loot}. Guardado no seu estoque.`
    : 'Você venceu de mãos vazias, mas venceu.';
  $('end').hidden = false;
  $('down').hidden = true;
  setTimeout(backToLobby, RETURN_MS);
}
function finish(mine) {
  ended = true;
  const loot = Object.entries(mine)
    .map(([item, qty]) => `${qty} ${ITEMS[item].name}`)
    .join(', ');
  $('endTitle').textContent = 'De volta ao Posto Zero';
  $('endSummary').textContent = 'Você atravessou o portal do acampamento.';
  $('endLoot').textContent = loot
    ? `Você levou: ${loot}. Guardado no seu estoque.`
    : 'Você voltou de mãos vazias desta vez.';
  $('end').hidden = false;
  $('down').hidden = true;
  setTimeout(backToLobby, RETURN_MS);
}
function backToLobby() {
  ended = true;
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
  if (!view || !me.alive || ended || now - lastShot < FIRE[kind].cooldownMs) return;
  lastShot = now;
  send('shoot', { kind, a: me.a });
  // Desenha na hora com o mesmo traçado do servidor (o dano chega no próximo estado).
  // No acampamento, o alvo é o monstro mais próximo na linha de tiro.
  const candidates = view.enemy && !view.enemy.dead ? [view.enemy] : view.monsters,
    shots = candidates.map(t => traceShot(zoneGrid, me, me.a, t, 'primary')).filter(r => r.hit),
    shot =
      shots.sort(
        (a, b) =>
          Math.hypot(a.end.x - me.x, a.end.y - me.y) - Math.hypot(b.end.x - me.x, b.end.y - me.y),
      )[0] || traceShot(zoneGrid, me, me.a, null, kind),
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

// --- E: o que estiver perto (porta, saída, portal ou sucata) ---
const near = p => Math.hypot(p.x - me.x, p.y - me.y) <= USE_REACH;
function useTarget() {
  if (!view || !me.alive || ended) return null;
  if (zoneId === 'camp') {
    const door = camp.buildings.find(b => near(b.doorAt));
    if (door?.boss && !view.bossUnlocked)
      return {
        kind: 'door',
        label: `🔒 ${door.name}: sobrevivam à ${BOSS_UNLOCK_NIGHT}ª noite para abrir`,
      };
    if (door?.boss) return { kind: 'door', label: `Entrar: ${door.name} (sem volta até vencer)` };
    if (door) return { kind: 'door', label: `Entrar: ${door.name}` };
    if (near(PORTAL)) return { kind: 'portal', label: 'Segure E para voltar ao Posto Zero' };
    if (near(CARTOGRAPHER) && !view.map.owned)
      return { kind: 'map', label: `E — comprar o mapa da equipe (${MAP_PRICE} moedas)` };
    if (Math.hypot(GENERATOR_CENTER.x - me.x, GENERATOR_CENTER.y - me.y) <= REFUEL_REACH)
      return { kind: 'refuel', label: 'E — abastecer o gerador (1 sucata)' };
  } else if (near(INSIDE_EXIT))
    return {
      kind: 'exit',
      label: view.mission ? 'Sair para o acampamento' : 'Sem volta: derrotem o chefão',
    };
  else if (view.mission && !view.mission.done && near(zoneWorld.exit)) {
    const missing = view.mission.fuses.filter(taken => !taken).length;
    return {
      kind: 'panel',
      label: missing
        ? `Painel sem energia: faltam ${missing} fusível(is)`
        : 'E — religar o painel (a luz volta e a entidade apaga)',
    };
  }
  let pile = null;
  for (const v of view.loot.piles) {
    const d = Math.hypot(v.x - me.x, v.y - me.y);
    if (d <= SALVAGE_REACH && (!pile || d < pile.d)) pile = { id: v.id, d };
  }
  return pile && { kind: 'pile', id: pile.id, label: 'Segure E para desmontar a sucata' };
}
function pressUse() {
  const target = useTarget();
  if (!target) return;
  if (target.kind === 'door' || target.kind === 'exit' || target.kind === 'panel') send('use');
  else if (target.kind === 'refuel') send('refuel');
  else if (target.kind === 'map') send('buyMap');
  else if (target.kind === 'portal') {
    send('use');
    leaveHold = { start: performance.now() };
  } else if (!salvage) {
    salvage = { pile: target.id, start: performance.now() };
    send('salvageStart', { pile: target.id });
  }
}
function releaseUse() {
  salvage = null;
  leaveHold = null;
}
function stepUse(now) {
  const target = useTarget();
  if (salvage && (target?.kind !== 'pile' || target.id !== salvage.pile)) salvage = null;
  if (leaveHold && target?.kind !== 'portal') leaveHold = null;
  if (salvage && now - salvage.start >= SALVAGE_MS) {
    send('salvage', { pile: salvage.pile });
    salvage = null;
  }
  if (leaveHold && now - leaveHold.start >= LEAVE_MS) {
    send('leave');
    leaveHold = null;
  }
  $('prompt').hidden = !target;
  if (target) {
    const hold = salvage
        ? (now - salvage.start) / SALVAGE_MS
        : leaveHold
          ? (now - leaveHold.start) / LEAVE_MS
          : 0,
      html = `${target.label.replace('E ', '<b>E</b> ')}<div class="bar" style="width:${Math.min(1, hold) * 100}%"></div>`;
    $('prompt').innerHTML = html;
  }
}

// --- Entrada: teclado, botão direito/arrastar gira, joystick no celular ---
addEventListener('keydown', e => {
  if (e.key === 'Enter' && view && !ended) return openChat();
  if (e.code === 'Space' && !e.repeat) startCharge();
  if (e.code === 'KeyE' && !e.repeat) pressUse();
  keys.add(e.code);
  if (e.code === 'KeyF') lantern.visible = !lantern.visible;
  if (e.code === 'KeyM') mapShown = !mapShown;
});
addEventListener('keyup', e => {
  if (e.code === 'Space') releaseShot();
  if (e.code === 'KeyE') releaseUse();
  keys.delete(e.code);
});
addEventListener('blur', () => keys.clear());
document.addEventListener('visibilitychange', () => document.hidden && keys.clear());
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
// Barra de ações: tocar/clicar faz o mesmo que a tecla; atirar e "usar" respeitam o segurar.
const holdActions = {
  fire: [startCharge, releaseShot],
  use: [pressUse, releaseUse],
};
const ACTIONS = {
  run: b => b.classList.toggle('on', (touchRun = !touchRun)),
  light: () => (lantern.visible = !lantern.visible),
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

// --- Chat da equipe ---
function openChat() {
  $('chatInput').hidden = false;
  $('chatInput').focus();
  keys.clear();
}
$('chatInput').addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Enter') {
    const text = $('chatInput').value.trim();
    if (text) send('chat', { text });
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
  for (const m of view.messages) {
    if (seenMessages.has(m.id)) continue;
    seenMessages.add(m.id);
    if (m.sender !== ticket.id) remotes.get(m.sender)?.say(m.text, performance.now());
  }
  const key = view.messages.map(m => m.id).join();
  if (key === $('chatLog').dataset.key) return;
  $('chatLog').dataset.key = key;
  $('chatLog').replaceChildren(
    ...view.messages.map(m => {
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
const open = (x, y) => zoneGrid[Math.floor(y)]?.[Math.floor(x)] === 0;
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
  // 30 Hz andando; 1 Hz parado, para o servidor saber que você continua ali.
  const state = `${me.x.toFixed(2)}|${me.y.toFixed(2)}|${me.a.toFixed(2)}`;
  if (!ended && me.alive && now - lastSend >= (state !== lastSent ? SEND_MS : IDLE_SEND_MS)) {
    lastSend = now;
    lastSent = state;
    if (ws?.readyState === 1)
      ws.send(JSON.stringify({ action: 'sync', seq: ++seq, x: me.x, y: me.y, a: me.a }));
  }
  $('staminaFill').style.width = me.stamina + '%';
  camera.position.set(me.x * S, EYE + (speed ? Math.abs(Math.sin(now / 160)) * 0.04 : 0), me.y * S);
  camera.rotation.set(me.pitch, -me.a - Math.PI / 2, 0);
  if (shake > 0) {
    camera.rotation.x += (Math.random() - 0.5) * shake * 0.1;
    camera.rotation.y += (Math.random() - 0.5) * shake * 0.1;
    shake = Math.max(0, shake - dt * 1.5);
  }
  // Coice do braço; cor pelo nível (muda no 4, 7 e 10) e brilho/mira crescendo ao carregar.
  // Lanterna mais fraca colada na parede, para a mancha de luz não estourar a tela.
  // Mede no centro e nas bordas do facho (parede ao lado também estoura).
  const wall = zoneGrid
      ? Math.min(...[0, -0.45, 0.45].map(o => rayToWall(zoneGrid, me.x, me.y, me.a + o, 3))) * S
      : 6,
    power = LANTERN_POWER * Math.min(1, Math.max(0.1, (wall + 0.3) / 3) ** 1.4);
  lantern.intensity += (power - lantern.intensity) * Math.min(1, dt * 10);
  recoil = Math.max(0, recoil - dt * 6);
  arm.position.z = -0.45 + recoil * 0.06;
  const charge = chargeStart ? Math.min(1, (now - chargeStart) / FIRE.charged.chargeMs) : 0;
  cannonGlow.color.set(cannonColor(me.armLevel || 1)).lerp(chargedColor, charge);
  muzzle.scale.setScalar(1 + charge * 0.35 + (charge === 1 ? Math.sin(now / 40) * 0.05 : 0));
  $('crosshair').style.transform = `scale(${1 + charge * 3})`;
  $('crosshair').classList.toggle('charged', charge === 1);
}

let last = performance.now(),
  frameStart = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const frameMs = now - frameStart;
  frameStart = now;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (view && zoneGrid) {
    stepSelf(dt, now);
    stepUse(now);
    effects.update(dt);
    if (level) {
      // Fusíveis da missão (na área do chefão não tem missão: escondidos e sem painel).
      level.update(
        {
          fuses: view.mission?.fuses || zoneWorld.fuses.map(() => true),
          done: view.mission?.done,
          panel: !!view.mission,
          collectedCoins: view.collectedCoins,
          enemy: view.enemy,
          loot: view.loot,
        },
        now / 1000,
      );
      if (view.enemy) level.moveEnemy(view.enemy, dt);
      hum.set(1 - Math.min(1, level.nearestLamp(me.x * S, me.y * S) / 5));
    } else {
      campScene?.update(now / 1000, view, dt);
      // No acampamento, o zumbido vem do gerador.
      hum.set(1 - Math.min(1, Math.hypot(me.x - GENERATOR.x - 1, me.y - GENERATOR.y - 1) / 10));
    }
    for (const [id, avatar] of remotes) {
      const s = buffer.sample(id, now);
      if (!s) continue;
      avatar.root.position.set(s.x, 0, s.z);
      avatar.root.rotation.y = s.yaw;
      avatar.update(dt, { speed: s.anim === 'down' ? 0 : s.speed, anim: s.anim }, now);
    }
    // Mini mapa redesenhado ~5 vezes por segundo.
    $('minimap').hidden = !mapShown;
    const mapOwned = view.map.owned || mapForced;
    $('mapCanvas').hidden = !mapOwned;
    $('mapLocked').hidden = mapOwned;
    if (mapShown && mapOwned && explored[zoneId] && now - mapDrawnAt > 200) {
      mapDrawnAt = now;
      drawMinimap($('mapCanvas'), {
        grid: zoneGrid,
        explored: explored[zoneId],
        zone: zoneId,
        camp,
        me,
        players: view.players,
        monsters: view.monsters,
      });
    }
    const seconds = Math.max(0, Math.floor((view.now - view.startedAt) / 1000));
    $('clock').textContent =
      `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
  stats.begin();
  pipeline.render(dt * 1000, now);
  labels.render(scene, camera);
  stats.end(frameMs, now);
}
requestAnimationFrame(frame);
// Testes automatizados (localStorage backrooms.debug = 1): movem o jogador sem teclado.
try {
  if (localStorage.getItem('backrooms.debug') === '1')
    window.expeditionDebug = {
      me,
      pressUse,
      releaseUse,
      view: () => view,
      zone: () => ({ grid: zoneGrid, world: zoneWorld }),
      // Só para testar o desenho: finge a névoa vinda do servidor (o servidor continua mandando a real).
      fakeMap(cells) {
        explored[zoneId] = cells ?? '1'.repeat(zoneGrid.length ** 2);
        mapForced = true;
      },
      // Move e já avisa o servidor (sem esperar um quadro, que pode estar pausado).
      goto(x, y) {
        Object.assign(me, { x, y });
        if (ws?.readyState === 1)
          ws.send(JSON.stringify({ action: 'sync', seq: ++seq, x, y, a: me.a }));
      },
      leave: () => send('leave'),
    };
} catch {}
setupLandscape();
start();

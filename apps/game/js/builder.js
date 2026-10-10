// Modo construtor: editor, galeria e mapas da comunidade.
import {
  BUILD_PROPS,
  PHASE_ORDER,
  createCustomWorld,
  newCustomMap,
  validateCustomMap,
} from '@backrooms/shared/world.js';
import { gameMusic, initAudio, playMusic, syncGameMusic, syncMenuMusic } from './audio.js';
import { chatOpen, ensureGlobalSession } from './chat.js';
import { $, H, W, ctx } from './dom.js';
import { lock, resetMotion, say, smoothWalk, solid, updateHud } from './engine.js';
import { enterLandscape } from './fullscreen.js';
import { padInput } from './gamepad.js';
import { formatLeaderboardTime } from './leaderboard.js';
import { resetLevelMap } from './levelmap.js';
import { LEVEL_INFO } from './levels.js';
import { updateModeUI } from './modes.js';
import { leaveRoom, nameInput, requestRoom, showPanel } from './net.js';
import { makeTextures } from './render.js';
import { updateRescueUI } from './revive.js';
import { game } from './state.js';
import { touchMove } from './touch.js';

const builder = {
  editing: false,
  custom: null,
  map: null,
  mapId: null,
  revision: 0,
  undo: [],
  redo: [],
  tool: 'wall',
  rotation: 0,
  dirty: false,
  busy: false,
  testing: false,
  listRequest: 0,
};
// First-person map workshop. Drafts remain separate from published snapshots.
const BUILDER_TOOLS = [
  ['wall', 'Parede'],
  ['erase', 'Apagar'],
  ['floor', 'Pintar piso'],
  ['paint', 'Pintar parede'],
  ['table', 'Mesa'],
  ['chair', 'Cadeira'],
  ['crate', 'Caixa'],
  ['pillar', 'Pilar'],
  ['barrier', 'Mureta'],
  ['lamp', 'Luz'],
  ['spawn', 'Início'],
  ['exit', 'Saída'],
  ['fuse', 'Fusível'],
  ['coin', 'Moeda'],
  ['enemy', 'Monstro'],
];
const cloneMap = m => JSON.parse(JSON.stringify(m));
function builderMessage(text) {
  $('builderStatus').textContent = text;
}
function builderProfileKey() {
  return (
    'backrooms.builder.' + $('nickname').value.trim().normalize('NFKC').toLocaleLowerCase('pt-BR')
  );
}
function persistBuilderDraft() {
  if (!builder.map) return;
  try {
    localStorage.setItem(
      builderProfileKey(),
      JSON.stringify({ map: builder.map, mapId: builder.mapId, revision: builder.revision }),
    );
  } catch {
    builderMessage('Não foi possível guardar o rascunho neste aparelho. Use SALVAR.');
  }
}
async function mapRequest(action, body = {}, authenticated = false) {
  if (authenticated) {
    nameInput();
    await ensureGlobalSession();
    try {
      await requestRoom(
        'poll',
        { ...game.globalSession, name: $('nickname').value.trim() },
        '/api/global/',
      );
    } catch (e) {
      if (e.status !== 401) throw e;
      game.globalSession = null;
      await ensureGlobalSession();
    }
    body = { ...body, sessionId: game.globalSession.id, sessionToken: game.globalSession.token };
  }
  return requestRoom(action, body, '/api/maps/');
}
async function openWorkshop(tab = 'mine') {
  if (builder.busy) return;
  if (builder.editing) persistBuilderDraft();
  builder.editing = false;
  builder.custom = null;
  builder.map = null;
  builder.mapId = null;
  builder.revision = 0;
  builder.undo = [];
  builder.redo = [];
  $('builderHud').hidden =
    $('builderPalette').hidden =
    $('builderReturn').hidden =
    $('customGalleryReturn').hidden =
      true;
  document.body.classList.remove('building', 'custom-map');
  await leaveRoom();
  $('workshop').hidden = false;
  builder.tab = tab;
  builder.page = 0;
  await loadMapCards(false);
}
function mapCardButton(label, action) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.onclick = async () => {
    if (b.disabled) return;
    b.disabled = true;
    try {
      await action();
    } catch (e) {
      $('workshopStatus').textContent = e.message;
    } finally {
      b.disabled = false;
    }
  };
  return b;
}
async function loadMapCards(append = false) {
  const tab = builder.tab,
    offset = append ? builder.nextPage : 0,
    request = ++builder.listRequest;
  if (offset === null) return;
  $('workshopStatus').textContent = 'Carregando mapas…';
  $('mapsMore').disabled = true;
  $('mapsMine').setAttribute('aria-pressed', String(tab === 'mine'));
  $('mapsPublic').setAttribute('aria-pressed', String(tab === 'gallery'));
  if (!append) $('mapCards').replaceChildren();
  try {
    const data = await mapRequest(tab, { offset }, tab === 'mine');
    if (request !== builder.listRequest || $('workshop').hidden) return;
    for (const entry of data.maps) {
      const card = document.createElement('article');
      card.className = 'map-card';
      const thumbnail = document.createElement('canvas');
      thumbnail.width = thumbnail.height = 168;
      const c = thumbnail.getContext('2d');
      let preview;
      try {
        preview = JSON.parse(entry.preview);
      } catch {}
      c.fillStyle = '#15201a';
      c.fillRect(0, 0, 168, 168);
      if (preview)
        for (let y = 0; y < 21; y++)
          for (let x = 0; x < 21; x++) {
            c.fillStyle = preview[y][x] ? '#c6ba75' : '#2b5549';
            c.fillRect(x * 8, y * 8, 7, 7);
          }
      const body = document.createElement('div'),
        title = document.createElement('h3'),
        by = document.createElement('p'),
        status = document.createElement('p'),
        actions = document.createElement('nav');
      title.setAttribute('translate', 'no');
      by.setAttribute('translate', 'no');
      title.textContent = entry.title;
      by.textContent = 'Por ' + entry.author;
      status.textContent =
        tab === 'mine'
          ? entry.published
            ? 'Publicado · edição como rascunho'
            : 'Rascunho privado'
          : LEVEL_INFO[entry.theme]?.name || 'Mapa da comunidade';
      if (tab === 'mine') {
        actions.append(
          mapCardButton('EDITAR', async () => {
            const d = await mapRequest('get', { mapId: entry.id, edit: true }, true);
            openBuilderMap(d.map, d.mapId, d.revision);
          }),
        );
        if (entry.published)
          actions.append(
            mapCardButton('RETIRAR DA GALERIA', async () => {
              await mapRequest('unpublish', { mapId: entry.id, revision: entry.revision }, true);
              await loadMapCards();
            }),
          );
        actions.append(
          mapCardButton('EXCLUIR', async () => {
            if (!window.confirm('Excluir este mapa e sua publicação?')) return;
            await mapRequest('delete', { mapId: entry.id, revision: entry.revision }, true);
            await loadMapCards();
          }),
        );
      }
      if (tab === 'gallery' || entry.published)
        actions.append(
          mapCardButton('JOGAR', async () => {
            const d = await mapRequest('get', { mapId: entry.id });
            playCommunityMap(d.map);
          }),
        );
      body.append(title, by, status, actions);
      card.append(thumbnail, body);
      $('mapCards').append(card);
    }
    builder.nextPage = data.nextOffset;
    $('mapsMore').hidden = data.nextOffset === null;
    $('workshopStatus').textContent = $('mapCards').children.length
      ? tab === 'mine'
        ? 'Seus mapas ficam salvos pelo nome do explorador.'
        : 'Escolha um mapa e tente escapar!'
      : tab === 'mine'
        ? 'Seu primeiro labirinto começa aqui. Clique em CRIAR MAPA.'
        : 'A galeria ainda está vazia. Publique o primeiro mapa!';
  } catch (e) {
    $('workshopStatus').textContent = e.message;
  } finally {
    $('mapsMore').disabled = false;
  }
}
function refreshCustomWorld(resetPlayer = false) {
  const map = builder.custom,
    world = createCustomWorld(map);
  game.grid = world.grid;
  game.fuses = world.fuses;
  game.coins = world.coins;
  game.exit = world.exit;
  game.enemy = world.enemy;
  game.smile = world.smile;
  if (resetPlayer) {
    game.player = { ...world.spawn };
    game.elapsed = 0;
    game.stamina = 100;
    game.coinBalance = 0;
    game.soloProtectedUntil = 0;
    game.soloEnemySpawn = game.enemy ? { ...game.enemy } : null;
    resetMotion();
    game.viewPitch = 0;
    game.keys = {};
  }
  game.activeLevel = 'custom';
  game.activeMode = 'normal';
  if (resetPlayer) resetLevelMap();
  LEVEL_INFO.custom.ambient = map.brightness;
  makeTextures(map.theme);
  builder.colors = {
    wall: map.wallColor ? rgbHex(map.wallColor) : null,
    floor: map.floorColor ? rgbHex(map.floorColor) : null,
    ceiling: map.ceilingColor ? rgbHex(map.ceilingColor) : null,
    walls: Object.fromEntries(Object.entries(map.wallPaint).map(([k, v]) => [k, rgbHex(v)])),
    floors: Object.fromEntries(Object.entries(map.floorPaint).map(([k, v]) => [k, rgbHex(v)])),
  };
  $('levelLabel').textContent = map.title.toUpperCase();
  updateHud();
  updateModeUI();
  updateRescueUI();
}
function rgbHex(hex) {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
}
function openBuilderMap(map, mapId = null, revision = 0) {
  if (builder.busy) return;
  builder.map = validateCustomMap(map);
  builder.mapId = mapId;
  builder.revision = revision;
  builder.undo = [];
  builder.redo = [];
  builder.editing = true;
  builder.custom = builder.map;
  builder.dirty = false;
  builder.tool = 'wall';
  builder.rotation = 0;
  $('workshop').hidden = true;
  $('builderHud').hidden = false;
  $('builderReturn').hidden = $('customGalleryReturn').hidden = true;
  document.body.classList.add('building', 'custom-map', 'playing');
  game.state = 'playing';
  refreshCustomWorld(true);
  builderUpdateFields();
  openBuilderPalette();
  syncMenuMusic();
  syncGameMusic();
  persistBuilderDraft();
}
function builderUpdateFields() {
  const m = builder.map;
  $('builderTitle').value = m.title;
  $('builderTheme').value = m.theme;
  $('builderWallColor').value = m.wallColor || '#bcae79';
  $('builderFloorColor').value = m.floorColor || '#827647';
  $('builderCeilingColor').value = m.ceilingColor || '#b5ae8e';
  $('builderLight').value = m.brightness;
  $('builderSpeed').value = m.monsterSpeed;
  $('builderMapName').textContent = m.title;
  $('builderUndo').disabled = !builder.undo.length;
  $('builderRedo').disabled = !builder.redo.length;
  $('builderSaved').textContent =
    (builder.dirty ? 'Alterações no rascunho' : builder.mapId ? 'Mapa salvo' : 'Novo mapa') +
    ' · ' +
    m.fuses.length +
    '/3 fusíveis';
  for (const [tool] of BUILDER_TOOLS)
    $('tool-' + tool).setAttribute('aria-pressed', String(builder.tool === tool));
  $('builderToolLabel').textContent =
    BUILDER_TOOLS.find(t => t[0] === builder.tool)?.[1].toUpperCase() || 'PAREDE';
}
function commitBuilderChange(change) {
  if (!builder.editing || builder.busy) return;
  const before = cloneMap(builder.map);
  try {
    change(builder.map);
    builder.map = validateCustomMap(builder.map);
  } catch (e) {
    builder.map = before;
    builder.custom = builder.map;
    builderMessage(e.message);
    return false;
  }
  if (JSON.stringify(before) === JSON.stringify(builder.map)) return false;
  builder.undo.push(before);
  if (builder.undo.length > 40) builder.undo.shift();
  builder.redo = [];
  builder.custom = builder.map;
  builder.dirty = true;
  refreshCustomWorld();
  builderUpdateFields();
  persistBuilderDraft();
  return true;
}
function builderUndo(redo = false) {
  if (!builder.editing || builder.busy) return;
  const from = redo ? builder.redo : builder.undo,
    to = redo ? builder.undo : builder.redo;
  if (!from.length) return;
  to.push(cloneMap(builder.map));
  builder.map = from.pop();
  builder.custom = builder.map;
  builder.dirty = true;
  refreshCustomWorld();
  if (solid(game.player.x, game.player.y)) game.player = { ...builder.map.spawn };
  builderUpdateFields();
  persistBuilderDraft();
  builderMessage(redo ? 'Alteração refeita.' : 'Alteração desfeita.');
}
function openBuilderPalette() {
  if (!builder.editing) return;
  $('builderPalette').hidden = false;
  resetMotion();
  game.keys = {};
  document.exitPointerLock?.();
}
function closeBuilderPalette() {
  if (!builder.editing) return;
  $('builderPalette').hidden = true;
  game.state = 'playing';
  game.keys = {};
  document.body.classList.add('playing');
  lock();
}
function builderTarget() {
  let previous = { x: Math.floor(game.player.x), y: Math.floor(game.player.y) },
    last = previous;
  // Pitch lowers the placement plane, while walls stop the aim ray.
  const reach = game.viewPitch < -10 ? Math.min(4, Math.max(0.8, (H * 0.5) / -game.viewPitch)) : 3;
  for (let d = 0.18; d <= reach; d += 0.04) {
    const x = Math.floor(game.player.x + Math.cos(game.player.a) * d),
      y = Math.floor(game.player.y + Math.sin(game.player.a) * d);
    if (x < 0 || y < 0 || x > 20 || y > 20) break;
    last = { x, y };
    if (game.grid[y][x]) return { hit: last, place: previous };
    if (x !== previous.x || y !== previous.y) previous = last;
  }
  return { hit: last, place: last };
}
function builderApply(erase = false) {
  if (!builder.editing || builder.busy || game.state !== 'playing' || !$('builderPalette').hidden)
    return;
  const target = builderTarget(),
    tool = erase ? 'erase' : builder.tool;
  const p =
    tool === 'paint' || tool === 'erase'
      ? target.hit
      : tool === 'floor'
        ? target.hit
        : target.place;
  if (p.x < 1 || p.y < 1 || p.x > 19 || p.y > 19) {
    builderMessage('As paredes externas protegem o mapa. Construa dentro delas.');
    return;
  }
  const x = p.x + 0.5,
    y = p.y + 0.5,
    same = o => o && o.x === x && o.y === y;
  if (
    ['wall', ...BUILD_PROPS.filter(k => k !== 'lamp')].includes(tool) &&
    Math.hypot(game.player.x - x, game.player.y - y) < 1
  ) {
    builderMessage('Dê um passo para trás para colocar aqui.');
    return;
  }
  const ok = commitBuilderChange(m => {
    if (tool === 'floor') {
      m.floorPaint[p.x + ',' + p.y] = $('builderPaint').value;
      return;
    }
    if (tool === 'paint') {
      if (!m.grid[p.y][p.x]) throw new Error('Mire numa parede para pintar.');
      m.wallPaint[p.x + ',' + p.y] = $('builderPaint').value;
      return;
    }
    if (same(m.spawn) && tool !== 'spawn')
      throw new Error('Mova o início antes de modificar esse espaço.');
    // Replacing a cell removes its previous furniture or objective.
    m.props = m.props.filter(o => !same(o));
    m.fuses = m.fuses.filter(o => !same(o));
    m.coins = m.coins.filter(o => !same(o));
    m.monsters = m.monsters.filter(o => !same(o));
    if (same(m.exit)) m.exit = null;
    m.grid[p.y][p.x] = 0;
    if (tool === 'wall') m.grid[p.y][p.x] = 1;
    else if (BUILD_PROPS.includes(tool))
      m.props.push({
        x,
        y,
        kind: tool,
        color: $('builderPaint').value,
        rotation: builder.rotation,
      });
    else if (tool === 'spawn')
      m.spawn = { x, y, a: (Math.round(game.player.a / (Math.PI / 2)) * Math.PI) / 2 };
    else if (tool === 'exit') m.exit = { x, y };
    else if (tool === 'fuse') {
      if (m.fuses.length >= 3)
        throw new Error('Já existem 3 fusíveis. Apague um para mudá-lo de lugar.');
      m.fuses.push({ x, y });
    } else if (tool === 'coin') m.coins.push({ x, y });
    else if (tool === 'enemy') m.monsters.push({ x, y });
  });
  if (ok)
    builderMessage(
      tool === 'erase' ? 'Espaço apagado.' : 'Colocado! Use DESFAZER se quiser voltar.',
    );
}
function updateBuilder(dt) {
  if (game.state !== 'playing' || !$('builderPalette').hidden || chatOpen) {
    resetMotion();
    return;
  }
  let forward =
      (game.keys.KeyW || game.keys.ArrowUp ? 1 : 0) -
      (game.keys.KeyS || game.keys.ArrowDown ? 1 : 0),
    side = (game.keys.KeyD ? 1 : 0) - (game.keys.KeyA ? 1 : 0);
  if (padInput.x || padInput.y) {
    forward = -padInput.y;
    side = padInput.x;
  }
  if (touchMove.pointer !== null) {
    forward = -touchMove.y;
    side = touchMove.x;
  }
  game.player.a +=
    ((game.keys.ArrowRight ? 1 : 0) - (game.keys.ArrowLeft ? 1 : 0)) * dt * 1.9 +
    padInput.lookX * dt * 1.85;
  game.viewPitch = Math.max(-H * 0.6, Math.min(H * 0.4, game.viewPitch - padInput.lookY * dt * 95));
  smoothWalk(forward, side, game.keys.ShiftLeft || padInput.run ? 3.1 : 1.85, dt);
}
function drawBuilderAim(ca, sa, horizon) {
  if (!builder.editing || !$('builderPalette').hidden) return;
  const t = builderTarget(),
    p = ['erase', 'paint', 'floor'].includes(builder.tool) ? t.hit : t.place;
  const h = builder.tool === 'floor' ? 0.012 : 1;
  const points = [
    [p.x, p.y, 0],
    [p.x + 1, p.y, 0],
    [p.x + 1, p.y + 1, 0],
    [p.x, p.y + 1, 0],
    [p.x, p.y, h],
    [p.x + 1, p.y, h],
    [p.x + 1, p.y + 1, h],
    [p.x, p.y + 1, h],
  ].map(v => {
    const dx = v[0] - game.player.x,
      dy = v[1] - game.player.y,
      d = dx * ca + dy * sa;
    return d > 0.06
      ? { x: W / 2 + ((-dx * sa + dy * ca) / d) * (W / 1.44), y: horizon - ((v[2] - 0.5) / d) * H }
      : null;
  });
  ctx.save();
  ctx.strokeStyle = builder.tool === 'erase' ? '#ff8d7f' : '#c4ff86';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (const [a, b] of [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ])
    if (points[a] && points[b]) {
      ctx.moveTo(points[a].x, points[a].y);
      ctx.lineTo(points[b].x, points[b].y);
    }
  ctx.stroke();
  ctx.restore();
}
async function saveBuilder(publish = false) {
  if (!builder.map || builder.busy) return;
  let snapshot;
  try {
    snapshot = validateCustomMap(builder.map, publish);
  } catch (e) {
    builderMessage(e.message);
    return;
  }
  builder.busy = true;
  for (const id of ['builderSave', 'builderPublish', 'builderLeave', 'builderTest'])
    $(id).disabled = true;
  builderMessage(publish ? 'Publicando seu mapa…' : 'Salvando seu mapa…');
  try {
    const result = await mapRequest(
      'save',
      { mapId: builder.mapId, revision: builder.revision, map: snapshot, publish },
      true,
    );
    builder.mapId = result.mapId;
    builder.revision = result.revision;
    builder.dirty = false;
    builderUpdateFields();
    persistBuilderDraft();
    builderMessage(
      publish ? 'Publicado! Todos já podem jogar na galeria.' : 'Salvo no seu perfil.',
    );
  } catch (e) {
    persistBuilderDraft();
    builderMessage(e.message + ' Seu rascunho continua neste aparelho.');
  } finally {
    builder.busy = false;
    for (const id of ['builderSave', 'builderPublish', 'builderLeave', 'builderTest'])
      $(id).disabled = false;
  }
}
function launchCustomMap(map, fromEditor = false) {
  const validated = validateCustomMap(map, true);
  builder.custom = validated;
  builder.editing = false;
  builder.testing = fromEditor;
  $('workshop').hidden = true;
  $('builderHud').hidden = $('builderPalette').hidden = true;
  $('builderReturn').hidden = !fromEditor;
  $('customGalleryReturn').hidden = fromEditor;
  document.body.classList.remove('building');
  document.body.classList.add('custom-map', 'playing');
  refreshCustomWorld(true);
  game.state = 'playing';
  showPanel('pause');
  document.body.classList.add('playing');
  initAudio();
  playMusic(gameMusic);
  syncMenuMusic();
  syncGameMusic();
  void enterLandscape();
  lock();
  say('Encontre os 3 fusíveis e chegue à saída!');
}
function testBuilder() {
  if (builder.busy) return;
  try {
    persistBuilderDraft();
    launchCustomMap(builder.map, true);
  } catch (e) {
    builderMessage(e.message);
  }
}
function playCommunityMap(map) {
  builder.map = null;
  builder.mapId = null;
  builder.revision = 0;
  launchCustomMap(map, false);
}
function returnToBuilder() {
  if (!builder.map) return;
  builder.editing = true;
  builder.custom = builder.map;
  builder.testing = false;
  game.state = 'playing';
  $('builderReturn').hidden = $('customGalleryReturn').hidden = true;
  $('builderHud').hidden = false;
  document.body.classList.add('building', 'playing');
  refreshCustomWorld(true);
  builderUpdateFields();
  openBuilderPalette();
}
function finishCustom(win) {
  resetMotion();
  game.keys = {};
  game.state = win ? 'won' : 'lost';
  document.body.classList.remove('playing');
  document.exitPointerLock?.();
  showPanel('pause');
  $('story').textContent = win ? 'Você escapou deste mapa!' : 'O monstro encontrou você.';
  $('details').textContent = win
    ? builder.custom.title + ' · Tempo: ' + formatLeaderboardTime(Math.round(game.elapsed * 1000))
    : 'Tente novamente ou volte para editar o mapa.';
  $('start').textContent = 'JOGAR NOVAMENTE';
  $('start').hidden = false;
  syncMenuMusic();
  syncGameMusic();
  updateRescueUI();
}

function setupBuilder() {
  $('openBuilder').onclick = () => openWorkshop('mine');
  $('openGallery').onclick = () => openWorkshop('gallery');
  $('workshopClose').onclick = () => {
    $('workshop').hidden = true;
    showPanel('home');
  };
  $('mapsMine').onclick = () => {
    builder.tab = 'mine';
    void loadMapCards();
  };
  $('mapsPublic').onclick = () => {
    builder.tab = 'gallery';
    void loadMapCards();
  };
  $('mapsMore').onclick = () => loadMapCards(true);
  $('mapNew').onclick = () => openBuilderMap(newCustomMap());
  $('mapResumeDraft').onclick = () => {
    try {
      const d = JSON.parse(localStorage.getItem(builderProfileKey()) || 'null');
      if (!d) throw new Error('Não há rascunho neste aparelho para este nome.');
      openBuilderMap(d.map, d.mapId, d.revision);
    } catch (e) {
      $('workshopStatus').textContent = e.message;
    }
  };
  for (const [tool, label] of BUILDER_TOOLS) {
    const b = document.createElement('button');
    b.id = 'tool-' + tool;
    b.textContent = label;
    b.type = 'button';
    b.onclick = () => {
      builder.tool = tool;
      builderUpdateFields();
    };
    $('builderToolGrid').append(b);
  }
  for (const theme of PHASE_ORDER) {
    const o = document.createElement('option');
    o.value = theme;
    o.textContent = LEVEL_INFO[theme].name;
    $('builderTheme').append(o);
  }
  $('builderTitle').onchange = () => commitBuilderChange(m => (m.title = $('builderTitle').value));
  $('builderTheme').onchange = () => commitBuilderChange(m => (m.theme = $('builderTheme').value));
  for (const [id, key] of [
    ['builderWallColor', 'wallColor'],
    ['builderFloorColor', 'floorColor'],
    ['builderCeilingColor', 'ceilingColor'],
  ])
    $(id).onchange = () => commitBuilderChange(m => (m[key] = $(id).value));
  for (const [id, key] of [
    ['builderLight', 'brightness'],
    ['builderSpeed', 'monsterSpeed'],
  ])
    $(id).onchange = () => commitBuilderChange(m => (m[key] = Number($(id).value)));
  $('builderResetColors').onclick = () =>
    commitBuilderChange(m => {
      m.wallColor = m.floorColor = m.ceilingColor = '';
      m.floorPaint = {};
      m.wallPaint = {};
    });
  $('builderRotate').onclick = () => {
    builder.rotation = (builder.rotation + 1) % 4;
    builderMessage('Rotação: ' + builder.rotation * 90 + '°');
  };
  $('builderTools').onclick = () =>
    $('builderPalette').hidden ? openBuilderPalette() : closeBuilderPalette();
  $('builderPaletteClose').onclick = closeBuilderPalette;
  $('builderUndo').onclick = () => builderUndo();
  $('builderRedo').onclick = () => builderUndo(true);
  $('builderPlace').onclick = () => builderApply();
  $('builderErase').onclick = () => builderApply(true);
  $('builderSave').onclick = () => saveBuilder();
  $('builderPublish').onclick = () => saveBuilder(true);
  $('builderTest').onclick = testBuilder;
  $('builderLeave').onclick = () => openWorkshop('mine');
  $('builderReturn').onclick = returnToBuilder;
  $('customGalleryReturn').onclick = () => openWorkshop('gallery');
  window.addEventListener('beforeunload', e => {
    if (builder.editing && builder.dirty) {
      persistBuilderDraft();
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

export {
  builder,
  builderApply,
  builderUndo,
  closeBuilderPalette,
  drawBuilderAim,
  finishCustom,
  launchCustomMap,
  openBuilderPalette,
  openWorkshop,
  returnToBuilder,
  rgbHex,
  setupBuilder,
  updateBuilder,
};

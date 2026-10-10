import {
  createWorld,
  PHASE_ORDER,
  phaseFuseCount,
  BUILD_PROPS,
  newCustomMap,
  validateCustomMap,
  createCustomWorld,
} from './world.js';
('use strict');
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
const canvas = document.getElementById('view'),
  ctx = canvas.getContext('2d', { alpha: false }),
  $ = id => document.getElementById(id),
  W = matchMedia('(pointer:coarse)').matches ? 400 : 600,
  H = W * 0.6,
  N = 21;
canvas.width = W;
canvas.height = H;
let mapVisible = true,
  mapPaintedAt = -Infinity;
const MENU_SRC = 'menu.mp3',
  GAME_SRC = 'game.mp3';
function makeMusic(src, volume, id) {
  try {
    let audio = document.getElementById(id);
    if (!audio && document.body.insertAdjacentHTML) {
      document.body.insertAdjacentHTML(
        'beforeend',
        `<audio id="${id}" loop preload="auto"></audio>`,
      );
      audio = document.getElementById(id);
    }
    if (!audio && typeof Audio === 'function') audio = new Audio(src);
    if (!audio) return null;
    audio.src = src;
    audio.loop = true;
    audio.preload = 'auto';
    audio.volume = volume;
    return audio;
  } catch {
    return null;
  }
}
const menuMusic = makeMusic(MENU_SRC, 0.22, 'menuMusic'),
  gameMusic = makeMusic(GAME_SRC, 0.2, 'gameMusic');
function playMusic(audio) {
  if (audio && typeof audio.play === 'function') audio.play().catch(() => {});
}
function pauseMusic(audio) {
  if (audio && typeof audio.pause === 'function') audio.pause();
}
function syncMenuMusic() {
  if (!menuMusic) return;
  const inGame = document.body.classList.contains('playing');
  const shouldPlay = !inGame && !muted && $('nameGate').hidden;
  if (shouldPlay) {
    pauseMusic(gameMusic);
    playMusic(menuMusic);
  } else pauseMusic(menuMusic);
}
function syncGameMusic() {
  if (!gameMusic) return;
  const shouldPlay = document.body.classList.contains('playing') && !muted;
  if (shouldPlay) {
    pauseMusic(menuMusic);
    playMusic(gameMusic);
  } else pauseMusic(gameMusic);
}
const LEVEL_INFO = {
  glitch: { name: 'Backrooms Glitch · Ruptura', lamp: [115, 245, 239], ambient: 0.97 },
  'glitch-shift': {
    name: 'Backrooms Glitch · Memória perdida',
    lamp: [232, 143, 246],
    ambient: 0.95,
  },
  'glitch-past': { name: 'Backrooms Glitch · Seu passado', lamp: [240, 222, 168], ambient: 1.1 },
  custom: { name: 'Mapa da comunidade', lamp: [240, 237, 195], ambient: 1 },
  run: { name: 'CORRA PELA SUA VIDA!', lamp: [255, 65, 40], ambient: 0.82 },
  backrooms: { name: 'Backrooms', lamp: [220, 214, 166], ambient: 1 },
  poolrooms: { name: 'Poolrooms', lamp: [210, 244, 250], ambient: 1.24 },
  habitable: { name: 'Habitable Zone', lamp: [247, 248, 218], ambient: 1.22 },
  electrical: { name: 'Electrical Station', lamp: [241, 210, 112], ambient: 0.94 },
  level974: { name: 'Nível 974 · Casas', lamp: [255, 216, 231], ambient: 1.15 },
  office: { name: 'Nível 4 · Abandoned Office', lamp: [244, 250, 250], ambient: 1.16 },
  woodrooms: { name: 'Nível 27 · The Woodrooms', lamp: [239, 216, 155], ambient: 0.9 },
  fun: { name: 'Level Fun =)', lamp: [255, 238, 188], ambient: 1.1 },
  lurking: { name: 'Nível 1 · Lurking Danger', lamp: [173, 185, 171], ambient: 0.62 },
  courtyard: { name: 'Nível 188 · Courtyard of Windows', lamp: [209, 220, 225], ambient: 0.95 },
  level241: { name: 'Nível 241 · Turbinas', lamp: [215, 236, 233], ambient: 1.03 },
};
const MISSION_STORAGE = 'backrooms.missions.v1';
let globalSession = null,
  globalMessages = [],
  globalOnline = 0,
  globalBusy = false,
  globalTimer = null;
let chatOpen = false,
  chatSeen = new Set(),
  chatRoom = '',
  chatBusy = false,
  chatResume = false,
  chatPending = null,
  chatRendered = '';
let missionProfile = '',
  missionPending = {},
  missionTimer = null,
  missionSaving = null,
  explorerEntering = false;
let soloCampaignElapsed = 0,
  soloCompleted = 0;
let missionProgress = {},
  missionReturn = 'home',
  missionFilter = 'all',
  missionWon = false,
  leaderboardReturn = 'home';
function loadMissions(key = MISSION_STORAGE) {
  try {
    const data = JSON.parse(localStorage.getItem(key) || '{}');
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}
function missionValue(key) {
  const value = missionProgress[key];
  return Number.isFinite(value) && value >= 0 ? value : 0;
}
function rememberPending() {
  if (!missionProfile) return;
  try {
    localStorage.setItem('backrooms.pending.' + missionProfile, JSON.stringify(missionPending));
  } catch {}
}
function missionSet(key, value) {
  if (value <= missionValue(key)) return;
  missionProgress[key] = value;
  if (!missionProfile) return;
  missionPending[key] = value;
  rememberPending();
  clearTimeout(missionTimer);
  missionTimer = setTimeout(() => {
    void flushMissions().catch(() => {});
  }, 700);
}
async function flushMissions() {
  if (missionSaving) {
    await missionSaving;
    if (Object.keys(missionPending).length) return flushMissions();
    return;
  }
  if (!missionProfile || !Object.keys(missionPending).length) return;
  const profile = missionProfile;
  missionSaving = (async () => {
    while (Object.keys(missionPending).length) {
      const progress = Object.fromEntries(Object.entries(missionPending).slice(0, 30));
      const result = await requestRoom('save', { name: profile, progress }, '/api/profiles/');
      for (const [key, value] of Object.entries(progress))
        if (missionPending[key] === value) delete missionPending[key];
      for (const [key, value] of Object.entries(result.progress))
        missionProgress[key] = Math.max(missionValue(key), value);
      rememberPending();
    }
    $('explorerWelcome').textContent = 'Explorador: ' + $('nickname').value;
  })();
  try {
    await missionSaving;
  } catch (error) {
    $('explorerWelcome').textContent = 'Missões aguardando conexão para salvar.';
    clearTimeout(missionTimer);
    missionTimer = setTimeout(() => {
      void flushMissions().catch(() => {});
    }, 4000);
    throw error;
  } finally {
    missionSaving = null;
  }
}
function missionAdd(key) {
  missionSet(key, missionValue(key) + 1);
}
let movementTrail = [],
  movementOrdinal = 0,
  movementSentOrdinal = 0,
  movementAnchor = { x: 1.5, y: 1.5 },
  movementWaiting = false;
let selectedMode = 'normal',
  activeMode = 'normal',
  modeBusy = false,
  smile = null;
let selectedLevel = 'backrooms',
  activeLevel = 'backrooms',
  levelBusy = false;
let padSensitivity = 1,
  padLookSmooth = { x: 0, y: 0 },
  padMenuNeutral = false,
  padNavDirection = '';
const touchMove = { x: 0, y: 0, pointer: null };
let walkMotion = { forward: 0, side: 0, phase: 0, bob: 0 };
function resetMotion() {
  resetJoystick();
  walkMotion.forward = 0;
  walkMotion.side = 0;
  walkMotion.bob = 0;
  walkMotion.phase = 0;
}
function smoothWalk(forward, side, speed, dt) {
  const length = Math.max(1, Math.hypot(forward, side)),
    tau = 0.065,
    decay = Math.exp(-dt / tau);
  const targetF = (forward / length) * speed,
    targetS = (side / length) * speed;
  // Exact exponential integration keeps travel consistent across refresh rates.
  const df = targetF * dt + (walkMotion.forward - targetF) * tau * (1 - decay);
  const ds = targetS * dt + (walkMotion.side - targetS) * tau * (1 - decay);
  const active = !!(forward || side),
    x = player.x,
    y = player.y;
  walkMotion.forward = active ? targetF + (walkMotion.forward - targetF) * decay : 0;
  walkMotion.side = active ? targetS + (walkMotion.side - targetS) * decay : 0;
  if (active) {
    const dx = Math.cos(player.a) * df - Math.sin(player.a) * ds,
      dy = Math.sin(player.a) * df + Math.cos(player.a) * ds;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 0.04));
    for (let i = 0; i < steps; i++) move(player, dx / steps, dy / steps);
  }
  const distance = Math.hypot(player.x - x, player.y - y);
  walkMotion.phase += distance * 4.8;
  walkMotion.bob += ((distance > 0.00001 ? 0.9 : 0) - walkMotion.bob) * (1 - Math.exp(-dt / 0.09));
}
let padInput = { x: 0, y: 0, lookX: 0, lookY: 0, run: false },
  padActive = false,
  padIndex = -1,
  padPrevious = [],
  padNavNext = 0,
  padEditor = null,
  viewPitch = 0;
let coins = [],
  coinBalance = 0,
  reviveBusy = false,
  soloProtectedUntil = 0,
  soloEnemySpawn = null;
let grid = [],
  player,
  enemy,
  fuses,
  exit,
  state = 'ready',
  elapsed = 0,
  stamina = 100,
  light = true,
  muted = false,
  keys = {},
  pathTimer = 0,
  enemyPath = [],
  msgTime = 0,
  audio,
  gain,
  osc,
  stepTimer = 0;
const frame = ctx.createImageData(W, H),
  pixels = frame.data,
  zbuf = new Float32Array(W),
  tex = [];
function makeTextures(level) {
  tex.length = 0;
  for (let t = 0; t < 3; t++) {
    const a = new Uint8Array(64 * 64 * 3);
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++) {
        let n = ((x * 73 + y * 173 + x * y * 7) % 23) - 11,
          base,
          detail = 0;
        if (level.startsWith('glitch')) {
          const past = level === 'glitch-past',
            shift = level === 'glitch-shift';
          base =
            t === 0
              ? past
                ? [184, 171, 105]
                : shift
                  ? [111, 88, 147]
                  : [85, 147, 149]
              : t === 1
                ? [59, 61, 58]
                : [108, 115, 108];
          n *= 0.4;
          detail = t === 0 ? (x % 16 === 0 ? -18 : Math.sin(x * 0.7) * 4) : y % 16 === 0 ? -12 : 0;
          const block = ((x >> 3) * 7 + (y >> 2) * 13) % 19;
          if ((!past && block < 3) || (past && block === 0 && y < 12)) {
            base = block % 2 ? [172, 70, 153] : [68, 189, 181];
            detail = y % 4 === 0 ? -35 : 0;
          }
          if (t === 0 && y > 58) base = [42, 43, 39];
        } else if (level === 'poolrooms') {
          base = t === 0 ? [197, 222, 218] : t === 1 ? [51, 158, 180] : [188, 211, 209];
          detail = x % 16 < 1 || y % 16 < 1 ? -32 : 0;
          if (t === 0 && y > 48) base = [84, 170, 185];
          if (t === 1) detail += Math.sin(x * 0.4 + y * 0.22) * 12;
          n *= 0.35;
        } else if (level === 'habitable') {
          base = t === 0 ? [167, 167, 161] : t === 1 ? [104, 108, 106] : [146, 150, 147];
          n *= 0.45;
          if (t === 0) {
            const brickX = (x + (Math.floor(y / 8) % 2) * 16) % 32;
            detail = y % 8 === 0 || brickX === 0 ? -17 : 0;
            if (y > 59) {
              base = [71, 75, 72];
              detail = 0;
            }
          }
          if (t === 1) {
            detail = x === 0 || y === 0 ? -25 : 0;
            if (x > 5 && x < 59 && y > 9 && y < 55) detail -= 8;
            if (((x === 5 || x === 58) && y > 9 && y < 55) || (y === 10 && x > 5 && x < 59))
              detail = -26;
          }
          if (t === 2) detail = x % 16 === 0 || y % 16 === 0 ? -13 : 0;
        } else if (level === 'electrical') {
          base = t === 0 ? [121, 69, 43] : t === 1 ? [123, 117, 92] : [94, 89, 67];
          if (t === 0) {
            const row = Math.floor(y / 9),
              brickX = (x + (row % 2) * 16) % 32;
            const variation = ((Math.floor((x + (row % 2) * 16) / 32) * 17 + row * 11) % 25) - 12;
            detail = variation;
            if (y % 9 < 1 || brickX < 1) {
              base = [93, 91, 70];
              detail = 0;
            }
            if (y > 58) {
              base = [35, 36, 28];
              detail = 0;
            }
            if (y === 4 || y === 7) {
              base = [140, 126, 78];
              detail = 0;
            }
          } else {
            detail = Math.sin(x * 0.24 + y * 0.11) * 8 + Math.sin(y * 0.37 - x * 0.15) * 6;
            n *= 0.65;
            if (t === 1 && (x === 0 || y === 0)) detail -= 10;
          }
        } else if (level === 'office') {
          base = t === 0 ? [206, 203, 193] : t === 1 ? [158, 62, 66] : [191, 184, 180];
          n *= 0.38;
          if (t === 0) {
            detail = x === 0 ? -12 : 0;
            if (y > 59) base = [106, 101, 97];
          }
          if (t === 1) {
            detail = (x + y) % 2 === 0 ? 6 : -4;
            detail += Math.sin(x * 0.18 + y * 0.13) * 4;
          }
          if (t === 2) detail = x % 32 === 0 || y % 32 === 0 ? -27 : 0;
        } else if (level === 'woodrooms') {
          base = t === 0 ? [117, 76, 39] : t === 1 ? [86, 82, 61] : [139, 119, 78];
          if (t === 0) {
            detail = x % 8 < 1 ? -45 : Math.sin(x * 2 + y * 0.07) * 10;
            if (y > 57) detail = -30;
          }
          if (t === 1) detail = ((x * 3 + y * 5) % 7) - 3;
          if (t === 2) detail = x % 32 === 0 || y % 32 === 0 ? -35 : 0;
        } else if (level === 'fun') {
          base = t === 0 ? [184, 117, 88] : t === 1 ? [208, 96, 145] : [142, 132, 96];
          n *= 0.25;
          if (t === 0 && y > 58) base = [133, 82, 64];
          if (t === 2) detail = Math.sin(x * 0.08 + y * 0.13) * 5;
        } else if (level === 'lurking') {
          base = t === 0 ? [111, 116, 106] : t === 1 ? [82, 85, 77] : [88, 94, 87];
          detail = t === 0 && (x === 0 || y === 0) ? -25 : 0;
          if (t === 0 && y > 48) {
            base = [126, 118, 75];
            detail = (x + y) % 20 < 10 ? -45 : 0;
          }
          if (t === 1) detail = x % 32 === 0 || y % 32 === 0 ? -18 : 0;
        } else if (level === 'run') {
          base = t === 0 ? [126, 32, 26] : t === 1 ? [61, 52, 49] : [49, 25, 25];
          detail = t === 0 && y > 24 && y < 32 ? 60 : t === 1 && x % 16 < 2 ? 22 : 0;
          if (t === 0 && y > 47) base = [59, 34, 28];
        } else if (level === 'courtyard') {
          base = t === 0 ? [167, 163, 147] : t === 1 ? [63, 82, 45] : [119, 145, 164];
          n *= 0.5;
          if (t === 0) {
            const xx = x % 32,
              yy = y % 16;
            detail = yy === 0 ? -32 : 0;
            if (xx > 6 && xx < 26 && yy > 3 && yy < 13) {
              base = [51, 66, 72];
              detail = xx === 16 ? 62 : 0;
              if ((Math.floor(y / 16) + Math.floor(x / 32)) % 3 === 0) base = [163, 177, 159];
            }
          }
          if (t === 1) detail = x % 32 < 3 || y % 32 < 3 ? 38 : 0;
        } else if (level === 'level974' || level === 'level241') {
          base = t === 0 ? [241, 232, 200] : t === 1 ? [97, 124, 54] : [151, 184, 221];
          if (t === 0) {
            n *= 0.2;
            detail = y % 8 === 0 ? -10 : 0;
            const window = (x > 8 && x < 24) || (x > 39 && x < 55);
            if (window && ((y > 9 && y < 26) || (y > 36 && y < 53))) {
              base = [33, 43, 44];
              detail = x % 8 === 0 || y % 8 === 0 ? 115 : 0;
            }
            if (x > 27 && x < 36 && y > 39) {
              base = [103, 90, 72];
              detail = 0;
            }
            if (level === 'level241') {
              base = [173, 184, 169];
              detail = x % 8 === 0 ? -30 : 0;
            }
          }
          if (t === 1) {
            detail = ((x * 17 + y * 31) % 13) - 6;
            n *= 1.8;
          }
        } else {
          base = t === 0 ? [164, 150, 78] : t === 1 ? [105, 95, 58] : [133, 129, 100];
          detail =
            t === 0
              ? Math.cos(x * 0.6) * Math.sin(y * 0.3) > 0.55
                ? -15
                : 0
              : t === 2
                ? x === 0 || y === 0
                  ? -38
                  : 0
                : 0;
        }
        for (let c = 0; c < 3; c++)
          a[(y * 64 + x) * 3 + c] = Math.max(0, Math.min(255, base[c] + n + detail));
      }
    tex.push(a);
  }
}
makeTextures('backrooms');
let seed = 93451;
function rand() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}
function solid(x, y) {
  return !grid[Math.floor(y)] || grid[Math.floor(y)][Math.floor(x)] !== 0;
}
function route(sx, sy, tx, ty) {
  const queue = [[sx, sy]],
    seen = new Map([[sx + ',' + sy, null]]);
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i];
    if (x === tx && y === ty) {
      let out = [],
        k = [x, y];
      while (k) {
        out.unshift(k);
        k = seen.get(k.join(','));
      }
      return out;
    }
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      let a = x + dx,
        b = y + dy,
        key = a + ',' + b;
      if (!solid(a, b) && !seen.has(key)) {
        seen.set(key, [x, y]);
        queue.push([a, b]);
      }
    }
  }
  return [];
}
function reset(
  worldSeed = Math.floor(Math.random() * 4294967296),
  level = selectedLevel,
  mode = selectedMode,
) {
  resetMotion();
  missionWon = false;
  activeMode = mode === 'hardcore' ? 'hardcore' : 'normal';
  resetLevelMap();
  activeLevel = LEVEL_INFO[level] ? level : 'backrooms';
  makeTextures(activeLevel);
  $('levelLabel').textContent = LEVEL_INFO[activeLevel].name.toUpperCase();
  $('levelLabel').textContent =
    (PHASE_ORDER.includes(activeLevel)
      ? 'FASE ' + (PHASE_ORDER.indexOf(activeLevel) + 1) + ' / ' + PHASE_ORDER.length
      : 'MAPA ADMIN') +
    ' · ' +
    LEVEL_INFO[activeLevel].name.toUpperCase();
  const world = createWorld(worldSeed, activeLevel);
  grid = world.grid;
  player = world.spawn;
  enemy = world.enemy;
  smile = activeMode === 'hardcore' ? { ...world.smile } : null;
  exit = world.exit;
  fuses = world.fuses;
  coins = activeMode === 'hardcore' ? [] : world.coins;
  coinBalance = 0;
  soloProtectedUntil = 0;
  soloEnemySpawn = { ...world.enemy };
  elapsed = 0;
  stamina = 100;
  enemyPath = [];
  pathTimer = 0;
  light = true;
  viewPitch = 0;
  keys = {};
  resetMovementTrail();
  updateHud();
  updateRescueUI();
  updateModeUI();
  if (activeLevel === 'run')
    say('CORRA! Fôlego infinito. O monstro começa a perseguir em 6 segundos.');
}
function phaseIntro(level) {
  return level === 'glitch'
    ? 'BACKROOMS GLITCH · Pegue 1 fusível e atravesse a saída.'
    : level === 'glitch-shift'
      ? 'A realidade quebrou. Pegue 5 fusíveis para abrir o caminho ao passado.'
      : level === 'glitch-past'
        ? 'Você voltou ao seu passado. Pegue 3 fusíveis e volte ao mundo normal.'
        : level === 'run'
          ? 'CORRA! Fôlego infinito. A perseguição começa em 6 segundos!'
          : 'FASE ' +
            (PHASE_ORDER.indexOf(level) + 1) +
            ' / ' +
            PHASE_ORDER.length +
            ' · ' +
            LEVEL_INFO[level].name;
}
function updateHud() {
  const n = fuses.filter(f => f.taken).length,
    total = fuses.length,
    done = n === total;
  $('count').textContent = n + ' / ' + total;
  document.querySelectorAll('.slots i').forEach((e, i) => {
    e.hidden = i >= total;
    e.classList.toggle('on', i < n);
  });
  $('objective').textContent =
    activeLevel === 'run'
      ? done
        ? 'CORRA ATÉ A SAÍDA!'
        : 'CORRA! 3 FUSÍVEIS NO CAMINHO'
      : done
        ? activeLevel === 'glitch-past'
          ? 'VOLTE AO MUNDO NORMAL'
          : activeLevel === 'glitch-shift'
            ? 'ATRAVESSE PARA O PASSADO'
            : 'ENCONTRE A PORTA VERDE'
        : activeLevel === 'glitch-past'
          ? 'SEU PASSADO · ENCONTRE OS FUSÍVEIS'
          : 'ENCONTRE OS FUSÍVEIS';
}
function say(text) {
  $('notice').textContent = text;
  msgTime = 4;
}
function initAudio() {
  try {
    if (!audio) {
      audio = new (window.AudioContext || window.webkitAudioContext)();
      gain = audio.createGain();
      gain.gain.value = 0.025;
      gain.connect(audio.destination);
      osc = audio.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 60;
      let filter = audio.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 160;
      osc.connect(filter);
      filter.connect(gain);
      osc.start();
    }
    audio.resume();
  } catch {}
}
function tone(freq, dur, vol = 0.07) {
  if (!audio || muted) return;
  let o = audio.createOscillator(),
    g = audio.createGain();
  o.frequency.value = freq;
  o.type = 'sine';
  g.gain.setValueAtTime(vol, audio.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + dur);
  o.connect(g);
  g.connect(audio.destination);
  o.start();
  o.stop(audio.currentTime + dur);
}
function lock() {
  if (padActive) return;
  if (!matchMedia('(pointer:coarse)').matches) {
    try {
      const p = canvas.requestPointerLock?.();
      p?.catch(() => say('Use as setas ← → para olhar.'));
    } catch {}
  }
}
function start() {
  if (builder.custom) {
    if (builder.editing) {
      closeBuilderPalette();
      return;
    }
    if (state === 'lost' || state === 'won') {
      launchCustomMap(builder.custom, builder.testing);
      return;
    }
    state = 'playing';
    document.body.classList.add('playing');
    syncGameMusic();
    syncMenuMusic();
    lock();
    return;
  }
  void enterLandscape();
  if (net) {
    playMusic(gameMusic);
    resumeOnline();
    return;
  }
  if (state === 'ready' || state === 'won') {
    soloCampaignElapsed = 0;
    soloCompleted = 0;
  }
  if (state === 'ready' || state === 'won' || state === 'lost')
    reset(undefined, state === 'lost' ? activeLevel : PHASE_ORDER[0], selectedMode);
  state = 'playing';
  document.body.classList.add('playing');
  playMusic(gameMusic);
  syncMenuMusic();
  syncGameMusic();
  initAudio();
  lock();
  say('Procure o brilho âmbar dos fusíveis. A coleta é automática.');
}
function pause() {
  if (builder.editing) {
    openBuilderPalette();
    return;
  }
  if (state !== 'playing') return;
  resetMotion();
  touchLookPointer = null;
  touchX = null;
  padMenuNeutral = padActive;
  padLookSmooth = { x: 0, y: 0 };
  state = 'paused';
  keys = {};
  document.body.classList.remove('playing');
  syncMenuMusic();
  syncGameMusic();
  document.exitPointerLock?.();
  $('story').textContent = 'Respire. Você ainda está aqui.';
  $('details').textContent = 'O jogo está pausado.';
  $('start').innerHTML = 'CONTINUAR';
  $('details').textContent = net
    ? 'O menu está aberto, mas a partida online continua.'
    : 'O jogo está pausado.';
  showPanel('pause');
}
function finish(win) {
  if (builder.custom) {
    finishCustom(win);
    return;
  }
  resetMotion();
  keys = {};
  touchX = null;
  touchLookPointer = null;
  if (win) recordMissionWin();
  if (win && !net) {
    const next = PHASE_ORDER[PHASE_ORDER.indexOf(activeLevel) + 1];
    if (next) {
      const mode = activeMode;
      reset(undefined, next, mode);
      state = 'playing';
      document.body.classList.add('playing');
      say(phaseIntro(next));
      return;
    }
  }
  showPanel('pause');
  state = win ? 'won' : 'lost';
  document.body.classList.remove('playing');
  syncMenuMusic();
  syncGameMusic();
  document.exitPointerLock?.();
  $('story').textContent = win ? 'Você encontrou o caminho de volta.' : 'Você não estava sozinho.';
  $('details').textContent = win
    ? 'Escapou com os 3 fusíveis em ' +
      Math.floor(elapsed / 60) +
      'min ' +
      Math.floor(elapsed % 60) +
      's.'
    : 'A criatura encontrou você. Corra com Shift e mantenha distância.';
  $('start').hidden = false;
  $('start').textContent = net ? 'VOLTAR À SALA' : win ? 'JOGAR NOVAMENTE' : 'TENTAR NOVAMENTE';
  if (win) {
    $('story').textContent = 'Você voltou ao mundo normal!';
    $('details').textContent =
      'O passado ficou para trás. Backrooms Glitch concluída! Tempo total: ' +
      formatLeaderboardTime(soloCampaignElapsed * 1000) +
      '';
  }
  tone(win ? 520 : 70, 0.7, 0.13);
  updateRescueUI();
}
function move(body, dx, dy) {
  let r = 0.19;
  if (
    !solid(body.x + dx + Math.sign(dx) * r, body.y - r) &&
    !solid(body.x + dx + Math.sign(dx) * r, body.y + r)
  )
    body.x += dx;
  if (
    !solid(body.x - r, body.y + dy + Math.sign(dy) * r) &&
    !solid(body.x + r, body.y + dy + Math.sign(dy) * r)
  )
    body.y += dy;
}
function update(dt) {
  if (builder.editing) {
    updateBuilder(dt);
    return;
  }
  if (chatOpen || state !== 'playing') {
    resetMotion();
    return;
  }
  if (net && (!net.connected || net.dead)) {
    resetMotion();
    return;
  }
  trackMissions();
  elapsed += dt;
  if (!net) soloCampaignElapsed += dt;
  msgTime -= dt;
  if (msgTime <= 0) $('notice').textContent = '';
  let forward = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0),
    side = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  if (padInput.x || padInput.y) {
    forward = -padInput.y;
    side = padInput.x;
  }
  if (touchMove.pointer !== null) {
    forward = -touchMove.y;
    side = touchMove.x;
  }
  const blend = 1 - Math.exp(-dt / 0.055);
  padLookSmooth.x =
    padInput.lookX === 0 ? 0 : padLookSmooth.x + (padInput.lookX - padLookSmooth.x) * blend;
  padLookSmooth.y =
    padInput.lookY === 0 ? 0 : padLookSmooth.y + (padInput.lookY - padLookSmooth.y) * blend;
  player.a += padLookSmooth.x * dt * 1.85 * padSensitivity;
  viewPitch = Math.max(
    -H * 0.24,
    Math.min(H * 0.24, viewPitch - padLookSmooth.y * dt * 95 * padSensitivity),
  );
  player.a += ((keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0)) * dt * 1.9;
  let moving = forward || side,
    run = (keys.ShiftLeft || padInput.run) && stamina > 1 && moving,
    speed = run ? 3.1 : 1.85;
  stamina =
    activeLevel === 'run' ? 100 : Math.max(0, Math.min(100, stamina + dt * (run ? -24 : 15)));
  smoothWalk(forward, side, speed, dt);
  recordMovement();
  if (moving) {
    stepTimer -= dt;
    if (stepTimer < 0) {
      tone(75 + rand() * 25, 0.08, 0.035);
      stepTimer = run ? 0.24 : 0.4;
    }
  }
  if (!net) {
    for (const coin of coins) if (coin.taken && elapsed >= coin.respawnAt) coin.taken = false;
    for (const coin of coins)
      if (!coin.taken && Math.hypot(coin.x - player.x, coin.y - player.y) < 0.55) {
        coin.taken = true;
        coin.respawnAt = elapsed + 10;
        coinBalance++;
        tone(1000, 0.08, 0.035);
        updateRescueUI();
        if (coinBalance === 25) say('25 moedas! Aperte V se precisar reviver.');
      }
    for (const f of fuses)
      if (!f.taken && Math.hypot(f.x - player.x, f.y - player.y) < 0.65) {
        f.taken = true;
        updateHud();
        tone(700, 0.2);
        say(
          fuses.every(f => f.taken)
            ? 'Energia restaurada. Encontre a porta verde!'
            : 'Fusível coletado. Continue explorando.',
        );
      }
    let n = fuses.filter(f => f.taken).length;
    if (Math.hypot(player.x - exit.x, player.y - exit.y) < 0.7) {
      if (n === fuses.length) {
        finish(true);
        return;
      }
      say('Colete todos os fusíveis desta fase para abrir a saída.');
    }
    if (elapsed > (activeLevel === 'run' ? 6 : 22)) {
      for (const foe of builder.custom
        ? [enemy, smile].filter(Boolean)
        : activeMode === 'hardcore'
          ? [enemy, smile]
          : [enemy]) {
        if (!foe) continue;
        if (!foe.path?.length) {
          foe.path = route(
            Math.floor(foe.x),
            Math.floor(foe.y),
            Math.floor(player.x),
            Math.floor(player.y),
          ).slice(1);
        }
        let remaining =
          dt *
          (builder.custom
            ? builder.custom.monsterSpeed
            : activeLevel === 'run'
              ? foe.type === 'smile'
                ? 2.5
                : 2.65
              : (foe.type === 'smile' ? 0.7 : 0.75) + n * 0.15);
        while (remaining > 0 && foe.path.length) {
          let target = foe.path[0],
            dx = target[0] + 0.5 - foe.x,
            dy = target[1] + 0.5 - foe.y,
            d = Math.hypot(dx, dy);
          if (d < 0.001) {
            foe.path.shift();
            continue;
          }
          let step = Math.min(remaining, d);
          foe.x += (dx / d) * step;
          foe.y += (dy / d) * step;
          remaining -= step;
          if (step === d) {
            foe.path = route(
              Math.floor(foe.x),
              Math.floor(foe.y),
              Math.floor(player.x),
              Math.floor(player.y),
            ).slice(1);
          } else break;
        }
        let distance = Math.hypot(player.x - foe.x, player.y - foe.y);
        if (distance < 0.42 && elapsed >= soloProtectedUntil) {
          finish(false);
          return;
        }
        if (distance < 4 && msgTime <= 0)
          say(
            foe.type === 'smile'
              ? 'Um sorriso brilha na escuridão…'
              : 'Você escuta passos perto de você…',
          );
      }
    }
  }
  trackMissions();
  $('energy').style.width = stamina + '%';
  const clockText =
    String(Math.floor(elapsed / 60)).padStart(2, '0') +
    ':' +
    String(Math.floor(elapsed % 60)).padStart(2, '0');
  if ($('clock').textContent !== clockText) $('clock').textContent = clockText;
}
function render(now) {
  const ca = Math.cos(player.a),
    sa = Math.sin(player.a),
    px = -sa * 0.72,
    py = ca * 0.72,
    bob = state === 'playing' ? Math.sin(walkMotion.phase) * walkMotion.bob : 0,
    horizon = H / 2 + bob + viewPitch,
    outdoor =
      activeLevel === 'level974' || activeLevel === 'level241' || activeLevel === 'courtyard';
  for (let y = 0; y < H; y++) {
    let floor = y > horizon,
      dist = (H * 0.5) / Math.max(1, Math.abs(y - horizon)),
      t = tex[floor ? 1 : 2];
    for (let x = 0; x < W; x++) {
      let cam = (2 * x) / W - 1,
        wx = player.x + dist * (ca + px * cam),
        wy = player.y + dist * (sa + py * cam),
        tx = Math.floor(wx * 64) & 63,
        ty = Math.floor(wy * 64) & 63,
        idx = (ty * 64 + tx) * 3,
        ix = (y * W + x) * 4,
        brightness = Math.max(0.14, 0.85 / (1 + dist * 0.16)) * LEVEL_INFO[activeLevel].ambient;
      if (outdoor && !floor) {
        const sky = y / Math.max(1, horizon);
        const hill =
          8 + 9 * Math.sin(player.a * 3 + (x / W) * 3) + 5 * Math.sin(player.a * 7 + (x / W) * 7);
        const green = y > horizon - hill;
        pixels[ix] = green ? 95 : 126 + sky * 34;
        pixels[ix + 1] = green ? 124 : 165 + sky * 32;
        pixels[ix + 2] = green ? 64 : 213 + sky * 15;
        pixels[ix + 3] = 255;
        continue;
      }
      if (outdoor) brightness = 0.72;
      if (builder.custom) {
        brightness = Math.min(
          1.2,
          ((floor ? 0.82 : 0.72) * builder.custom.brightness) / (1 + dist * 0.06),
        );
        const color = floor
          ? builder.colors.floors[Math.floor(wx) + ',' + Math.floor(wy)] || builder.colors.floor
          : builder.colors.ceiling;
        if (color) {
          const grain = 0.92 + (t[idx] % 20) / 200;
          pixels[ix] = color[0] * brightness * grain;
          pixels[ix + 1] = color[1] * brightness * grain;
          pixels[ix + 2] = color[2] * brightness * grain;
          pixels[ix + 3] = 255;
          continue;
        }
      }
      if (activeLevel === 'habitable') {
        brightness = (floor ? 0.68 : 0.82) / (1 + dist * 0.045);
        // Light concrete beams span the ceiling between rows of columns.
        if (
          !floor &&
          ((Math.floor(wx) % 4 === 0 && tx < 21) || (Math.floor(wy) % 4 === 0 && ty < 21))
        ) {
          const recess = tx % 12 < 7 && ty % 12 < 7 ? -28 : 0;
          pixels[ix] = (185 + recess) * brightness;
          pixels[ix + 1] = (185 + recess) * brightness;
          pixels[ix + 2] = (174 + recess) * brightness;
          pixels[ix + 3] = 255;
          continue;
        }
      }
      if (activeLevel === 'fun') {
        brightness = (floor ? 0.91 : 0.65) / (1 + dist * 0.045);
        if (floor) {
          const colors = [
            [225, 176, 53],
            [213, 59, 132],
            [83, 168, 178],
            [117, 69, 157],
            [213, 103, 67],
          ];
          const color = colors[(((Math.floor(wx / 3) + Math.floor(wy / 3) * 2) % 5) + 5) % 5];
          const seam =
            Math.abs(wx - Math.round(wx)) < 0.015 || Math.abs(wy - Math.round(wy)) < 0.015
              ? 0.9
              : 1;
          pixels[ix] = color[0] * brightness * seam;
          pixels[ix + 1] = color[1] * brightness * seam;
          pixels[ix + 2] = color[2] * brightness * seam;
          pixels[ix + 3] = 255;
          continue;
        }
      }
      if (activeLevel === 'electrical' && !floor && (tx < 3 || tx > 59 || ty < 2)) {
        pixels[ix] = 20;
        pixels[ix + 1] = 21;
        pixels[ix + 2] = 16;
        pixels[ix + 3] = 255;
        continue;
      }
      let ceilingLight =
        activeLevel !== 'electrical' &&
        activeLevel !== 'habitable' &&
        !floor &&
        Math.floor(wx) % 3 === 1 &&
        Math.floor(wy) % 3 === 1 &&
        tx > 12 &&
        tx < 52 &&
        ty > 22 &&
        ty < 42;
      if (ceilingLight) {
        const lamp = LEVEL_INFO[activeLevel].lamp;
        pixels[ix] = lamp[0];
        pixels[ix + 1] = lamp[1];
        pixels[ix + 2] = lamp[2];
      } else {
        if (activeLevel === 'poolrooms' && floor) {
          brightness += Math.sin((tx + ty) * 0.19 + now * 0.0018) * 0.07;
        }
        pixels[ix] = t[idx] * brightness;
        pixels[ix + 1] = t[idx + 1] * brightness;
        pixels[ix + 2] = t[idx + 2] * brightness;
      }
      pixels[ix + 3] = 255;
    }
  }
  for (let x = 0; x < W; x++) {
    let cam = (2 * x) / W - 1,
      rx = ca + px * cam,
      ry = sa + py * cam,
      mx = Math.floor(player.x),
      my = Math.floor(player.y),
      ddx = Math.abs(1 / rx),
      ddy = Math.abs(1 / ry),
      sx = rx < 0 ? -1 : 1,
      sy = ry < 0 ? -1 : 1,
      sdx = (rx < 0 ? player.x - mx : mx + 1 - player.x) * ddx,
      sdy = (ry < 0 ? player.y - my : my + 1 - player.y) * ddy,
      side = 0;
    for (let i = 0; i < 80; i++) {
      if (sdx < sdy) {
        sdx += ddx;
        mx += sx;
        side = 0;
      } else {
        sdy += ddy;
        my += sy;
        side = 1;
      }
      if (!grid[my] || (grid[my][mx] !== 0 && grid[my][mx] !== 2)) break;
    }
    let d = Math.max(0.01, side ? sdy - ddy : sdx - ddx);
    zbuf[x] = d;
    let wall = side ? player.x + d * rx : player.y + d * ry,
      tx = Math.floor((wall - Math.floor(wall)) * 64),
      height = H / d,
      top = horizon - height / 2,
      bottom = horizon + height / 2,
      t = tex[0];
    if (activeLevel === 'courtyard') {
      height *= 3;
      top = bottom - height;
    }
    const boundary =
      outdoor && activeLevel !== 'courtyard' && (mx === 0 || my === 0 || mx === 20 || my === 20);
    if (boundary) {
      top = bottom - height * 0.28;
    }
    for (let y = Math.max(0, Math.floor(top)); y < Math.min(H, bottom); y++) {
      let ty = Math.min(63, Math.max(0, Math.floor(((y - top) / height) * 64))),
        idx = (ty * 64 + tx) * 3,
        ix = (y * W + x) * 4;
      let beam = light ? (Math.max(0, 1 - Math.abs(cam) * 1.5) * 0.46) / (1 + d * 0.14) : 0,
        b = Math.min(
          1.12,
          ((side ? 0.65 : 0.78) * LEVEL_INFO[activeLevel].ambient) / (1 + d * 0.12) + beam,
        );
      if (activeLevel === 'habitable') {
        b = Math.min(1.12, (side ? 0.78 : 0.94) / (1 + d * 0.055) + beam * 0.3);
        // Vertical warm-white fixtures on column faces stay luminous at distance.
        if (
          mx > 0 &&
          mx < 20 &&
          my > 0 &&
          my < 20 &&
          mx % 4 === 0 &&
          my % 4 === 0 &&
          tx >= 27 &&
          tx <= 38 &&
          ty >= 7 &&
          ty <= 34
        ) {
          const rim = tx < 29 || tx > 36 || ty < 9 || ty > 32;
          pixels[ix] = rim ? 206 : 255;
          pixels[ix + 1] = rim ? 201 : 255;
          pixels[ix + 2] = rim ? 143 : 224;
          continue;
        }
      }
      if (activeLevel === 'electrical' && (mx + my) % 7 === 0 && ty > 9 && ty < 58) {
        // Recessed barred service panels on selected walls.
        const bar = tx % 10 < 2 || ty === 17 || ty === 46;
        pixels[ix] = (bar ? 116 : 20) * b;
        pixels[ix + 1] = (bar ? 99 : 22) * b;
        pixels[ix + 2] = (bar ? 56 : 17) * b;
        continue;
      }
      if (builder.custom) {
        b = Math.min(1.15, b * builder.custom.brightness);
        const color = builder.colors.walls[mx + ',' + my] || builder.colors.wall;
        if (color) {
          const grain = 0.9 + (t[idx] % 25) / 180;
          pixels[ix] = color[0] * b * grain;
          pixels[ix + 1] = color[1] * b * grain;
          pixels[ix + 2] = color[2] * b * grain;
          continue;
        }
      }
      if (ty > 59) b *= 0.55;
      if (boundary) {
        const rail = (ty > 49 && ty < 53) || (ty > 59 && ty < 62);
        if (tx % 12 < 4 || rail) {
          pixels[ix] = 210;
          pixels[ix + 1] = 217;
          pixels[ix + 2] = 195;
        }
      } else {
        pixels[ix] = t[idx] * b;
        pixels[ix + 1] = t[idx + 1] * b;
        pixels[ix + 2] = t[idx + 2] * b;
      }
    }
  }
  if (
    builder.custom ||
    activeLevel === 'fun' ||
    activeLevel === 'office' ||
    activeLevel === 'level974' ||
    activeLevel === 'level241'
  )
    drawPyramidRoofs(ca, sa, horizon);
  ctx.putImageData(frame, 0, 0);
  let objects = [
    ...(activeLevel === 'electrical'
      ? [
          [2.5, 2.5],
          [9.5, 2.5],
          [16, 2.5],
          [2.5, 6.5],
          [9.5, 6.5],
          [16, 6.5],
          [2.5, 10],
          [9.5, 10],
          [16, 10],
          [2.5, 14],
          [9.5, 14],
          [16, 14],
          [2.5, 18],
          [9.5, 18],
          [16, 18],
        ].map(([x, y]) => ({ x, y, type: 'industrialLamp' }))
      : []),
    ...(activeLevel === 'level241'
      ? [
          [4.5, 4.5],
          [10.5, 4.5],
          [16.5, 5.5],
          [4.5, 10.5],
          [10.5, 10.5],
          [17.5, 12.5],
          [3.5, 17.5],
          [11.5, 17.5],
          [17.5, 17.5],
        ].map(([x, y]) => ({ x, y, type: 'turbine' }))
      : []),
    ...(builder.editing
      ? [{ ...builder.map.spawn, type: 'player', name: 'INÍCIO', color: '#75dbc5' }]
      : []),
    ...coins.filter(c => !c.taken),
    ...fuses.filter(f => !f.taken),
    ...(builder.custom && !builder.custom.exit ? [] : [exit]),
    ...(builder.editing || elapsed > (activeLevel === 'run' ? 6 : 22)
      ? builder.custom
        ? [enemy, smile].filter(Boolean)
        : activeMode === 'hardcore' && smile
          ? [enemy, smile]
          : [enemy]
      : []),
    ...remotePlayers.filter(p => p.alive).map(p => ({ ...p, type: 'player' })),
  ]
    .map(o => ({ ...o, d: Math.hypot(o.x - player.x, o.y - player.y) }))
    .sort((a, b) => b.d - a.d);
  for (const o of objects) {
    let dx = o.x - player.x,
      dy = o.y - player.y,
      depth = dx * ca + dy * sa;
    if (depth < 0.12) continue;
    let horizontal = (-dx * sa + dy * ca) / (0.72 * depth),
      screen = ((1 + horizontal) * W) / 2,
      size = H / depth,
      wide =
        size *
        (o.type === 'industrialLamp'
          ? 0.44
          : o.type === 'turbine'
            ? 1.6
            : o.type === 'exit'
              ? 0.55
              : o.type === 'smile'
                ? 0.52
                : o.type === 'enemy'
                  ? 0.32
                  : o.type === 'player'
                    ? 0.45
                    : 0.17),
      top =
        horizon -
        size *
          (o.type === 'industrialLamp'
            ? 0.5
            : o.type === 'turbine'
              ? 2.8
              : o.type === 'coin'
                ? -0.12
                : o.type === 'fuse'
                  ? 0.03
                  : 0.45),
      height =
        size *
        (o.type === 'industrialLamp'
          ? 0.22
          : o.type === 'turbine'
            ? 3.3
            : o.type === 'coin'
              ? 0.17
              : o.type === 'fuse'
                ? 0.22
                : 0.95);
    ctx.save();
    ctx.beginPath();
    for (
      let x = Math.max(0, Math.floor(screen - wide / 2));
      x < Math.min(W, screen + wide / 2);
      x++
    )
      if (depth < zbuf[x]) {
        if (!builder.custom && activeLevel !== 'office' && activeLevel !== 'fun')
          ctx.rect(x, top, 1, height + 5);
        else {
          let start = -1;
          const end = Math.min(H, Math.ceil(top + height + 5));
          for (let y = Math.max(0, Math.floor(top)); y <= end; y++) {
            const visible = y < end && depth < roofDepth[y * W + x];
            if (visible && start < 0) start = y;
            if (!visible && start >= 0) {
              ctx.rect(x, start, 1, y - start);
              start = -1;
            }
          }
        }
      }
    ctx.clip();
    if (o.type === 'industrialLamp') {
      ctx.strokeStyle = '#17180f';
      ctx.lineWidth = Math.max(1, wide * 0.06);
      ctx.beginPath();
      ctx.moveTo(screen, top);
      ctx.lineTo(screen, top + height * 0.6);
      ctx.stroke();
      ctx.fillStyle = '#232518';
      ctx.beginPath();
      ctx.moveTo(screen - wide * 0.14, top + height * 0.55);
      ctx.lineTo(screen + wide * 0.14, top + height * 0.55);
      ctx.lineTo(screen + wide * 0.5, top + height * 0.9);
      ctx.lineTo(screen - wide * 0.5, top + height * 0.9);
      ctx.closePath();
      ctx.fill();
      ctx.shadowColor = '#ecd36a';
      ctx.shadowBlur = Math.min(18, size * 0.2);
      ctx.fillStyle = '#e8d283';
      ctx.beginPath();
      ctx.ellipse(
        screen,
        top + height * 0.91,
        wide * 0.36,
        Math.max(1, height * 0.06),
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.shadowBlur = 0;
    } else if (o.type === 'turbine') {
      drawTurbine(ctx, screen, top, wide, height, now);
    } else if (o.type === 'coin') {
      const shimmer = 0.65 + Math.abs(Math.sin(now * 0.003 + o.id)) * 0.35;
      ctx.shadowColor = '#ffe064';
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#f4ca46';
      ctx.beginPath();
      ctx.ellipse(
        screen,
        top + height / 2,
        wide * 0.45 * shimmer,
        height * 0.46,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#fff0a4';
      ctx.lineWidth = Math.max(1, size * 0.01);
      ctx.stroke();
      ctx.fillStyle = '#927018';
      ctx.fillRect(
        screen - wide * 0.04,
        top + height * 0.25,
        Math.max(1, wide * 0.08),
        height * 0.5,
      );
    } else if (o.type === 'fuse') {
      ctx.shadowColor = '#ffe092';
      ctx.shadowBlur = 18;
      ctx.fillStyle = '#eed773';
      ctx.fillRect(screen - wide / 2, top, wide, height);
      ctx.fillStyle = '#514b30';
      ctx.fillRect(screen - wide / 2, top + height * 0.24, wide, height * 0.52);
    } else if (o.type === 'exit') {
      let unlocked = fuses.every(f => f.taken);
      ctx.fillStyle = unlocked ? '#436e49' : '#34392b';
      ctx.fillRect(screen - wide / 2, top, wide, height);
      ctx.strokeStyle = unlocked ? '#c3f1a4' : '#867d48';
      ctx.lineWidth = 2;
      ctx.strokeRect(screen - wide / 2, top, wide, height);
      ctx.fillStyle = unlocked ? '#b8ef91' : '#e0ca76';
      ctx.font = `bold ${Math.max(5, size * 0.075)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText(
        window.gameI18n?.t(
          activeLevel === 'glitch-past'
            ? 'CASA'
            : activeLevel === 'glitch-shift'
              ? 'PASSADO'
              : 'SAÍDA',
        ) ||
          (activeLevel === 'glitch-past'
            ? 'CASA'
            : activeLevel === 'glitch-shift'
              ? 'PASSADO'
              : 'SAÍDA'),
        screen,
        top + height * 0.18,
      );
      ctx.fillRect(screen + wide * 0.28, top + height * 0.55, wide * 0.07, wide * 0.07);
    } else if (o.type === 'smile') {
      drawSmile(ctx, screen, top, wide, height, now);
    } else if (o.type === 'player') {
      drawExplorer(ctx, screen - wide / 2, top, wide, height, o.color);
    } else {
      ctx.fillStyle = '#080909';
      ctx.beginPath();
      ctx.ellipse(screen, top + height * 0.14, wide * 0.25, height * 0.14, 0, 0, 7);
      ctx.fill();
      ctx.fillRect(screen - wide * 0.22, top + height * 0.25, wide * 0.44, height * 0.42);
      ctx.lineWidth = wide * 0.15;
      ctx.strokeStyle = '#080909';
      ctx.beginPath();
      ctx.moveTo(screen - wide * 0.15, top + height * 0.3);
      ctx.lineTo(screen - wide * 0.43, top + height * 0.7);
      ctx.moveTo(screen + wide * 0.15, top + height * 0.3);
      ctx.lineTo(screen + wide * 0.43, top + height * 0.72);
      ctx.moveTo(screen - wide * 0.12, top + height * 0.6);
      ctx.lineTo(screen - wide * 0.22, top + height);
      ctx.moveTo(screen + wide * 0.12, top + height * 0.6);
      ctx.lineTo(screen + wide * 0.24, top + height);
      ctx.stroke();
      ctx.fillStyle = '#dcd5b2';
      ctx.fillRect(screen - wide * 0.14, top + height * 0.12, wide * 0.08, height * 0.022);
      ctx.fillRect(screen + wide * 0.07, top + height * 0.12, wide * 0.08, height * 0.022);
    }
    ctx.restore();
    if (o.type === 'player' && screen >= 0 && screen < W && depth < zbuf[Math.floor(screen)]) {
      ctx.font = 'bold ' + Math.min(15, Math.max(9, size * 0.065)) + 'px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f5edd1';
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 4;
      ctx.fillText(o.name, screen, top - 8);
      ctx.shadowBlur = 0;
    }
  }
  if (builder.editing) drawBuilderAim(ca, sa, horizon);
}
$('start').onclick = () => {
  if (net && (state === 'won' || state === 'lost' || net.dead)) {
    showLobby();
    return;
  }
  start();
};
$('pause').onclick = pause;
$('sound').onclick = () => {
  muted = !muted;
  $('sound').textContent = muted ? 'SOM: OFF' : 'SOM: ON';
  if (gain) gain.gain.value = muted ? 0 : 0.025;
  syncMenuMusic();
  syncGameMusic();
};
$('flash').onclick = () => (light = !light);
canvas.onclick = e => {
  if (builder.editing) {
    if (e.pointerType === 'touch' || matchMedia('(pointer:coarse)').matches) return;
    if (document.pointerLockElement === canvas) builderApply();
    else closeBuilderPalette();
    return;
  }
  if (state === 'playing') lock();
};
document.addEventListener('keydown', e => {
  if (!$('nameGate').hidden) return;
  if (chatOpen) {
    if (e.code === 'Escape') {
      e.preventDefault();
      closeChat();
    }
    return;
  }
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
  if (builder.editing) {
    if (e.code === 'KeyB' || e.code === 'Escape') {
      e.preventDefault();
      if (!e.repeat) $('builderPalette').hidden ? openBuilderPalette() : closeBuilderPalette();
      return;
    }
    if (e.ctrlKey && (e.code === 'KeyZ' || e.code === 'KeyY')) {
      e.preventDefault();
      if (!e.repeat) builderUndo(e.code === 'KeyY' || e.shiftKey);
      return;
    }
    if (['KeyE', 'KeyQ', 'KeyR'].includes(e.code)) {
      e.preventDefault();
      if (!e.repeat) {
        if (e.code === 'KeyR') $('builderRotate').onclick();
        else builderApply(e.code === 'KeyQ');
      }
      return;
    }
    if (e.code === 'KeyT' || e.code === 'KeyV') return;
  }
  if (e.code === 'KeyM' && !e.repeat && !builder.editing) {
    e.preventDefault();
    toggleLevelMap();
    return;
  }
  if (e.code === 'KeyT' && !e.repeat) {
    e.preventDefault();
    openChat();
    return;
  }
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code))
    e.preventDefault();
  keys[e.code] = true;
  if (e.code === 'KeyV' && !e.repeat) {
    e.preventDefault();
    void reviveAll();
  }
  if (e.code === 'KeyF' && !e.repeat) light = !light;
  if (e.code === 'Escape') {
    if (!$('missionsPanel').hidden) closeMissions();
    else if (!$('leaderboardPanel').hidden) closeLeaderboard();
    else pause();
  }
});
document.addEventListener('keyup', e => (keys[e.code] = false));
document.addEventListener('mousemove', e => {
  if (state === 'playing' && document.pointerLockElement === canvas) {
    player.a += e.movementX * 0.0025;
    if (builder.custom)
      viewPitch = Math.max(-H * 0.6, Math.min(H * 0.4, viewPitch - e.movementY * 0.45));
  }
});
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && state === 'playing') pause();
});
window.addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});
document.querySelectorAll('[data-key]').forEach(b => {
  b.onpointerdown = e => {
    e.preventDefault();
    b.setPointerCapture(e.pointerId);
    keys[b.dataset.key] = true;
  };
  b.onpointerup = b.onpointercancel = () => (keys[b.dataset.key] = false);
});
let touchX = null,
  touchY = null,
  touchLookPointer = null;
canvas.addEventListener('pointerdown', e => {
  if (e.pointerType !== 'mouse' && state === 'playing' && touchLookPointer === null) {
    touchLookPointer = e.pointerId;
    touchX = e.clientX;
    touchY = e.clientY;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {}
  }
});
canvas.addEventListener('pointermove', e => {
  if (e.pointerId === touchLookPointer && touchX !== null && state === 'playing') {
    player.a += (e.clientX - touchX) * 0.006;
    if (builder.custom && touchY !== null)
      viewPitch = Math.max(-H * 0.6, Math.min(H * 0.4, viewPitch - (e.clientY - touchY) * 0.7));
    touchX = e.clientX;
    touchY = e.clientY;
  }
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
  canvas.addEventListener(type, e => {
    if (e.pointerId === touchLookPointer) {
      touchLookPointer = null;
      touchX = null;
    }
  });
let net = null,
  remotePlayers = [],
  remoteTargets = [],
  netBusy = false,
  netSeq = 0,
  pollTimer = null,
  sceneRound = -1;
reset(93451);
let last = performance.now();
function tick(now) {
  interpolateRemote(now);
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  pollController(now);
  update(dt);
  render(now);
  drawLevelMap(now);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
if (document.modelContext?.registerTool) {
  try {
    Promise.resolve(
      document.modelContext.registerTool({
        name: 'read_backrooms_status',
        description: 'Lê o progresso atual da partida das Backrooms.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true },
        execute: () => ({
          state,
          fuses: fuses.filter(f => f.taken).length,
          seconds: Math.floor(elapsed),
        }),
      }),
    ).catch(() => {});
  } catch {}
}

function drawExplorer(c, x, y, w, h, color) {
  c.save();
  c.translate(x, y);
  c.fillStyle = '#252722';
  c.fillRect(w * 0.05, h * 0.28, w * 0.9, h * 0.38);
  c.fillStyle = color || '#ddbc45';
  c.fillRect(w * 0.2, h * 0.25, w * 0.6, h * 0.4);
  c.beginPath();
  c.ellipse(w * 0.5, h * 0.15, w * 0.29, h * 0.15, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#1b3034';
  c.fillRect(w * 0.27, h * 0.09, w * 0.46, h * 0.12);
  c.fillStyle = '#82b7b9';
  c.fillRect(w * 0.3, h * 0.1, w * 0.12, h * 0.035);
  c.fillStyle = color || '#ddbc45';
  c.fillRect(w * 0.06, h * 0.3, w * 0.14, h * 0.37);
  c.fillRect(w * 0.8, h * 0.3, w * 0.14, h * 0.37);
  c.fillRect(w * 0.24, h * 0.61, w * 0.2, h * 0.3);
  c.fillRect(w * 0.56, h * 0.61, w * 0.2, h * 0.3);
  c.fillStyle = '#242922';
  c.fillRect(w * 0.06, h * 0.61, w * 0.14, h * 0.1);
  c.fillRect(w * 0.8, h * 0.61, w * 0.14, h * 0.1);
  c.fillRect(w * 0.2, h * 0.89, w * 0.25, h * 0.1);
  c.fillRect(w * 0.55, h * 0.89, w * 0.25, h * 0.1);
  c.fillRect(w * 0.2, h * 0.54, w * 0.6, h * 0.055);
  c.fillStyle = '#ebe5c8';
  c.fillRect(w * 0.31, h * 0.32, w * 0.16, h * 0.09);
  c.fillStyle = '#4b4a30';
  c.fillRect(w * 0.57, h * 0.32, w * 0.12, h * 0.12);
  c.restore();
}
function showPanel(which) {
  $('adminPanel').hidden = !isAdmin();
  document.body.classList.toggle(
    'game-menu',
    which === 'pause' || which === 'missions' || which === 'leaderboard',
  );
  $('overlay').scrollTop = 0;
  padNavDirection = '';
  padNavNext = 0;
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
    a: player.a,
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
    keys = {};
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
  const previousCount = fuses.filter(f => f.taken).length,
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
      player.x = mine.x;
      player.y = mine.y;
      player.a = mine.a;
      resetMovementTrail();
    }
    if (room.status === 'playing') {
      state = 'playing';
      showPanel('pause');
      document.body.classList.add('playing');
      syncMenuMusic();
      syncGameMusic();
      lock();
      say(phaseIntro(room.level));
    } else {
      state = 'lobby';
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
      player.x = mine.x;
      player.y = mine.y;
      resetMovementTrail(data.ackMovement || 0);
    }
  }
  if (movementWaiting) $('connection').textContent = 'SINCRONIZANDO MOVIMENTO…';
  coins.forEach(c => (c.taken = (room.collectedCoins || []).includes(c.id)));
  coinBalance = room.balance || 0;
  if (room.status !== 'lobby') {
    missionSet('coins', coinBalance);
    missionSet('fuses', room.fuses.filter(Boolean).length);
  }
  elapsed = room.started ? Math.max(0, (room.now - room.started) / 1000) : 0;
  fuses.forEach((f, i) => (f.taken = room.fuses[i]));
  enemy = { ...room.enemy };
  smile = room.smile ? { ...room.smile } : null;
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
    keys = {};
    touchX = null;
    player.x = mine.x;
    player.y = mine.y;
    player.a = mine.a;
    resetMovementTrail();
    stamina = 100;
    state = 'playing';
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
    if (state !== room.status && $('lobbyPanel').hidden) {
      finish(room.status === 'won');
      $('story').textContent =
        room.status === 'won' ? 'A equipe encontrou a saída!' : 'A expedição chegou ao fim.';
      $('details').textContent =
        room.status === 'won'
          ? 'Vocês escaparam juntos em ' +
            Math.floor(elapsed / 60) +
            'min ' +
            Math.floor(elapsed % 60) +
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
  state = 'lobby';
  keys = {};
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
  state = 'playing';
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
  keys = {};
  state = 'ready';
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
$('createRoom').onclick = () => connectRoom('create');
$('joinRoom').onclick = () => connectRoom('join');
$('launch').onclick = launchRoom;
$('leaveLobby').onclick = () => leaveRoom();
$('backMenu').onclick = () =>
  builder.custom ? (builder.testing ? returnToBuilder() : openWorkshop('gallery')) : leaveRoom();
$('solo').onclick = () => {
  try {
    nameInput();
    selectedLevel = PHASE_ORDER[0];
    state = 'ready';
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
const invitationCode = new URLSearchParams(location.search).get('sala');
if (invitationCode) $('roomCode').value = invitationCode.toUpperCase().slice(0, 6);
const portrait = $('portrait');
drawExplorer(portrait.getContext('2d'), 15, 0, 70, 150, '#ddbc45');
showPanel('home');

// Fullscreen and orientation must be requested from a real tap. Some browsers
// do not implement orientation lock, so the portrait gate remains the fallback.
let landscapeRequest = null;
function enterLandscape() {
  if (!matchMedia('(pointer:coarse)').matches) return Promise.resolve();
  if (landscapeRequest) return landscapeRequest;
  landscapeRequest = (async () => {
    const root = document.documentElement;
    if (!document.fullscreenElement && root?.requestFullscreen) {
      try {
        await root.requestFullscreen({ navigationUI: 'hide' });
      } catch {}
    }
    try {
      if (globalThis.screen?.orientation?.lock)
        await globalThis.screen.orientation.lock('landscape');
    } catch {}
    $('rotateHelp').textContent =
      'Se a tela continuar em pé, vire o aparelho e desative o bloqueio de rotação.';
  })().finally(() => {
    landscapeRequest = null;
  });
  return landscapeRequest;
}
$('rotateButton').onclick = () => enterLandscape();
$('fullscreen').onclick = async () => {
  if (matchMedia('(pointer:coarse)').matches) {
    await enterLandscape();
    return;
  }
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch {
    say('Use a opção de tela cheia do seu navegador.');
  }
};
function orientationChanged() {
  if (matchMedia('(pointer:coarse) and (orientation:portrait)').matches) {
    keys = {};
    touchX = null;
    if (!net && state === 'playing') pause();
  }
}
window.addEventListener('resize', orientationChanged);
globalThis.screen?.orientation?.addEventListener('change', orientationChanged);

function updateRescueUI() {
  const hardcore = activeMode === 'hardcore' && !isAdmin();
  $('coinHud').hidden = hardcore;
  $('rescuePanel').hidden = hardcore;
  const hasDead = net ? net.room.players.some(p => !p.alive) : state === 'lost';
  const active = net
    ? ['playing', 'lost'].includes(net.room.status)
    : ['playing', 'paused', 'lost'].includes(state);
  const enough = isAdmin() || coinBalance >= 25,
    enabled = !hardcore && active && hasDead && enough && !reviveBusy;
  $('coinCount').textContent = isAdmin() ? '∞' : String(coinBalance);
  $('menuCoinCount').textContent = isAdmin() ? '∞' : String(coinBalance);
  $('reviveHud').disabled = !enabled;
  $('reviveMenu').disabled = !enabled;
  $('reviveHud').textContent = reviveBusy ? 'REVIVENDO…' : 'V · REVIVER · 25';
  $('reviveMenu').textContent = reviveBusy ? 'REVIVENDO…' : 'V · REVIVER TODOS · 25 MOEDAS';
  $('rescuePanel').hidden = hardcore || !active || !$('homePanel').hidden;
  $('rescueHint').textContent = !hasDead
    ? '25 moedas revivem todos os capturados.'
    : enough
      ? 'Aperte V ou toque no botão para voltar à expedição.'
      : 'Faltam ' + (25 - coinBalance) + ' moedas para reviver.';
}
async function reviveAll() {
  if (activeMode === 'hardcore' && !isAdmin()) {
    say('Hardcore: não é possível reviver.');
    return;
  }
  if (reviveBusy) return;
  const feedback = text => {
    say(text);
    $('rescueMessage').textContent = text;
  };
  const hasDead = net ? net.room.players.some(p => !p.alive) : state === 'lost';
  if (!hasDead) {
    feedback('Todos os exploradores estão vivos.');
    return;
  }
  missionSet('coins', coinBalance);
  if (!isAdmin() && coinBalance < 25) {
    feedback('Você precisa de 25 moedas para reviver.');
    return;
  }
  if (net) {
    const session = net;
    reviveBusy = true;
    updateRescueUI();
    try {
      const data = await requestRoom('revive', roomPayload());
      if (net !== session) return;
      applySnapshot(data);
      missionAdd('rescues');
      feedback('Equipe revivida! 25 moedas utilizadas.');
    } catch (e) {
      feedback(e.message);
    } finally {
      reviveBusy = false;
      updateRescueUI();
    }
    return;
  }
  resetMotion();
  touchX = null;
  if (!builder.custom) missionAdd('rescues');
  if (!isAdmin()) coinBalance -= 25;
  player = builder.custom ? { ...builder.custom.spawn } : { x: 1.5, y: 1.5, a: 0 };
  enemy = soloEnemySpawn ? { ...soloEnemySpawn } : null;
  if (builder.custom)
    smile = builder.custom.monsters[1] ? { ...builder.custom.monsters[1], type: 'smile' } : null;
  enemyPath = [];
  pathTimer = 0;
  stamina = 100;
  soloProtectedUntil = elapsed + 5;
  state = 'playing';
  keys = {};
  document.body.classList.add('playing');
  showPanel('pause');
  initAudio();
  lock();
  feedback('Você reviveu! 5 segundos de proteção.');
  updateRescueUI();
}
$('reviveHud').onclick = () => reviveAll();
$('reviveMenu').onclick = () => reviveAll();
updateRescueUI();

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
      if (state === 'playing') pause();
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
  } else if (state === 'ready' && !$('nameGate').hidden) {
    if (hit(0)) activatePadMenu();
  } else if (chatOpen) {
    if (hit(1) || hit(9)) closeChat();
    else if (hit(0)) activatePadMenu();
  } else if (builder.editing && !$('builderPalette').hidden) {
    if (hit(1) || hit(9) || hit(3)) closeBuilderPalette();
    else if (hit(0)) activatePadMenu();
  } else if (state === 'playing') {
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
      if (hit(2)) light = !light;
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
    } else if (hit(9) && state === 'paused') start();
    else if (hit(1)) {
      if (state === 'paused') start();
      else if (net) void leaveRoom();
      else {
        state = 'ready';
        showPanel('home');
      }
    } else if (hit(0)) activatePadMenu();
  }
  if (state !== 'playing' || padEditor || (builder.editing && !$('builderPalette').hidden)) {
    const ax = pad.axes[0] || 0,
      ay = pad.axes[1] || 0;
    if (Math.hypot(ax, ay) < 0.35) padMenuNeutral = false;
    let x = pressed[14]
        ? -1
        : pressed[15]
          ? 1
          : !padMenuNeutral && Math.abs(ax) > 0.65
            ? Math.sign(ax)
            : 0,
      y = pressed[12]
        ? -1
        : pressed[13]
          ? 1
          : !padMenuNeutral && Math.abs(ay) > 0.65
            ? Math.sign(ay)
            : 0;
    if (x && y) {
      if (Math.abs(ay) >= Math.abs(ax)) x = 0;
      else y = 0;
    }
    const direction = x + ',' + y;
    if ((x || y) && (direction !== padNavDirection || now >= padNavNext)) {
      const first = direction !== padNavDirection;
      movePadFocus(x, y);
      padNavNext = now + (first ? 420 : 180);
      padNavDirection = direction;
    }
    if (!x && !y) {
      padNavDirection = '';
      padNavNext = 0;
    }
  }
  padPrevious = pressed;
}
$('padErase').onclick = erasePadChar;
$('padDone').onclick = () => closePadKeyboard(true);
$('padCancel').onclick = () => closePadKeyboard(false);
window.addEventListener('gamepaddisconnected', () => {
  clearPadInput();
});

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
$('padSensitivityHome').onclick = cyclePadSensitivity;
$('padSensitivityPause').onclick = cyclePadSensitivity;

function updateLevelButtons() {}

function drawSmile(c, x, y, w, h, now) {
  const cy = y + h * 0.36 + Math.sin(now * 0.002) * Math.min(3, h * 0.02);
  c.save();
  c.shadowColor = '#e8efff';
  c.shadowBlur = 12;
  c.fillStyle = '#f6f7e7';
  c.beginPath();
  c.ellipse(x - w * 0.21, cy - h * 0.055, w * 0.085, h * 0.034, -0.25, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.ellipse(x + w * 0.21, cy - h * 0.055, w * 0.085, h * 0.034, 0.25, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.moveTo(x - w * 0.4, cy + h * 0.03);
  c.quadraticCurveTo(x, cy + h * 0.22, x + w * 0.4, cy + h * 0.03);
  c.quadraticCurveTo(x, cy + h * 0.34, x - w * 0.4, cy + h * 0.03);
  c.fill();
  c.shadowBlur = 0;
  c.strokeStyle = '#25262b';
  c.lineWidth = Math.max(1, w * 0.018);
  for (let i = -3; i <= 3; i++) {
    const tx = x + i * w * 0.095;
    c.beginPath();
    c.moveTo(tx, cy + h * 0.115);
    c.lineTo(tx, cy + h * 0.2);
    c.stroke();
  }
  c.restore();
}
function updateModeUI() {
  const hard = activeMode === 'hardcore';
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
    reset(93451, selectedLevel, mode);
    updateModeButtons();
    return;
  }
  if (!net || modeBusy || levelBusy || net.room.host !== net.id || net.room.status === 'playing')
    return;
  const session = net;
  modeBusy = true;
  updateModeButtons();
  try {
    const data = await requestRoom('mode', { ...roomPayload(), mode });
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
for (const b of document.querySelectorAll('[data-mode]'))
  b.onclick = () => selectMode(b.dataset.mode, b.dataset.place);
updateModeButtons();

function resetMovementTrail(ordinal = 0) {
  movementTrail = [];
  movementOrdinal = ordinal;
  movementSentOrdinal = ordinal;
  movementAnchor = { x: player.x, y: player.y };
  movementWaiting = false;
}
function recordMovement() {
  if (!net || state !== 'playing' || net.dead) return;
  const last = movementTrail.at(-1),
    x = Math.round(player.x * 1000) / 1000,
    y = Math.round(player.y * 1000) / 1000;
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

function drawTurbine(c, x, y, w, h, now) {
  const hub = y + h * 0.26,
    base = y + h,
    r = w * 0.48;
  c.fillStyle = '#d9e0df';
  c.beginPath();
  c.moveTo(x - w * 0.035, hub);
  c.lineTo(x - w * 0.065, base);
  c.lineTo(x + w * 0.065, base);
  c.lineTo(x + w * 0.035, hub);
  c.fill();
  c.strokeStyle = '#b7c6ca';
  c.lineWidth = Math.max(1, w * 0.02);
  c.beginPath();
  c.moveTo(x + w * 0.045, hub);
  c.lineTo(x + w * 0.065, base);
  c.stroke();
  c.fillStyle = '#eef1e9';
  for (let i = 0; i < 3; i++) {
    const a = now * 0.00065 + (i * Math.PI * 2) / 3,
      dx = Math.cos(a),
      dy = Math.sin(a);
    c.beginPath();
    c.moveTo(x - dy * w * 0.035, hub + dx * w * 0.035);
    c.lineTo(x + dx * r - dy * w * 0.015, hub + dy * r + dx * w * 0.015);
    c.lineTo(x + dx * r * 0.22 + dy * w * 0.04, hub + dy * r * 0.22 - dx * w * 0.04);
    c.closePath();
    c.fill();
  }
  c.beginPath();
  c.ellipse(x, hub, w * 0.05, w * 0.05, 0, 0, Math.PI * 2);
  c.fill();
}

// Four actual world-space triangular faces meet above each square house.
// Perspective-correct depth keeps the roof attached and hides rear faces.
const roofDepth = new Float32Array(W * H);
function drawPyramidRoofs(ca, sa, horizon) {
  roofDepth.fill(Infinity);
  const camera = v => {
    const dx = v[0] - player.x,
      dy = v[1] - player.y;
    return { r: -dx * sa + dy * ca, d: dx * ca + dy * sa, z: v[2] - 0.5 };
  };
  const project = v => ({
    x: W / 2 + (v.r / v.d) * (W / 1.44),
    y: horizon - (v.z / v.d) * H,
    q: 1 / v.d,
  });
  function face(vertices, color) {
    let poly = vertices.map(camera),
      clipped = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i],
        b = poly[(i + 1) % poly.length],
        inside = a.d >= 0.06,
        next = b.d >= 0.06;
      if (inside) clipped.push(a);
      if (inside !== next) {
        const t = (0.06 - a.d) / (b.d - a.d);
        clipped.push({ r: a.r + (b.r - a.r) * t, d: 0.06, z: a.z + (b.z - a.z) * t });
      }
    }
    if (clipped.length < 3) return;
    clipped = clipped.map(project);
    for (let i = 1; i < clipped.length - 1; i++)
      triangle(clipped[0], clipped[i], clipped[i + 1], color);
  }
  function triangle(a, b, c, color) {
    const area = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(area) < 0.0001) return;
    const left = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x))),
      right = Math.min(W - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
    const top = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y))),
      bottom = Math.min(H - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
    for (let y = top; y <= bottom; y++)
      for (let x = left; x <= right; x++) {
        const u = ((b.y - c.y) * (x + 0.5 - c.x) + (c.x - b.x) * (y + 0.5 - c.y)) / area;
        const v = ((c.y - a.y) * (x + 0.5 - c.x) + (a.x - c.x) * (y + 0.5 - c.y)) / area,
          w = 1 - u - v;
        if (u < 0 || v < 0 || w < 0) continue;
        const d = 1 / (u * a.q + v * b.q + w * c.q),
          index = y * W + x;
        if (
          d >= roofDepth[index] ||
          (d > zbuf[x] + 0.002 && y + 0.5 >= horizon - H / (2 * zbuf[x]))
        )
          continue;
        roofDepth[index] = d;
        const light = Math.max(0.6, 1 - d * 0.012),
          p = index * 4;
        pixels[p] = color[0] * light;
        pixels[p + 1] = color[1] * light;
        pixels[p + 2] = color[2] * light;
      }
  }

  function box(x, y, z, w, d, h, color) {
    const X = x + w,
      Y = y + d,
      Z = z + h,
      shade = k => color.map(v => v * k);
    if (player.y < y)
      face(
        [
          [x, y, z],
          [X, y, z],
          [X, y, Z],
          [x, y, Z],
        ],
        shade(0.85),
      );
    if (player.y > Y)
      face(
        [
          [X, Y, z],
          [x, Y, z],
          [x, Y, Z],
          [X, Y, Z],
        ],
        shade(0.73),
      );
    if (player.x < x)
      face(
        [
          [x, Y, z],
          [x, y, z],
          [x, y, Z],
          [x, Y, Z],
        ],
        shade(0.8),
      );
    if (player.x > X)
      face(
        [
          [X, y, z],
          [X, Y, z],
          [X, Y, Z],
          [X, y, Z],
        ],
        shade(0.92),
      );
    if (0.5 > Z)
      face(
        [
          [x, y, Z],
          [X, y, Z],
          [X, Y, Z],
          [x, Y, Z],
        ],
        color,
      );
    if (0.5 < z)
      face(
        [
          [x, Y, z],
          [X, Y, z],
          [X, y, z],
          [x, y, z],
        ],
        shade(0.55),
      );
  }
  if (builder.custom) {
    function objectBox(p, x, y, z, w, d, h, color) {
      const angle = (p.rotation * Math.PI) / 2,
        co = Math.cos(angle),
        si = Math.sin(angle);
      const v = [
        [x, y, z],
        [x + w, y, z],
        [x + w, y + d, z],
        [x, y + d, z],
        [x, y, z + h],
        [x + w, y, z + h],
        [x + w, y + d, z + h],
        [x, y + d, z + h],
      ].map(([a, b, c]) => [p.x + a * co - b * si, p.y + a * si + b * co, c]);
      const faces = [
        [0, 1, 5, 4],
        [1, 2, 6, 5],
        [2, 3, 7, 6],
        [3, 0, 4, 7],
        [4, 5, 6, 7],
        [3, 2, 1, 0],
      ];
      faces.forEach((f, i) =>
        face(
          f.map(j => v[j]),
          color.map(n => n * [0.8, 0.9, 0.74, 0.85, 1, 0.55][i]),
        ),
      );
    }
    for (const p of builder.custom.props) {
      const dx = p.x - player.x,
        dy = p.y - player.y;
      if (dx * ca + dy * sa < -1 || Math.hypot(dx, dy) > 16) continue;
      const c = rgbHex(p.color),
        metal = [53, 62, 58],
        part = (...args) => objectBox(p, ...args);
      if (p.kind === 'table') {
        part(-0.46, -0.4, 0.36, 0.92, 0.8, 0.05, c);
        for (const x of [-0.4, 0.35])
          for (const y of [-0.34, 0.29]) part(x, y, 0, 0.05, 0.05, 0.36, metal);
      } else if (p.kind === 'chair') {
        part(-0.23, -0.22, 0.23, 0.46, 0.44, 0.05, c);
        part(-0.23, 0.18, 0.27, 0.46, 0.055, 0.35, c);
        for (const x of [-0.2, 0.15])
          for (const y of [-0.19, 0.14]) part(x, y, 0, 0.045, 0.045, 0.23, metal);
      } else if (p.kind === 'pillar') part(-0.3, -0.3, 0, 0.6, 0.6, 1, c);
      else if (p.kind === 'barrier') part(-0.5, -0.12, 0, 1, 0.24, 0.35, c);
      else if (p.kind === 'lamp') {
        part(
          -0.3,
          -0.15,
          0.97,
          0.6,
          0.3,
          0.03,
          c.map(n => Math.min(255, n + 65)),
        );
        part(-0.33, -0.18, 0.96, 0.66, 0.36, 0.015, metal);
      } else {
        part(-0.4, -0.4, 0, 0.8, 0.8, 0.5, c);
        part(-0.42, -0.42, 0.07, 0.84, 0.04, 0.04, metal);
        part(-0.42, -0.42, 0.39, 0.84, 0.04, 0.04, metal);
      }
    }
    return;
  }
  if (activeLevel === 'fun') {
    const teal = [53, 138, 154],
      red = [174, 56, 47],
      green = [59, 136, 84],
      yellow = [219, 177, 68],
      pale = [181, 218, 204];
    function beam(a, b, width, color) {
      const v = b.map((n, i) => n - a[i]),
        len = Math.hypot(...v);
      if (!len) return;
      const u = Math.hypot(v[0], v[1]) > 0.001 ? [-v[1], v[0], 0] : [1, 0, 0],
        ul = Math.hypot(...u);
      for (let i = 0; i < 3; i++) u[i] *= width / ul / 2;
      const q = [
        v[1] * u[2] - v[2] * u[1],
        v[2] * u[0] - v[0] * u[2],
        v[0] * u[1] - v[1] * u[0],
      ].map(n => n / len);
      const ring = p =>
        [
          [1, 1],
          [-1, 1],
          [-1, -1],
          [1, -1],
        ].map(([j, k]) => p.map((n, i) => n + j * u[i] + k * q[i]));
      const A = ring(a),
        B = ring(b);
      for (let i = 0; i < 4; i++)
        face(
          [A[i], A[(i + 1) % 4], B[(i + 1) % 4], B[i]],
          color.map(n => n * (0.72 + i * 0.07)),
        );
    }
    for (const [x, y] of [
      [3, 8],
      [9, 8],
      [15, 8],
      [3, 14],
      [9, 14],
      [15, 14],
    ])
      box(x, y, 0, 3, 1, 0.31, pale);
    const centers = [
      [4, 4],
      [10, 4],
      [16, 4],
      [4, 10],
      [10, 10],
      [16, 10],
      [4, 16],
      [12, 16],
    ];
    for (let index = 0; index < centers.length; index++) {
      const [x, y] = centers[index],
        dx = x + 1 - player.x,
        dy = y + 1 - player.y;
      if (dx * ca + dy * sa < -2 || Math.hypot(dx, dy) > 18) continue;
      if (index % 3 === 0) {
        // A fixed geodesic climbing dome, formed by triangular metal bars.
        const low = [],
          high = [];
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4;
          low.push([x + 1 + Math.cos(a) * 0.95, y + 1 + Math.sin(a) * 0.95, 0.04]);
          high.push([
            x + 1 + Math.cos(a + Math.PI / 8) * 0.64,
            y + 1 + Math.sin(a + Math.PI / 8) * 0.64,
            0.55,
          ]);
        }
        for (let i = 0; i < 8; i++) {
          beam(low[i], low[(i + 1) % 8], 0.035, teal);
          beam(low[i], high[i], 0.035, teal);
          beam(low[(i + 1) % 8], high[i], 0.035, teal);
          beam(high[i], high[(i + 1) % 8], 0.035, teal);
          beam(high[i], [x + 1, y + 1, 0.85], 0.035, teal);
        }
      } else {
        const color = index % 2 ? red : green;
        for (const xx of [x + 0.08, x + 1.84])
          for (const yy of [y + 0.08, y + 1.84]) box(xx, yy, 0, 0.065, 0.065, 0.94, color);
        for (const z of [0.36, 0.9]) {
          box(x + 0.08, y + 0.08, z, 1.82, 0.045, 0.04, yellow);
          box(x + 0.08, y + 1.84, z, 1.82, 0.045, 0.04, color);
          box(x + 0.08, y + 0.08, z, 0.045, 1.82, 0.04, green);
          box(x + 1.84, y + 0.08, z, 0.045, 1.82, 0.04, color);
        }
        box(x + 0.15, y + 0.15, 0.35, 1.68, 1.68, 0.04, [99, 172, 172]);
        for (let j = 1; j < 7; j++) {
          box(x + 0.1 + j * 0.25, y + 0.09, 0.4, 0.022, 0.025, 0.48, green);
          box(x + 1.84, y + 0.1 + j * 0.25, 0.4, 0.025, 0.022, 0.48, yellow);
        }
        for (let j = 1; j < 6; j++) box(x + 0.3, y + 1.85, j * 0.065, 0.55, 0.045, 0.025, yellow);
      }
    }
    return;
  }
  if (activeLevel === 'office') {
    for (let y = 1; y < N - 1; y++)
      for (let x = 1; x < N - 1; x++)
        if (grid[y][x] === 2) {
          const dx = x + 0.5 - player.x,
            dy = y + 0.5 - player.y;
          if (dx * ca + dy * sa < -0.9) continue;
          // Every part has fixed world coordinates: no camera-facing furniture.
          box(x + 0.04, y + 0.06, 0, 0.92, 0.06, 0.72, [203, 205, 195]);
          box(x + 0.04, y + 0.06, 0, 0.05, 0.88, 0.65, [209, 211, 203]);
          box(x + 0.91, y + 0.06, 0, 0.05, 0.62, 0.65, [209, 211, 203]);
          box(x + 0.09, y + 0.15, 0.36, 0.82, 0.48, 0.045, [224, 221, 207]);
          box(x + 0.12, y + 0.19, 0, 0.22, 0.36, 0.36, [158, 159, 147]);
          box(x + 0.17, y + 0.553, 0.24, 0.1, 0.015, 0.018, [79, 82, 76]);
          box(x + 0.17, y + 0.553, 0.1, 0.1, 0.015, 0.018, [79, 82, 76]);
          box(x + 0.83, y + 0.2, 0, 0.04, 0.36, 0.36, [123, 126, 116]);
          box(x + 0.43, y + 0.27, 0.405, 0.24, 0.2, 0.22, [207, 207, 184]);
          box(x + 0.452, y + 0.472, 0.434, 0.19, 0.008, 0.164, [16, 28, 25]);
          box(x + 0.45, y + 0.5, 0.405, 0.22, 0.08, 0.018, [177, 178, 162]);
          box(x + 0.52, y + 0.7, 0.22, 0.28, 0.24, 0.045, [55, 60, 57]);
          box(x + 0.52, y + 0.89, 0.26, 0.28, 0.045, 0.28, [47, 53, 49]);
          box(x + 0.64, y + 0.79, 0.04, 0.035, 0.035, 0.18, [31, 36, 32]);
          box(x + 0.5, y + 0.79, 0.025, 0.32, 0.03, 0.025, [32, 37, 32]);
          box(x + 0.64, y + 0.66, 0.025, 0.03, 0.28, 0.025, [32, 37, 32]);
        }
    return;
  }
  for (let y = 1; y < N - 1; y++)
    for (let x = 1; x < N - 1; x++)
      if (grid[y][x]) {
        const corners = [
            [x, y, 1],
            [x + 1, y, 1],
            [x + 1, y + 1, 1],
            [x, y + 1, 1],
          ],
          peak = [x + 0.5, y + 0.5, 1.48];
        const shades = [
          [148, 94, 53],
          [112, 66, 35],
          [96, 54, 29],
          [170, 113, 66],
        ];
        for (let i = 0; i < 4; i++) face([corners[i], corners[(i + 1) % 4], peak], shades[i]);
      }
}

const MISSION_LEVELS = PHASE_ORDER;
const MISSIONS = [
  {
    id: 'first',
    name: 'Primeiros passos',
    text: 'Entre em uma partida.',
    key: 'explored',
    goal: 1,
  },
  {
    id: 'explore3',
    name: 'Explorador curioso',
    text: 'Jogue em 3 cenários diferentes.',
    key: 'explored',
    goal: 3,
  },
  {
    id: 'explore10',
    name: 'Conhecedor das Backrooms',
    text: 'Jogue nas ' + PHASE_ORDER.length + ' fases disponíveis.',
    key: 'explored',
    goal: PHASE_ORDER.length,
  },
  {
    id: 'fuse1',
    name: 'Uma luz de esperança',
    text: 'Encontre 1 fusível em uma partida.',
    key: 'fuses',
    goal: 1,
  },
  {
    id: 'fuse3',
    name: 'Eletricista',
    text: 'Encontre os 3 fusíveis na mesma partida.',
    key: 'fuses',
    goal: 3,
  },
  ...[10, 25, 50].map(n => ({
    id: 'coins' + n,
    name: n === 25 ? 'Reserva de emergência' : 'Tesouro de ' + n,
    text: 'Acumule ' + n + ' moedas de saldo em uma partida Normal.',
    key: 'coins',
    goal: n,
  })),
  ...[1, 3, 10].map(n => ({
    id: 'wins' + n,
    name: n === 1 ? 'De volta para casa' : n === 3 ? 'Escapista' : 'Veterano',
    text: 'Vença ' + n + (n === 1 ? ' partida.' : ' partidas.'),
    key: 'wins',
    goal: n,
  })),
  {
    id: 'coop',
    name: 'Melhor acompanhado',
    text: 'Jogue com pelo menos outro explorador na sala.',
    key: 'coop',
    goal: 1,
  },
  {
    id: 'coopwin',
    name: 'Saída em equipe',
    text: 'Vença uma partida com pelo menos 2 jogadores.',
    key: 'coopWins',
    goal: 1,
  },
  {
    id: 'rescue',
    name: 'Segunda chance',
    text: 'Use 25 moedas para reviver no Normal.',
    key: 'rescues',
    goal: 1,
  },
  {
    id: 'hard',
    name: 'Sem segunda chance',
    text: 'Vença uma partida Hardcore.',
    key: 'hardWins',
    goal: 1,
  },
  ...MISSION_LEVELS.map(level => ({
    id: 'win-' + level,
    name: LEVEL_INFO[level].name,
    text: 'Fusíveis necessários: ' + phaseFuseCount(level) + '. Encontre a saída.',
    key: 'win-' + level,
    goal: 1,
  })),
];
function trackMissions() {
  if (builder.custom) return;
  if (state !== 'playing' || net?.dead) return;
  missionSet('visit-' + activeLevel, 1);
  missionSet('explored', MISSION_LEVELS.filter(k => missionValue('visit-' + k) > 0).length);
  missionSet('fuses', fuses.filter(f => f.taken).length);
  missionSet('coins', coinBalance);
  if (net && net.room.players.length >= 2) missionSet('coop', 1);
}
function recordMissionWin() {
  if (builder.custom) return;
  if (missionWon) return;
  missionWon = true;
  const roundKey = net
    ? 'credited-' + net.code + '-' + net.room.started + '-' + net.room.round
    : null;
  if (roundKey && missionValue(roundKey)) return;
  if (roundKey) missionSet(roundKey, 1);
  if (net) {
    if (net.room.campaign && activeLevel === PHASE_ORDER.at(-1))
      void submitLeaderboardTime().catch(() => {});
  } else {
    if (PHASE_ORDER[soloCompleted] === activeLevel) soloCompleted++;
    if (soloCompleted === PHASE_ORDER.length) void submitLeaderboardTime().catch(() => {});
  }
  // Preserve team wins even if the explorer is watching from the room menu.
  missionSet('visit-' + activeLevel, 1);
  missionSet('explored', MISSION_LEVELS.filter(k => missionValue('visit-' + k) > 0).length);
  missionSet('fuses', fuses.filter(f => f.taken).length);
  missionSet('coins', coinBalance);
  missionAdd('wins');
  missionSet('win-' + activeLevel, 1);
  if (activeMode === 'hardcore') missionAdd('hardWins');
  if (net && net.room.players.length >= 2) {
    missionSet('coop', 1);
    missionAdd('coopWins');
  }
}
async function submitLeaderboardTime() {
  if (builder.custom) return;
  if (isAdmin() || net?.room.adminUsed) return;
  if (
    net
      ? !net.room.campaign || net.room.status !== 'won' || activeLevel !== PHASE_ORDER.at(-1)
      : soloCompleted !== PHASE_ORDER.length
  )
    return;
  const payload = {
    name: $('nickname').value.trim(),
    milliseconds: Math.round(soloCampaignElapsed * 1000),
    level: activeLevel,
    completed: true,
    phases: PHASE_ORDER.length,
    ...(net ? { code: net.code, id: net.id, token: net.token } : {}),
  };
  for (let attempt = 0; attempt < 3; attempt++)
    try {
      return await requestRoom('submit', payload, '/api/leaderboard/');
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 800 * (attempt + 1)));
    }
}
function formatLeaderboardTime(milliseconds) {
  const total = Math.floor(milliseconds / 1000),
    hundredths = Math.floor((milliseconds % 1000) / 10);
  return (
    String(Math.floor(total / 60)).padStart(2, '0') +
    ':' +
    String(total % 60).padStart(2, '0') +
    ',' +
    String(hundredths).padStart(2, '0')
  );
}
async function openLeaderboard() {
  closeChat(false);
  if (state === 'playing') pause();
  leaderboardReturn = !$('lobbyPanel').hidden
    ? 'lobby'
    : !$('pausePanel').hidden
      ? 'pause'
      : 'home';
  showPanel('leaderboard');
  $('leaderboardStatus').textContent = 'Carregando tempos…';
  $('leaderboardList').replaceChildren();
  try {
    const data = await requestRoom('top', {}, '/api/leaderboard/');
    $('leaderboardStatus').textContent = data.entries.length
      ? 'Quem zerou o jogo em menos tempo'
      : 'Ainda ninguém zerou o jogo. Seja o primeiro!';
    for (const [index, entry] of data.entries.entries()) {
      const row = document.createElement('article');
      row.className = 'leaderboard-row';
      const position = document.createElement('strong');
      position.textContent = String(index + 1).padStart(2, '0');
      const name = document.createElement('span');
      name.textContent = entry.name;
      const time = document.createElement('time');
      time.textContent = formatLeaderboardTime(entry.milliseconds);
      row.append(position, name, time);
      $('leaderboardList').append(row);
    }
  } catch (error) {
    $('leaderboardStatus').textContent =
      'Não foi possível carregar o ranking. Confira a conexão e tente novamente.';
  }
}
function closeLeaderboard() {
  showPanel(leaderboardReturn);
}
for (const id of ['leaderboardHome', 'leaderboardLobby', 'leaderboardPause'])
  $(id).onclick = openLeaderboard;
$('closeLeaderboard').onclick = closeLeaderboard;
function openMissions() {
  closeChat(false);
  if (state === 'playing') pause();
  missionReturn = !$('lobbyPanel').hidden ? 'lobby' : !$('pausePanel').hidden ? 'pause' : 'home';
  const panel = $('missionsPanel');
  const heading = panel?.firstElementChild || panel?.children?.[0];
  if (heading && !$('missionSettings')) {
    const settings = document.createElement('button');
    settings.id = 'missionSettings';
    settings.className = 'mission-settings';
    settings.type = 'button';
    settings.textContent = '⚙️ CONFIGURAÇÕES';
    settings.setAttribute('aria-label', 'Voltar para configurações');
    settings.onclick = closeMissions;
    heading.prepend(settings);
  }
  showPanel('missions');
  renderMissions();
}
function closeMissions() {
  showPanel(missionReturn);
}
function renderMissions() {
  const completed = MISSIONS.filter(m => missionValue(m.key) >= m.goal).length;
  $('missionSummary').textContent = completed + ' / ' + MISSIONS.length + ' missões concluídas';
  $('missionList').replaceChildren();
  for (const m of MISSIONS) {
    const value = Math.min(m.goal, missionValue(m.key)),
      done = value >= m.goal;
    if ((missionFilter === 'pending' && done) || (missionFilter === 'done' && !done)) continue;
    const row = document.createElement('article');
    row.className = 'mission-card' + (done ? ' complete' : '');
    const heading = document.createElement('h3');
    heading.textContent = (done ? '✓ ' : '') + m.name;
    const description = document.createElement('p');
    description.textContent = m.text;
    const progress = document.createElement('progress');
    progress.max = m.goal;
    progress.value = value;
    progress.setAttribute('aria-label', m.name);
    const status = document.createElement('small');
    status.textContent = done ? 'CONCLUÍDA' : value + ' / ' + m.goal;
    row.append(heading, description, progress, status);
    $('missionList').append(row);
  }
  if (!$('missionList').children.length) {
    const empty = document.createElement('p');
    empty.textContent =
      missionFilter === 'done'
        ? 'Você ainda não concluiu missões. Entre em uma partida para começar!'
        : 'Todas as missões deste filtro foram concluídas!';
    $('missionList').append(empty);
  }
  for (const filter of ['all', 'pending', 'done'])
    $('missions-' + filter).setAttribute('aria-pressed', String(filter === missionFilter));
}
for (const id of ['missionsHome', 'missionsLobby', 'missionsPause']) $(id).onclick = openMissions;
$('missionsHeader').onclick = () => ($('missionsPanel').hidden ? openMissions() : closeMissions());
$('closeMissions').onclick = closeMissions;
for (const filter of ['all', 'pending', 'done'])
  $('missions-' + filter).onclick = () => {
    missionFilter = filter;
    renderMissions();
  };

function renderChat() {
  const code = 'global';
  if (code !== chatRoom) {
    chatRoom = code;
    chatSeen.clear();
    chatRendered = '';
    chatPending = null;
    $('chatInput').value = '';
    $('chatMessages').replaceChildren();
  }
  const messages = globalMessages;
  $('chatPeople').textContent = globalSession
    ? globalOnline + ' online · Todas as salas'
    : 'Conectando ao chat global…';
  $('chatInput').disabled = $('chatSend').disabled = !globalSession || chatBusy;
  if (chatOpen) for (const m of messages) chatSeen.add(m.id);
  const unread = messages.filter(m => m.sender !== globalSession?.id && !chatSeen.has(m.id)).length;
  $('chatUnread').textContent = unread ? '(' + unread + ')' : '';
  const signature = code + ':' + messages.map(m => m.id).join(',');
  if (signature === chatRendered) return;
  chatRendered = signature;
  const list = $('chatMessages'),
    nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  list.replaceChildren();
  if (!messages.length) {
    const empty = document.createElement('p');
    empty.textContent = 'Nenhuma mensagem ainda. Diga oi para todos!';
    list.append(empty);
  }
  for (const m of messages) {
    const row = document.createElement('article');
    row.className = 'chat-message' + (m.sender === globalSession?.id ? ' mine' : '');
    row.style.borderColor = m.color;
    const name = document.createElement('strong');
    name.textContent = m.name + (m.sender === globalSession?.id ? ' (você)' : '');
    name.style.color = m.color;
    const body = document.createElement('p');
    body.textContent = m.text;
    row.append(name, body);
    list.append(row);
  }
  if (nearBottom || chatOpen) list.scrollTop = list.scrollHeight;
}
function openChat() {
  if (chatOpen) return;
  chatResume = state === 'playing';
  if (chatResume) pause();
  if (!$('missionsPanel').hidden) closeMissions();
  chatOpen = true;
  $('chatPanel').hidden = false;
  $('chatToggle').setAttribute('aria-expanded', 'true');
  keys = {};
  resetMotion();
  renderChat();
  $('chatError').textContent = '';
  void syncGlobalChat();
  if (padActive) focusPad($('chatClose'));
  else $('chatInput').focus();
}
function closeChat(resume = true) {
  if (!chatOpen) return;
  chatOpen = false;
  $('chatPanel').hidden = true;
  $('chatToggle').setAttribute('aria-expanded', 'false');
  if (padEditor?.input.id === 'chatInput') closePadKeyboard(false);
  keys = {};
  if (resume && chatResume && state === 'paused') start();
  chatResume = false;
}
async function ensureGlobalSession() {
  if (globalSession) return;
  try {
    globalSession = JSON.parse(sessionStorage.getItem('backrooms.globalChat') || 'null');
  } catch {}
  if (globalSession?.id && globalSession?.token) return;
  globalSession = await requestRoom(
    'session',
    { name: $('nickname').value.trim() || 'Explorador' },
    '/api/global/',
  );
  try {
    sessionStorage.setItem('backrooms.globalChat', JSON.stringify(globalSession));
  } catch {}
}
async function syncGlobalChat() {
  clearTimeout(globalTimer);
  if (globalBusy) {
    globalTimer = setTimeout(syncGlobalChat, 4000);
    return;
  }
  globalBusy = true;
  try {
    await ensureGlobalSession();
    const data = await requestRoom(
      'poll',
      { ...globalSession, name: $('nickname').value.trim() || undefined },
      '/api/global/',
    );
    if (
      !globalMessages.length ||
      !data.messages.length ||
      data.messages.at(-1).id >= globalMessages.at(-1).id
    )
      globalMessages = data.messages;
    globalOnline = data.online;
    renderChat();
  } catch (e) {
    if (e.status === 401) {
      globalSession = null;
      try {
        sessionStorage.removeItem('backrooms.globalChat');
      } catch {}
    }
    if (chatOpen) $('chatError').textContent = e.message;
  } finally {
    globalBusy = false;
    globalTimer = setTimeout(syncGlobalChat, 4000);
  }
}
async function sendChat() {
  if (chatBusy) return;
  const text = $('chatInput').value.trim();
  if (!text) return;
  chatBusy = true;
  $('chatError').textContent = '';
  renderChat();
  if (!chatPending || chatPending.text !== text)
    chatPending = {
      text,
      messageId: crypto.randomUUID
        ? crypto.randomUUID()
        : Array.from(crypto.getRandomValues(new Uint8Array(16)), n =>
            n.toString(16).padStart(2, '0'),
          ).join(''),
    };
  try {
    await ensureGlobalSession();
    const data = await requestRoom(
      'send',
      { ...globalSession, name: $('nickname').value.trim() || undefined, ...chatPending },
      '/api/global/',
    );
    chatPending = null;
    $('chatInput').value = '';
    globalMessages = data.messages;
    globalOnline = data.online;
    chatRendered = '';
  } catch (e) {
    if (e.status === 401) {
      globalSession = null;
      try {
        sessionStorage.removeItem('backrooms.globalChat');
      } catch {}
    }
    $('chatError').textContent = e.message;
  } finally {
    chatBusy = false;
    renderChat();
    if (chatOpen && !padActive) $('chatInput').focus();
  }
}
// Global chat starts after the explorer enters their name.
$('chatToggle').onclick = () => (chatOpen ? closeChat() : openChat());
$('chatClose').onclick = () => closeChat();
$('chatForm').onsubmit = e => {
  e.preventDefault();
  void sendChat();
};
renderChat();
async function enterExplorer() {
  if (explorerEntering) return false;
  const name = $('nickname')
    .value.trim()
    .replace(/[\x00-\x1f\x7f]/g, '')
    .normalize('NFKC');
  if (!name || name.length > 32) {
    $('nameError').textContent = 'Escreva um nome com até 32 caracteres.';
    $('nickname').focus();
    return false;
  }
  explorerEntering = true;
  $('enterExplorer').disabled = true;
  $('nameError').textContent = 'Carregando suas missões…';
  playMusic(menuMusic);
  try {
    await flushMissions();
    const result = await requestRoom('load', { name }, '/api/profiles/');
    const pending = loadMissions('backrooms.pending.' + result.profile);
    // Assign the old device progress only once, never to every new name.
    let legacy = {};
    try {
      let owner = localStorage.getItem('backrooms.legacyMissionOwner');
      if (!owner) {
        owner = result.profile;
        localStorage.setItem('backrooms.legacyMissionOwner', owner);
      }
      if (owner === result.profile) legacy = loadMissions();
    } catch {}
    missionProfile = result.profile;
    missionProgress = result.progress;
    missionPending = {};
    for (const source of [legacy, pending])
      for (const [key, value] of Object.entries(source))
        if (Number.isSafeInteger(value) && value >= 0 && value > missionValue(key)) {
          missionProgress[key] = value;
          missionPending[key] = value;
        }
    rememberPending();
    await flushMissions();
    try {
      localStorage.setItem(MISSION_STORAGE, '{}');
      localStorage.setItem('backrooms.explorerName', name);
    } catch {}
    missionWon = false;
    renderMissions();
    $('nickname').value = name;
    $('nameError').textContent = '';
    $('nameGate').hidden = true;
    document.body.classList.remove('entering-name');
    $('explorerWelcome').textContent = 'Explorador: ' + name;
    showPanel('home');
    syncMenuMusic();
    void syncGlobalChat();
    return true;
  } catch (error) {
    $('nameError').textContent =
      'Não foi possível carregar ou salvar suas missões. Tente entrar novamente.';
    return false;
  } finally {
    explorerEntering = false;
    $('enterExplorer').disabled = false;
  }
}
$('nameForm').onsubmit = e => {
  e.preventDefault();
  enterExplorer();
};
$('changeExplorer').onclick = () => {
  closeChat(false);
  $('nameGate').hidden = false;
  document.body.classList.add('entering-name');
  $('nickname').focus();
};
try {
  $('nickname').value = localStorage.getItem('backrooms.explorerName') || '';
} catch {}

document.addEventListener('game-language-change', () => {
  if (state === 'playing') pause();
});

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
  if (state !== 'playing' || chatOpen) {
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
$('moveJoystick').addEventListener('pointerdown', e => {
  if (
    state !== 'playing' ||
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
    if (e.pointerId === touchLookPointer) {
      touchLookPointer = null;
      touchX = null;
    }
  });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) resetJoystick();
});

for (const [id, info] of Object.entries(LEVEL_INFO)) {
  if (id === 'custom') continue;
  const option = document.createElement('option');
  option.value = id;
  option.textContent = info.name;
  $('adminMap').append(option);
}
$('adminGo').onclick = async () => {
  if (!isAdmin()) return;
  const level = $('adminMap').value;
  if (!LEVEL_INFO[level]) return;
  $('adminGo').disabled = true;
  $('adminMessage').textContent = '';
  try {
    if (net) {
      const session = net;
      const data = await requestRoom('admin-level', { ...roomPayload(), level });
      if (net !== session) return;
      applySnapshot(data);
    } else {
      soloCampaignElapsed = 0;
      soloCompleted = 0;
      reset(undefined, level, selectedMode);
      state = 'playing';
      showPanel('pause');
      document.body.classList.add('playing');
      initAudio();
      syncMenuMusic();
      syncGameMusic();
      void enterLandscape();
      lock();
    }
  } catch (error) {
    $('adminMessage').textContent = error.message;
  } finally {
    $('adminGo').disabled = false;
  }
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
        { ...globalSession, name: $('nickname').value.trim() },
        '/api/global/',
      );
    } catch (e) {
      if (e.status !== 401) throw e;
      globalSession = null;
      await ensureGlobalSession();
    }
    body = { ...body, sessionId: globalSession.id, sessionToken: globalSession.token };
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
  grid = world.grid;
  fuses = world.fuses;
  coins = world.coins;
  exit = world.exit;
  enemy = world.enemy;
  smile = world.smile;
  if (resetPlayer) {
    player = { ...world.spawn };
    elapsed = 0;
    stamina = 100;
    coinBalance = 0;
    soloProtectedUntil = 0;
    soloEnemySpawn = enemy ? { ...enemy } : null;
    resetMotion();
    viewPitch = 0;
    keys = {};
  }
  activeLevel = 'custom';
  activeMode = 'normal';
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
  state = 'playing';
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
  if (solid(player.x, player.y)) player = { ...builder.map.spawn };
  builderUpdateFields();
  persistBuilderDraft();
  builderMessage(redo ? 'Alteração refeita.' : 'Alteração desfeita.');
}
function openBuilderPalette() {
  if (!builder.editing) return;
  $('builderPalette').hidden = false;
  resetMotion();
  keys = {};
  document.exitPointerLock?.();
}
function closeBuilderPalette() {
  if (!builder.editing) return;
  $('builderPalette').hidden = true;
  state = 'playing';
  keys = {};
  document.body.classList.add('playing');
  lock();
}
function builderTarget() {
  let previous = { x: Math.floor(player.x), y: Math.floor(player.y) },
    last = previous;
  // Pitch lowers the placement plane, while walls stop the aim ray.
  const reach = viewPitch < -10 ? Math.min(4, Math.max(0.8, (H * 0.5) / -viewPitch)) : 3;
  for (let d = 0.18; d <= reach; d += 0.04) {
    const x = Math.floor(player.x + Math.cos(player.a) * d),
      y = Math.floor(player.y + Math.sin(player.a) * d);
    if (x < 0 || y < 0 || x > 20 || y > 20) break;
    last = { x, y };
    if (grid[y][x]) return { hit: last, place: previous };
    if (x !== previous.x || y !== previous.y) previous = last;
  }
  return { hit: last, place: last };
}
function builderApply(erase = false) {
  if (!builder.editing || builder.busy || state !== 'playing' || !$('builderPalette').hidden)
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
    Math.hypot(player.x - x, player.y - y) < 1
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
      m.spawn = { x, y, a: (Math.round(player.a / (Math.PI / 2)) * Math.PI) / 2 };
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
  if (state !== 'playing' || !$('builderPalette').hidden || chatOpen) {
    resetMotion();
    return;
  }
  let forward = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0),
    side = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  if (padInput.x || padInput.y) {
    forward = -padInput.y;
    side = padInput.x;
  }
  if (touchMove.pointer !== null) {
    forward = -touchMove.y;
    side = touchMove.x;
  }
  player.a +=
    ((keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0)) * dt * 1.9 + padInput.lookX * dt * 1.85;
  viewPitch = Math.max(-H * 0.6, Math.min(H * 0.4, viewPitch - padInput.lookY * dt * 95));
  smoothWalk(forward, side, keys.ShiftLeft || padInput.run ? 3.1 : 1.85, dt);
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
    const dx = v[0] - player.x,
      dy = v[1] - player.y,
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
  state = 'playing';
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
  state = 'playing';
  $('builderReturn').hidden = $('customGalleryReturn').hidden = true;
  $('builderHud').hidden = false;
  document.body.classList.add('building', 'playing');
  refreshCustomWorld(true);
  builderUpdateFields();
  openBuilderPalette();
}
function finishCustom(win) {
  resetMotion();
  keys = {};
  state = win ? 'won' : 'lost';
  document.body.classList.remove('playing');
  document.exitPointerLock?.();
  showPanel('pause');
  $('story').textContent = win ? 'Você escapou deste mapa!' : 'O monstro encontrou você.';
  $('details').textContent = win
    ? builder.custom.title + ' · Tempo: ' + formatLeaderboardTime(Math.round(elapsed * 1000))
    : 'Tente novamente ou volte para editar o mapa.';
  $('start').textContent = 'JOGAR NOVAMENTE';
  $('start').hidden = false;
  syncMenuMusic();
  syncGameMusic();
  updateRescueUI();
}
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

// North-up overview: the same collision grid and objectives used by the current world.
function resetLevelMap() {
  mapVisible = activeMode !== 'hardcore';
  mapPaintedAt = -Infinity;
  $('levelMap').hidden = !mapVisible;
  $('mapToggle').hidden = !mapVisible;
  $('mapToggle').setAttribute('aria-pressed', String(mapVisible));
}
function toggleLevelMap() {
  if (activeMode === 'hardcore') {
    resetLevelMap();
    return;
  }
  mapVisible = !mapVisible;
  $('levelMap').hidden = !mapVisible;
  $('mapToggle').setAttribute('aria-pressed', String(mapVisible));
  mapPaintedAt = -Infinity;
  drawLevelMap(performance.now());
}
function drawLevelMap(now) {
  if (
    activeMode === 'hardcore' ||
    !mapVisible ||
    state !== 'playing' ||
    builder.editing ||
    !grid.length ||
    now - mapPaintedAt < 80
  )
    return;
  mapPaintedAt = now;
  const c = $('mapCanvas'),
    m = c.getContext('2d'),
    unit = c.width / grid.length;
  m.fillStyle = '#101914';
  m.fillRect(0, 0, c.width, c.height);
  for (let y = 0; y < grid.length; y++)
    for (let x = 0; x < grid[y].length; x++) {
      m.fillStyle = grid[y][x] === 0 ? '#34453b' : grid[y][x] === 2 ? '#77806a' : '#b9b18e';
      m.fillRect(x * unit, y * unit, unit, unit);
    }
  if (exit && (!builder.custom || builder.custom.exit)) {
    const x = exit.x * unit,
      y = exit.y * unit;
    m.fillStyle = fuses.every(f => f.taken) ? '#83f6a1' : '#d0edcf';
    m.fillRect(x - unit * 0.65, y - unit * 0.65, unit * 1.3, unit * 1.3);
    m.fillStyle = '#12321d';
    m.fillRect(x - unit * 0.34, y - unit * 0.4, unit * 0.68, unit * 0.92);
  }
  for (const f of fuses)
    if (!f.taken) {
      const x = f.x * unit,
        y = f.y * unit;
      m.fillStyle = '#ffda58';
      m.strokeStyle = '#151b17';
      m.lineWidth = 2;
      m.beginPath();
      m.moveTo(x, y - unit * 0.65);
      m.lineTo(x + unit * 0.6, y);
      m.lineTo(x, y + unit * 0.65);
      m.lineTo(x - unit * 0.6, y);
      m.closePath();
      m.fill();
      m.stroke();
    }
  const x = player.x * unit,
    y = player.y * unit,
    a = player.a;
  m.save();
  m.translate(x, y);
  m.rotate(a);
  m.fillStyle = '#65e7ff';
  m.strokeStyle = '#071b23';
  m.lineWidth = 2;
  m.beginPath();
  m.moveTo(unit * 0.95, 0);
  m.lineTo(-unit * 0.65, -unit * 0.6);
  m.lineTo(-unit * 0.38, 0);
  m.lineTo(-unit * 0.65, unit * 0.6);
  m.closePath();
  m.fill();
  m.stroke();
  m.restore();
}
$('mapToggle').onclick = toggleLevelMap;

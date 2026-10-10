// Perfil do explorador, missões, progresso salvo e painel de missões.
import { PHASE_ORDER, phaseFuseCount } from '@backrooms/shared/world.js';
import { menuMusic, playMusic, syncMenuMusic } from './audio.js';
import { builder } from './builder.js';
import { closeChat, syncGlobalChat } from './chat.js';
import { $ } from './dom.js';
import { pause } from './engine.js';
import { submitLeaderboardTime } from './leaderboard.js';
import { LEVEL_INFO } from './levels.js';
import { net, requestRoom, showPanel } from './net.js';
import { game } from './state.js';

const MISSION_STORAGE = 'backrooms.missions.v1';
let missionProfile = '',
  missionPending = {},
  missionTimer = null,
  missionSaving = null,
  explorerEntering = false;
let missionProgress = {},
  missionReturn = 'home',
  missionFilter = 'all';
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
  if (game.state !== 'playing' || net?.dead) return;
  missionSet('visit-' + game.activeLevel, 1);
  missionSet('explored', MISSION_LEVELS.filter(k => missionValue('visit-' + k) > 0).length);
  missionSet('fuses', game.fuses.filter(f => f.taken).length);
  missionSet('coins', game.coinBalance);
  if (net && net.room.players.length >= 2) missionSet('coop', 1);
}
function recordMissionWin() {
  if (builder.custom) return;
  if (game.missionWon) return;
  game.missionWon = true;
  const roundKey = net
    ? 'credited-' + net.code + '-' + net.room.started + '-' + net.room.round
    : null;
  if (roundKey && missionValue(roundKey)) return;
  if (roundKey) missionSet(roundKey, 1);
  if (net) {
    if (net.room.campaign && game.activeLevel === PHASE_ORDER.at(-1))
      void submitLeaderboardTime().catch(() => {});
  } else {
    if (PHASE_ORDER[game.soloCompleted] === game.activeLevel) game.soloCompleted++;
    if (game.soloCompleted === PHASE_ORDER.length) void submitLeaderboardTime().catch(() => {});
  }
  // Preserve team wins even if the explorer is watching from the room menu.
  missionSet('visit-' + game.activeLevel, 1);
  missionSet('explored', MISSION_LEVELS.filter(k => missionValue('visit-' + k) > 0).length);
  missionSet('fuses', game.fuses.filter(f => f.taken).length);
  missionSet('coins', game.coinBalance);
  missionAdd('wins');
  missionSet('win-' + game.activeLevel, 1);
  if (game.activeMode === 'hardcore') missionAdd('hardWins');
  if (net && net.room.players.length >= 2) {
    missionSet('coop', 1);
    missionAdd('coopWins');
  }
}
function openMissions() {
  closeChat(false);
  if (game.state === 'playing') pause();
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
    game.missionWon = false;
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

function setupMissions() {
  for (const id of ['missionsHome', 'missionsLobby', 'missionsPause']) $(id).onclick = openMissions;
  $('missionsHeader').onclick = () =>
    $('missionsPanel').hidden ? openMissions() : closeMissions();
  $('closeMissions').onclick = closeMissions;
  for (const filter of ['all', 'pending', 'done'])
    $('missions-' + filter).onclick = () => {
      missionFilter = filter;
      renderMissions();
    };
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
}

export {
  closeMissions,
  enterExplorer,
  missionAdd,
  missionSet,
  recordMissionWin,
  setupMissions,
  trackMissions,
};

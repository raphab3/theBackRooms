// Ranking global por fase e campanha.
import { PHASE_ORDER } from '@backrooms/shared/world.js';
import { builder } from './builder.js';
import { closeChat } from './chat.js';
import { $ } from './dom.js';
import { pause } from './engine.js';
import { net, requestRoom, showPanel } from './net.js';
import { game } from './state.js';

async function submitLeaderboardTime() {
  if (builder.custom) return;
  if (net?.room.adminUsed) return;
  if (
    net
      ? !net.room.campaign || net.room.status !== 'won' || game.activeLevel !== PHASE_ORDER.at(-1)
      : game.soloCompleted !== PHASE_ORDER.length
  )
    return;
  const payload = {
    name: $('nickname').value.trim(),
    milliseconds: Math.round(game.soloCampaignElapsed * 1000),
    level: game.activeLevel,
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
  if (game.state === 'playing') pause();
  game.leaderboardReturn = !$('lobbyPanel').hidden
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
  showPanel(game.leaderboardReturn);
}

function setupLeaderboard() {
  for (const id of ['leaderboardHome', 'leaderboardLobby', 'leaderboardPause'])
    $(id).onclick = openLeaderboard;
  $('closeLeaderboard').onclick = closeLeaderboard;
}

export { closeLeaderboard, formatLeaderboardTime, setupLeaderboard, submitLeaderboardTime };

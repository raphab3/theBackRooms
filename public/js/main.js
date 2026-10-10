// Ponto de entrada: liga os eventos de cada módulo e inicia o jogo, na ordem original.
import { setupAdmin } from './admin.js';
import { setupAudio } from './audio.js';
import { setupBuilder } from './builder.js';
import { renderChat, setupChat } from './chat.js';
import { $ } from './dom.js';
import { reset, setupEngine, tick } from './engine.js';
import { setupFullscreen } from './fullscreen.js';
import { setupGamepad } from './gamepad.js';
import { setupLeaderboard } from './leaderboard.js';
import { setupLevelmap } from './levelmap.js';
import { setupMissions } from './missions.js';
import { setupModes, updateModeButtons } from './modes.js';
import { setupNet, showPanel } from './net.js';
import { drawExplorer, makeTextures } from './render.js';
import { setupRevive, updateRescueUI } from './revive.js';
import { game } from './state.js';
import { setupTouch } from './touch.js';

makeTextures('backrooms');
setupEngine();
setupAudio();
setupTouch();
reset(93451);
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
          state: game.state,
          fuses: game.fuses.filter(f => f.taken).length,
          seconds: Math.floor(game.elapsed),
        }),
      }),
    ).catch(() => {});
  } catch {}
}
setupNet();
const invitationCode = new URLSearchParams(location.search).get('sala');
if (invitationCode) $('roomCode').value = invitationCode.toUpperCase().slice(0, 6);
const portrait = $('portrait');
drawExplorer(portrait.getContext('2d'), 15, 0, 70, 150, '#ddbc45');
showPanel('home');
setupFullscreen();
setupRevive();
updateRescueUI();
setupGamepad();
setupModes();
updateModeButtons();
setupLeaderboard();
setupMissions();
setupChat();
renderChat();
try {
  $('nickname').value = localStorage.getItem('backrooms.explorerName') || '';
} catch {}
setupAdmin();
setupBuilder();
setupLevelmap();

// Painel de admin: ir direto para qualquer fase.
import { initAudio, syncGameMusic, syncMenuMusic } from './audio.js';
import { $ } from './dom.js';
import { lock, reset } from './engine.js';
import { enterLandscape } from './fullscreen.js';
import { LEVEL_INFO } from './levels.js';
import { selectedMode } from './modes.js';
import { isAdmin, net, sendAction, showPanel } from './net.js';
import { game } from './state.js';

function setupAdmin() {
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
        sendAction('level', { level });
      } else {
        game.soloCampaignElapsed = 0;
        game.soloCompleted = 0;
        reset(undefined, level, selectedMode);
        game.state = 'playing';
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
}

export { setupAdmin };

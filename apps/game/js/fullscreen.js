// Tela cheia e orientação em modo paisagem.
import { $ } from './dom.js';
import { pause, say } from './engine.js';
import { net } from './net.js';
import { game } from './state.js';

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
function orientationChanged() {
  if (matchMedia('(pointer:coarse) and (orientation:portrait)').matches) {
    game.keys = {};
    game.touchX = null;
    if (!net && game.state === 'playing') pause();
  }
}

function setupFullscreen() {
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
  window.addEventListener('resize', orientationChanged);
  globalThis.screen?.orientation?.addEventListener('change', orientationChanged);
}

export { enterLandscape, setupFullscreen };

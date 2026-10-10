// Músicas de menu/jogo e efeitos sonoros gerados (Web Audio).
import { $ } from './dom.js';
import { game } from './state.js';

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
  const shouldPlay = !inGame && !game.muted && $('nameGate').hidden;
  if (shouldPlay) {
    pauseMusic(gameMusic);
    playMusic(menuMusic);
  } else pauseMusic(menuMusic);
}
function syncGameMusic() {
  if (!gameMusic) return;
  const shouldPlay = document.body.classList.contains('playing') && !game.muted;
  if (shouldPlay) {
    pauseMusic(menuMusic);
    playMusic(gameMusic);
  } else pauseMusic(gameMusic);
}
function initAudio() {
  try {
    if (!game.audio) {
      game.audio = new (window.AudioContext || window.webkitAudioContext)();
      game.gain = game.audio.createGain();
      game.gain.gain.value = 0.025;
      game.gain.connect(game.audio.destination);
      game.osc = game.audio.createOscillator();
      game.osc.type = 'sawtooth';
      game.osc.frequency.value = 60;
      let filter = game.audio.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 160;
      game.osc.connect(filter);
      filter.connect(game.gain);
      game.osc.start();
    }
    game.audio.resume();
  } catch {}
}
function tone(freq, dur, vol = 0.07) {
  if (!game.audio || game.muted) return;
  let o = game.audio.createOscillator(),
    g = game.audio.createGain();
  o.frequency.value = freq;
  o.type = 'sine';
  g.gain.setValueAtTime(vol, game.audio.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, game.audio.currentTime + dur);
  o.connect(g);
  g.connect(game.audio.destination);
  o.start();
  o.stop(game.audio.currentTime + dur);
}

function setupAudio() {
  $('sound').onclick = () => {
    game.muted = !game.muted;
    $('sound').textContent = game.muted ? 'SOM: OFF' : 'SOM: ON';
    if (game.gain) game.gain.gain.value = game.muted ? 0 : 0.025;
    syncMenuMusic();
    syncGameMusic();
  };
}

export {
  gameMusic,
  initAudio,
  menuMusic,
  playMusic,
  setupAudio,
  syncGameMusic,
  syncMenuMusic,
  tone,
};

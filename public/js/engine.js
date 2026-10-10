// Núcleo do jogo: estado da fase, física, monstro, loop e entrada de teclado/mouse.
import { PHASE_ORDER, createWorld } from '../world.js';
import { gameMusic, initAudio, playMusic, syncGameMusic, syncMenuMusic, tone } from './audio.js';
import {
  builder,
  builderApply,
  builderUndo,
  closeBuilderPalette,
  finishCustom,
  launchCustomMap,
  openBuilderPalette,
  updateBuilder,
} from './builder.js';
import { chatOpen, closeChat, openChat } from './chat.js';
import { $, H, canvas } from './dom.js';
import { enterLandscape } from './fullscreen.js';
import { padActive, padInput, padSensitivity, pollController } from './gamepad.js';
import { closeLeaderboard, formatLeaderboardTime } from './leaderboard.js';
import { drawLevelMap, resetLevelMap, toggleLevelMap } from './levelmap.js';
import { LEVEL_INFO } from './levels.js';
import { closeMissions, recordMissionWin, trackMissions } from './missions.js';
import { selectedMode, updateModeUI } from './modes.js';
import {
  interpolateRemote,
  net,
  recordMovement,
  resetMovementTrail,
  resumeOnline,
  showLobby,
  showPanel,
} from './net.js';
import { makeTextures, render } from './render.js';
import { reviveAll, updateRescueUI } from './revive.js';
import { game } from './state.js';
import { resetJoystick, touchMove } from './touch.js';

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
    x = game.player.x,
    y = game.player.y;
  walkMotion.forward = active ? targetF + (walkMotion.forward - targetF) * decay : 0;
  walkMotion.side = active ? targetS + (walkMotion.side - targetS) * decay : 0;
  if (active) {
    const dx = Math.cos(game.player.a) * df - Math.sin(game.player.a) * ds,
      dy = Math.sin(game.player.a) * df + Math.cos(game.player.a) * ds;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 0.04));
    for (let i = 0; i < steps; i++) move(game.player, dx / steps, dy / steps);
  }
  const distance = Math.hypot(game.player.x - x, game.player.y - y);
  walkMotion.phase += distance * 4.8;
  walkMotion.bob += ((distance > 0.00001 ? 0.9 : 0) - walkMotion.bob) * (1 - Math.exp(-dt / 0.09));
}
let msgTime = 0,
  stepTimer = 0;
let seed = 93451;
function rand() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}
function solid(x, y) {
  return !game.grid[Math.floor(y)] || game.grid[Math.floor(y)][Math.floor(x)] !== 0;
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
  level = game.selectedLevel,
  mode = selectedMode,
) {
  resetMotion();
  game.missionWon = false;
  game.activeMode = mode === 'hardcore' ? 'hardcore' : 'normal';
  resetLevelMap();
  game.activeLevel = LEVEL_INFO[level] ? level : 'backrooms';
  makeTextures(game.activeLevel);
  $('levelLabel').textContent = LEVEL_INFO[game.activeLevel].name.toUpperCase();
  $('levelLabel').textContent =
    (PHASE_ORDER.includes(game.activeLevel)
      ? 'FASE ' + (PHASE_ORDER.indexOf(game.activeLevel) + 1) + ' / ' + PHASE_ORDER.length
      : 'MAPA ADMIN') +
    ' · ' +
    LEVEL_INFO[game.activeLevel].name.toUpperCase();
  const world = createWorld(worldSeed, game.activeLevel);
  game.grid = world.grid;
  game.player = world.spawn;
  game.enemy = world.enemy;
  game.smile = game.activeMode === 'hardcore' ? { ...world.smile } : null;
  game.exit = world.exit;
  game.fuses = world.fuses;
  game.coins = game.activeMode === 'hardcore' ? [] : world.coins;
  game.coinBalance = 0;
  game.soloProtectedUntil = 0;
  game.soloEnemySpawn = { ...world.enemy };
  game.elapsed = 0;
  game.stamina = 100;
  game.enemyPath = [];
  game.pathTimer = 0;
  game.light = true;
  game.viewPitch = 0;
  game.keys = {};
  resetMovementTrail();
  updateHud();
  updateRescueUI();
  updateModeUI();
  if (game.activeLevel === 'run')
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
  const n = game.fuses.filter(f => f.taken).length,
    total = game.fuses.length,
    done = n === total;
  $('count').textContent = n + ' / ' + total;
  document.querySelectorAll('.slots i').forEach((e, i) => {
    e.hidden = i >= total;
    e.classList.toggle('on', i < n);
  });
  $('objective').textContent =
    game.activeLevel === 'run'
      ? done
        ? 'CORRA ATÉ A SAÍDA!'
        : 'CORRA! 3 FUSÍVEIS NO CAMINHO'
      : done
        ? game.activeLevel === 'glitch-past'
          ? 'VOLTE AO MUNDO NORMAL'
          : game.activeLevel === 'glitch-shift'
            ? 'ATRAVESSE PARA O PASSADO'
            : 'ENCONTRE A PORTA VERDE'
        : game.activeLevel === 'glitch-past'
          ? 'SEU PASSADO · ENCONTRE OS FUSÍVEIS'
          : 'ENCONTRE OS FUSÍVEIS';
}
function say(text) {
  $('notice').textContent = text;
  msgTime = 4;
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
    if (game.state === 'lost' || game.state === 'won') {
      launchCustomMap(builder.custom, builder.testing);
      return;
    }
    game.state = 'playing';
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
  if (game.state === 'ready' || game.state === 'won') {
    game.soloCampaignElapsed = 0;
    game.soloCompleted = 0;
  }
  if (game.state === 'ready' || game.state === 'won' || game.state === 'lost')
    reset(undefined, game.state === 'lost' ? game.activeLevel : PHASE_ORDER[0], selectedMode);
  game.state = 'playing';
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
  if (game.state !== 'playing') return;
  resetMotion();
  game.touchLookPointer = null;
  game.touchX = null;
  game.padMenuNeutral = padActive;
  game.padLookSmooth = { x: 0, y: 0 };
  game.state = 'paused';
  game.keys = {};
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
  game.keys = {};
  game.touchX = null;
  game.touchLookPointer = null;
  if (win) recordMissionWin();
  if (win && !net) {
    const next = PHASE_ORDER[PHASE_ORDER.indexOf(game.activeLevel) + 1];
    if (next) {
      const mode = game.activeMode;
      reset(undefined, next, mode);
      game.state = 'playing';
      document.body.classList.add('playing');
      say(phaseIntro(next));
      return;
    }
  }
  showPanel('pause');
  game.state = win ? 'won' : 'lost';
  document.body.classList.remove('playing');
  syncMenuMusic();
  syncGameMusic();
  document.exitPointerLock?.();
  $('story').textContent = win ? 'Você encontrou o caminho de volta.' : 'Você não estava sozinho.';
  $('details').textContent = win
    ? 'Escapou com os 3 fusíveis em ' +
      Math.floor(game.elapsed / 60) +
      'min ' +
      Math.floor(game.elapsed % 60) +
      's.'
    : 'A criatura encontrou você. Corra com Shift e mantenha distância.';
  $('start').hidden = false;
  $('start').textContent = net ? 'VOLTAR À SALA' : win ? 'JOGAR NOVAMENTE' : 'TENTAR NOVAMENTE';
  if (win) {
    $('story').textContent = 'Você voltou ao mundo normal!';
    $('details').textContent =
      'O passado ficou para trás. Backrooms Glitch concluída! Tempo total: ' +
      formatLeaderboardTime(game.soloCampaignElapsed * 1000) +
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
  if (chatOpen || game.state !== 'playing') {
    resetMotion();
    return;
  }
  if (net && (!net.connected || net.dead)) {
    resetMotion();
    return;
  }
  trackMissions();
  game.elapsed += dt;
  if (!net) game.soloCampaignElapsed += dt;
  msgTime -= dt;
  if (msgTime <= 0) $('notice').textContent = '';
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
  const blend = 1 - Math.exp(-dt / 0.055);
  game.padLookSmooth.x =
    padInput.lookX === 0
      ? 0
      : game.padLookSmooth.x + (padInput.lookX - game.padLookSmooth.x) * blend;
  game.padLookSmooth.y =
    padInput.lookY === 0
      ? 0
      : game.padLookSmooth.y + (padInput.lookY - game.padLookSmooth.y) * blend;
  game.player.a += game.padLookSmooth.x * dt * 1.85 * padSensitivity;
  game.viewPitch = Math.max(
    -H * 0.24,
    Math.min(H * 0.24, game.viewPitch - game.padLookSmooth.y * dt * 95 * padSensitivity),
  );
  game.player.a += ((game.keys.ArrowRight ? 1 : 0) - (game.keys.ArrowLeft ? 1 : 0)) * dt * 1.9;
  let moving = forward || side,
    run = (game.keys.ShiftLeft || padInput.run) && game.stamina > 1 && moving,
    speed = run ? 3.1 : 1.85;
  game.stamina =
    game.activeLevel === 'run'
      ? 100
      : Math.max(0, Math.min(100, game.stamina + dt * (run ? -24 : 15)));
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
    for (const coin of game.coins)
      if (coin.taken && game.elapsed >= coin.respawnAt) coin.taken = false;
    for (const coin of game.coins)
      if (!coin.taken && Math.hypot(coin.x - game.player.x, coin.y - game.player.y) < 0.55) {
        coin.taken = true;
        coin.respawnAt = game.elapsed + 10;
        game.coinBalance++;
        tone(1000, 0.08, 0.035);
        updateRescueUI();
        if (game.coinBalance === 25) say('25 moedas! Aperte V se precisar reviver.');
      }
    for (const f of game.fuses)
      if (!f.taken && Math.hypot(f.x - game.player.x, f.y - game.player.y) < 0.65) {
        f.taken = true;
        updateHud();
        tone(700, 0.2);
        say(
          game.fuses.every(f => f.taken)
            ? 'Energia restaurada. Encontre a porta verde!'
            : 'Fusível coletado. Continue explorando.',
        );
      }
    let n = game.fuses.filter(f => f.taken).length;
    if (Math.hypot(game.player.x - game.exit.x, game.player.y - game.exit.y) < 0.7) {
      if (n === game.fuses.length) {
        finish(true);
        return;
      }
      say('Colete todos os fusíveis desta fase para abrir a saída.');
    }
    if (game.elapsed > (game.activeLevel === 'run' ? 6 : 22)) {
      for (const foe of builder.custom
        ? [game.enemy, game.smile].filter(Boolean)
        : game.activeMode === 'hardcore'
          ? [game.enemy, game.smile]
          : [game.enemy]) {
        if (!foe) continue;
        if (!foe.path?.length) {
          foe.path = route(
            Math.floor(foe.x),
            Math.floor(foe.y),
            Math.floor(game.player.x),
            Math.floor(game.player.y),
          ).slice(1);
        }
        let remaining =
          dt *
          (builder.custom
            ? builder.custom.monsterSpeed
            : game.activeLevel === 'run'
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
              Math.floor(game.player.x),
              Math.floor(game.player.y),
            ).slice(1);
          } else break;
        }
        let distance = Math.hypot(game.player.x - foe.x, game.player.y - foe.y);
        if (distance < 0.42 && game.elapsed >= game.soloProtectedUntil) {
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
  $('energy').style.width = game.stamina + '%';
  const clockText =
    String(Math.floor(game.elapsed / 60)).padStart(2, '0') +
    ':' +
    String(Math.floor(game.elapsed % 60)).padStart(2, '0');
  if ($('clock').textContent !== clockText) $('clock').textContent = clockText;
}
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

function setupEngine() {
  $('start').onclick = () => {
    if (net && (game.state === 'won' || game.state === 'lost' || net.dead)) {
      showLobby();
      return;
    }
    start();
  };
  $('pause').onclick = pause;
  $('flash').onclick = () => (game.light = !game.light);
  canvas.onclick = e => {
    if (builder.editing) {
      if (e.pointerType === 'touch' || matchMedia('(pointer:coarse)').matches) return;
      if (document.pointerLockElement === canvas) builderApply();
      else closeBuilderPalette();
      return;
    }
    if (game.state === 'playing') lock();
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
    game.keys[e.code] = true;
    if (e.code === 'KeyV' && !e.repeat) {
      e.preventDefault();
      void reviveAll();
    }
    if (e.code === 'KeyF' && !e.repeat) game.light = !game.light;
    if (e.code === 'Escape') {
      if (!$('missionsPanel').hidden) closeMissions();
      else if (!$('leaderboardPanel').hidden) closeLeaderboard();
      else pause();
    }
  });
  document.addEventListener('keyup', e => (game.keys[e.code] = false));
  document.addEventListener('mousemove', e => {
    if (game.state === 'playing' && document.pointerLockElement === canvas) {
      game.player.a += e.movementX * 0.0025;
      if (builder.custom)
        game.viewPitch = Math.max(-H * 0.6, Math.min(H * 0.4, game.viewPitch - e.movementY * 0.45));
    }
  });
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && game.state === 'playing') pause();
  });
  window.addEventListener('blur', pause);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
  });
  document.querySelectorAll('[data-key]').forEach(b => {
    b.onpointerdown = e => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      game.keys[b.dataset.key] = true;
    };
    b.onpointerup = b.onpointercancel = () => (game.keys[b.dataset.key] = false);
  });
  document.addEventListener('game-language-change', () => {
    if (game.state === 'playing') pause();
  });
}

export {
  finish,
  lock,
  pause,
  phaseIntro,
  reset,
  resetMotion,
  say,
  setupEngine,
  smoothWalk,
  solid,
  start,
  tick,
  updateHud,
  walkMotion,
};

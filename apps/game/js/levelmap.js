// Mapa da fase (modo Normal).
import { builder } from './builder.js';
import { $ } from './dom.js';
import { game } from './state.js';

let mapVisible = true,
  mapPaintedAt = -Infinity;
// North-up overview: the same collision grid and objectives used by the current world.
function resetLevelMap() {
  mapVisible = game.activeMode !== 'hardcore';
  mapPaintedAt = -Infinity;
  $('levelMap').hidden = !mapVisible;
  $('mapToggle').hidden = !mapVisible;
  $('mapToggle').setAttribute('aria-pressed', String(mapVisible));
}
function toggleLevelMap() {
  if (game.activeMode === 'hardcore') {
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
    game.activeMode === 'hardcore' ||
    !mapVisible ||
    game.state !== 'playing' ||
    builder.editing ||
    !game.grid.length ||
    now - mapPaintedAt < 80
  )
    return;
  mapPaintedAt = now;
  const c = $('mapCanvas'),
    m = c.getContext('2d'),
    unit = c.width / game.grid.length;
  m.fillStyle = '#101914';
  m.fillRect(0, 0, c.width, c.height);
  for (let y = 0; y < game.grid.length; y++)
    for (let x = 0; x < game.grid[y].length; x++) {
      m.fillStyle =
        game.grid[y][x] === 0 ? '#34453b' : game.grid[y][x] === 2 ? '#77806a' : '#b9b18e';
      m.fillRect(x * unit, y * unit, unit, unit);
    }
  if (game.exit && (!builder.custom || builder.custom.exit)) {
    const x = game.exit.x * unit,
      y = game.exit.y * unit;
    m.fillStyle = game.fuses.every(f => f.taken) ? '#83f6a1' : '#d0edcf';
    m.fillRect(x - unit * 0.65, y - unit * 0.65, unit * 1.3, unit * 1.3);
    m.fillStyle = '#12321d';
    m.fillRect(x - unit * 0.34, y - unit * 0.4, unit * 0.68, unit * 0.92);
  }
  for (const f of game.fuses)
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
  const x = game.player.x * unit,
    y = game.player.y * unit,
    a = game.player.a;
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

function setupLevelmap() {
  $('mapToggle').onclick = toggleLevelMap;
}

export { drawLevelMap, resetLevelMap, setupLevelmap, toggleLevelMap };

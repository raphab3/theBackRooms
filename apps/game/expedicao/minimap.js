// Mini mapa da equipe: só o que já foi andado aparece (névoa vinda do servidor). No acampamento
// mostra edificações, gerador, portal e mesa do cartógrafo; dentro, o labirinto e a saída.
import { CARTOGRAPHER, GENERATOR, INSIDE_EXIT, PORTAL } from '@backrooms/shared/camp.js';

const FLOOR = '#7d7550',
  WALL = '#2c2a1c',
  FOG = '#0d0c08';

export function drawMinimap(canvas, { grid, explored, zone, camp, me, players, monsters }) {
  const ctx = canvas.getContext('2d'),
    size = grid.length,
    px = canvas.width / size;
  ctx.fillStyle = FOG;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if (explored[y * size + x] !== '1') continue;
      ctx.fillStyle = grid[y][x] === 0 ? FLOOR : WALL;
      ctx.fillRect(x * px, y * px, Math.ceil(px), Math.ceil(px));
    }
  const seen = (x, y) => explored[Math.floor(y) * size + Math.floor(x)] === '1',
    dot = (x, y, color, r = 3) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x * px, y * px, r, 0, Math.PI * 2);
      ctx.fill();
    };
  if (zone === 'camp') {
    for (const b of camp.buildings)
      if (seen(b.doorAt.x, b.doorAt.y)) {
        ctx.fillStyle = '#6a6754';
        ctx.fillRect(b.x * px, b.y * px, b.foot * px, b.foot * px);
        dot(b.doorAt.x, b.doorAt.y, '#e8c547', 2.5);
      }
    if (seen(GENERATOR.x + 1, GENERATOR.y + 1)) {
      ctx.fillStyle = '#ffd76a';
      ctx.fillRect(GENERATOR.x * px, GENERATOR.y * px, 2 * px, 2 * px);
    }
    if (seen(PORTAL.x, PORTAL.y)) dot(PORTAL.x, PORTAL.y, '#67e3f2', 3.5);
    if (seen(CARTOGRAPHER.x, CARTOGRAPHER.y)) dot(CARTOGRAPHER.x, CARTOGRAPHER.y, '#ffffff', 2.5);
    for (const m of monsters) if (seen(m.x, m.y)) dot(m.x, m.y, '#ff3a2a', 2.5);
  } else dot(INSIDE_EXIT.x, INSIDE_EXIT.y, '#3ad17a', 3.5);
  for (const p of players) dot(p.x, p.y, p.color, 3);
  // Você: um triângulo apontando para onde olha.
  ctx.save();
  ctx.translate(me.x * px, me.y * px);
  ctx.rotate(me.a);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(6, 0);
  ctx.lineTo(-4, 4);
  ctx.lineTo(-4, -4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

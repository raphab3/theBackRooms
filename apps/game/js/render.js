// Renderização por raycasting, texturas procedurais e desenho de personagens/objetos.
import { builder, drawBuilderAim, rgbHex } from './builder.js';
import { H, N, W, ctx } from './dom.js';
import { walkMotion } from './engine.js';
import { LEVEL_INFO } from './levels.js';
import { remotePlayers } from './net.js';
import { game } from './state.js';

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
function render(now) {
  const ca = Math.cos(game.player.a),
    sa = Math.sin(game.player.a),
    px = -sa * 0.72,
    py = ca * 0.72,
    bob = game.state === 'playing' ? Math.sin(walkMotion.phase) * walkMotion.bob : 0,
    horizon = H / 2 + bob + game.viewPitch,
    outdoor =
      game.activeLevel === 'level974' ||
      game.activeLevel === 'level241' ||
      game.activeLevel === 'courtyard';
  for (let y = 0; y < H; y++) {
    let floor = y > horizon,
      dist = (H * 0.5) / Math.max(1, Math.abs(y - horizon)),
      t = tex[floor ? 1 : 2];
    for (let x = 0; x < W; x++) {
      let cam = (2 * x) / W - 1,
        wx = game.player.x + dist * (ca + px * cam),
        wy = game.player.y + dist * (sa + py * cam),
        tx = Math.floor(wx * 64) & 63,
        ty = Math.floor(wy * 64) & 63,
        idx = (ty * 64 + tx) * 3,
        ix = (y * W + x) * 4,
        brightness =
          Math.max(0.14, 0.85 / (1 + dist * 0.16)) * LEVEL_INFO[game.activeLevel].ambient;
      if (outdoor && !floor) {
        const sky = y / Math.max(1, horizon);
        const hill =
          8 +
          9 * Math.sin(game.player.a * 3 + (x / W) * 3) +
          5 * Math.sin(game.player.a * 7 + (x / W) * 7);
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
      if (game.activeLevel === 'habitable') {
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
      if (game.activeLevel === 'fun') {
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
      if (game.activeLevel === 'electrical' && !floor && (tx < 3 || tx > 59 || ty < 2)) {
        pixels[ix] = 20;
        pixels[ix + 1] = 21;
        pixels[ix + 2] = 16;
        pixels[ix + 3] = 255;
        continue;
      }
      let ceilingLight =
        game.activeLevel !== 'electrical' &&
        game.activeLevel !== 'habitable' &&
        !floor &&
        Math.floor(wx) % 3 === 1 &&
        Math.floor(wy) % 3 === 1 &&
        tx > 12 &&
        tx < 52 &&
        ty > 22 &&
        ty < 42;
      if (ceilingLight) {
        const lamp = LEVEL_INFO[game.activeLevel].lamp;
        pixels[ix] = lamp[0];
        pixels[ix + 1] = lamp[1];
        pixels[ix + 2] = lamp[2];
      } else {
        if (game.activeLevel === 'poolrooms' && floor) {
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
      mx = Math.floor(game.player.x),
      my = Math.floor(game.player.y),
      ddx = Math.abs(1 / rx),
      ddy = Math.abs(1 / ry),
      sx = rx < 0 ? -1 : 1,
      sy = ry < 0 ? -1 : 1,
      sdx = (rx < 0 ? game.player.x - mx : mx + 1 - game.player.x) * ddx,
      sdy = (ry < 0 ? game.player.y - my : my + 1 - game.player.y) * ddy,
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
      if (!game.grid[my] || (game.grid[my][mx] !== 0 && game.grid[my][mx] !== 2)) break;
    }
    let d = Math.max(0.01, side ? sdy - ddy : sdx - ddx);
    zbuf[x] = d;
    let wall = side ? game.player.x + d * rx : game.player.y + d * ry,
      tx = Math.floor((wall - Math.floor(wall)) * 64),
      height = H / d,
      top = horizon - height / 2,
      bottom = horizon + height / 2,
      t = tex[0];
    if (game.activeLevel === 'courtyard') {
      height *= 3;
      top = bottom - height;
    }
    const boundary =
      outdoor &&
      game.activeLevel !== 'courtyard' &&
      (mx === 0 || my === 0 || mx === 20 || my === 20);
    if (boundary) {
      top = bottom - height * 0.28;
    }
    for (let y = Math.max(0, Math.floor(top)); y < Math.min(H, bottom); y++) {
      let ty = Math.min(63, Math.max(0, Math.floor(((y - top) / height) * 64))),
        idx = (ty * 64 + tx) * 3,
        ix = (y * W + x) * 4;
      let beam = game.light ? (Math.max(0, 1 - Math.abs(cam) * 1.5) * 0.46) / (1 + d * 0.14) : 0,
        b = Math.min(
          1.12,
          ((side ? 0.65 : 0.78) * LEVEL_INFO[game.activeLevel].ambient) / (1 + d * 0.12) + beam,
        );
      if (game.activeLevel === 'habitable') {
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
      if (game.activeLevel === 'electrical' && (mx + my) % 7 === 0 && ty > 9 && ty < 58) {
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
    game.activeLevel === 'fun' ||
    game.activeLevel === 'office' ||
    game.activeLevel === 'level974' ||
    game.activeLevel === 'level241'
  )
    drawPyramidRoofs(ca, sa, horizon);
  ctx.putImageData(frame, 0, 0);
  let objects = [
    ...(game.activeLevel === 'electrical'
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
    ...(game.activeLevel === 'level241'
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
    ...game.coins.filter(c => !c.taken),
    ...game.fuses.filter(f => !f.taken),
    ...(builder.custom && !builder.custom.exit ? [] : [game.exit]),
    ...(builder.editing || game.elapsed > (game.activeLevel === 'run' ? 6 : 22)
      ? builder.custom
        ? [game.enemy, game.smile].filter(Boolean)
        : game.activeMode === 'hardcore' && game.smile
          ? [game.enemy, game.smile]
          : [game.enemy]
      : []),
    ...remotePlayers.filter(p => p.alive).map(p => ({ ...p, type: 'player' })),
  ]
    .map(o => ({ ...o, d: Math.hypot(o.x - game.player.x, o.y - game.player.y) }))
    .sort((a, b) => b.d - a.d);
  for (const o of objects) {
    let dx = o.x - game.player.x,
      dy = o.y - game.player.y,
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
        if (!builder.custom && game.activeLevel !== 'office' && game.activeLevel !== 'fun')
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
      let unlocked = game.fuses.every(f => f.taken);
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
          game.activeLevel === 'glitch-past'
            ? 'CASA'
            : game.activeLevel === 'glitch-shift'
              ? 'PASSADO'
              : 'SAÍDA',
        ) ||
          (game.activeLevel === 'glitch-past'
            ? 'CASA'
            : game.activeLevel === 'glitch-shift'
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
    const dx = v[0] - game.player.x,
      dy = v[1] - game.player.y;
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
    if (game.player.y < y)
      face(
        [
          [x, y, z],
          [X, y, z],
          [X, y, Z],
          [x, y, Z],
        ],
        shade(0.85),
      );
    if (game.player.y > Y)
      face(
        [
          [X, Y, z],
          [x, Y, z],
          [x, Y, Z],
          [X, Y, Z],
        ],
        shade(0.73),
      );
    if (game.player.x < x)
      face(
        [
          [x, Y, z],
          [x, y, z],
          [x, y, Z],
          [x, Y, Z],
        ],
        shade(0.8),
      );
    if (game.player.x > X)
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
      const dx = p.x - game.player.x,
        dy = p.y - game.player.y;
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
  if (game.activeLevel === 'fun') {
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
        dx = x + 1 - game.player.x,
        dy = y + 1 - game.player.y;
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
  if (game.activeLevel === 'office') {
    for (let y = 1; y < N - 1; y++)
      for (let x = 1; x < N - 1; x++)
        if (game.grid[y][x] === 2) {
          const dx = x + 0.5 - game.player.x,
            dy = y + 0.5 - game.player.y;
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
      if (game.grid[y][x]) {
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

export { drawExplorer, makeTextures, render };

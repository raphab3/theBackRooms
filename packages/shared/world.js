export const PHASE_ORDER = [
  'backrooms',
  'poolrooms',
  'habitable',
  'electrical',
  'level974',
  'level241',
  'office',
  'woodrooms',
  'fun',
  'courtyard',
  'run',
  'glitch',
  'glitch-shift',
  'glitch-past',
];
export function phaseFuseCount(level) {
  return level === 'glitch' ? 1 : level === 'glitch-shift' ? 5 : 3;
}
export function createWorld(initialSeed = 93451, level = 'backrooms') {
  let seed = initialSeed >>> 0;
  const N = 21,
    grid = Array.from({ length: N }, () => Array(N).fill(1));
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const solid = (x, y) => !grid[Math.floor(y)] || grid[Math.floor(y)][Math.floor(x)] !== 0;
  const route = (sx, sy, tx, ty) => findRoute(grid, sx, sy, tx, ty);
  const stack = [[1, 1]];
  grid[1][1] = 0;
  while (stack.length) {
    const [x, y] = stack.at(-1),
      dirs = [
        [2, 0],
        [-2, 0],
        [0, 2],
        [0, -2],
      ].filter(
        ([dx, dy]) =>
          x + dx > 0 && y + dy > 0 && x + dx < N - 1 && y + dy < N - 1 && grid[y + dy][x + dx],
      );
    if (!dirs.length) {
      stack.pop();
      continue;
    }
    const [dx, dy] = dirs[Math.floor(rand() * dirs.length)];
    grid[y + dy / 2][x + dx / 2] = 0;
    grid[y + dy][x + dx] = 0;
    stack.push([x + dx, y + dy]);
  }
  for (let j = 0; j < 36; j++) {
    let x = 2 + Math.floor(rand() * 17),
      y = 2 + Math.floor(rand() * 17);
    if ((!grid[y][x - 1] && !grid[y][x + 1]) || (!grid[y - 1][x] && !grid[y + 1][x]))
      grid[y][x] = 0;
  }
  // Every new room intersects an existing odd-cell corridor, preserving connectivity.
  if (level === 'poolrooms') {
    for (const [cx, cy] of [
      [3, 3],
      [9, 5],
      [15, 3],
      [5, 13],
      [13, 13],
      [17, 17],
    ])
      for (let y = Math.max(1, cy - 2); y <= Math.min(19, cy + 2); y++)
        for (let x = Math.max(1, cx - 2); x <= Math.min(19, cx + 2); x++) grid[y][x] = 0;
  }
  // Broad concrete hall with aligned square columns, like the reference.
  if (level === 'habitable') {
    for (let y = 1; y < 20; y++) for (let x = 1; x < 20; x++) grid[y][x] = 0;
    for (const y of [4, 8, 12, 16]) for (const x of [4, 8, 12, 16]) grid[y][x] = 1;
    // Short perimeter partitions create recessed bays without closing routes.
    for (const y of [6, 14]) for (let x = 1; x <= 2; x++) grid[y][x] = 1;
    for (const x of [6, 14]) for (let y = 18; y < 20; y++) grid[y][x] = 1;
  }
  if (level === 'electrical') {
    // Brick service blocks surrounded by connected, wider maintenance corridors.
    for (let y = 1; y < 20; y++) for (let x = 1; x < 20; x++) grid[y][x] = 0;
    for (const cy of [4, 11])
      for (const cx of [4, 11, 17])
        for (let y = cy; y < cy + 5; y++)
          for (let x = cx; x < Math.min(20, cx + 4); x++) grid[y][x] = 1;
  }
  // Outdoor fields: scattered houses or turbine service cabins.
  if (level === 'level974' || level === 'level241') {
    for (let y = 1; y < 20; y++) for (let x = 1; x < 20; x++) grid[y][x] = 0;
    const buildings =
      level === 'level974'
        ? [
            [4, 3],
            [9, 3],
            [15, 4],
            [5, 8],
            [12, 9],
            [17, 11],
            [3, 14],
            [9, 16],
            [15, 17],
          ]
        : [
            [6, 6],
            [13, 12],
            [5, 17],
          ];
    for (const [x, y] of buildings) grid[y][x] = 1;
  }
  // Each theme has a distinct layout; carved rooms meet the existing maze.
  if (level === 'office') {
    for (let y = 1; y < 20; y++) for (let x = 1; x < 20; x++) grid[y][x] = 0;
    for (const y of [5, 11, 17]) for (const x of [5, 11, 17]) grid[y][x] = 1;
    for (const y of [3, 7, 11, 15, 18])
      for (const x of [3, 7, 11, 15, 18]) if (grid[y][x] === 0) grid[y][x] = 2;
  }
  if (level === 'fun') {
    // Indoor playground: wide connected aisles around solid play structures.
    for (let y = 1; y < 20; y++) for (let x = 1; x < 20; x++) grid[y][x] = 0;
    for (const [cx, cy] of [
      [4, 4],
      [10, 4],
      [16, 4],
      [4, 10],
      [10, 10],
      [16, 10],
      [4, 16],
      [12, 16],
    ])
      for (let y = cy; y < cy + 2; y++) for (let x = cx; x < cx + 2; x++) grid[y][x] = 2;
    for (const [cx, cy] of [
      [3, 8],
      [9, 8],
      [15, 8],
      [3, 14],
      [9, 14],
      [15, 14],
    ])
      for (let x = cx; x < cx + 3; x++) grid[cy][x] = 2;
  }
  if (level === 'lurking') {
    const centers =
      level === 'office'
        ? [
            [5, 5],
            [15, 5],
            [5, 15],
            [15, 15],
          ]
        : level === 'fun'
          ? [
              [5, 5],
              [15, 5],
              [9, 13],
              [15, 17],
            ]
          : [
              [5, 7],
              [15, 7],
              [5, 15],
              [15, 15],
            ];
    for (const [cx, cy] of centers) {
      for (let y = Math.max(1, cy - 2); y <= Math.min(19, cy + 2); y++)
        for (let x = Math.max(1, cx - 2); x <= Math.min(19, cx + 2); x++) grid[y][x] = 0;
      grid[cy][cx] = 1;
      if (level === 'office') grid[cy][cx + 1] = 1;
    }
    if (level === 'lurking') for (let y = 1; y < 20; y++) grid[y][9] = 0;
  }
  if (level === 'woodrooms')
    for (const x of [3, 7, 13, 17]) for (let y = 1; y < 20; y++) grid[y][x] = 0;
  if (level === 'courtyard') {
    for (let y = 1; y < 20; y++) for (let x = 1; x < 20; x++) grid[y][x] = 0;
    // Window-lined towers form alcoves around an open central lawn.
    for (const [cx, cy] of [
      [5, 3],
      [13, 3],
      [3, 11],
      [17, 11],
      [7, 17],
      [15, 17],
    ])
      for (let y = cy; y < cy + 2; y++) for (let x = cx; x < cx + 2; x++) grid[y][x] = 1;
  }
  // Broken rooms and cross-corridors remain connected to the original maze.
  if (level === 'glitch')
    for (const [cx, cy] of [
      [5, 5],
      [15, 15],
    ])
      for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) grid[y][x] = 0;
  if (level === 'glitch-shift') {
    for (const x of [5, 15]) for (let y = 1; y < 20; y++) grid[y][x] = 0;
    for (const y of [5, 15]) for (let x = 1; x < 20; x++) grid[y][x] = 0;
  }
  if (level === 'run') {
    for (const row of grid) row.fill(1);
    const path = [];
    for (let lane = 0; lane < 5; lane++) {
      const y = 1 + lane * 4,
        right = lane % 2 === 0;
      for (let step = 0; step < 19; step++) {
        const x = right ? 1 + step : 19 - step;
        grid[y][x] = 0;
        path.push({ x: x + 0.5, y: y + 0.5 });
      }
      if (lane < 4) {
        const x = right ? 19 : 1;
        for (let dy = 1; dy < 4; dy++) {
          grid[y + dy][x] = 0;
          path.push({ x: x + 0.5, y: y + dy + 0.5 });
        }
      }
    }
    const fuseSteps = [25, 55, 85],
      exit = { ...path.at(-1), type: 'exit' },
      fuses = fuseSteps.map(i => ({ ...path[i], type: 'fuse', taken: false }));
    const coins = path
      .filter((_, i) => i > 2 && i < path.length - 1 && !fuseSteps.includes(i))
      .slice(0, 75)
      .map((p, id) => ({ ...p, id, type: 'coin', taken: false }));
    return {
      grid,
      exit,
      fuses,
      coins,
      enemy: { ...path[0], type: 'enemy' },
      smile: { ...path[8], type: 'smile' },
      spawn: { ...path[0], a: 0 },
    };
  }
  let cells = [];
  for (let y = 1; y < N - 1; y++)
    for (let x = 1; x < N - 1; x++)
      if (!grid[y][x]) cells.push({ x: x + 0.5, y: y + 0.5, d: route(1, 1, x, y).length });
  cells.sort((a, b) => b.d - a.d);
  const exit = { ...cells[0], type: 'exit' },
    fuses = [];
  for (const target of [
    { x: 17, y: 3 },
    { x: 3, y: 17 },
    { x: 17, y: 17 },
    { x: 9, y: 9 },
    { x: 3, y: 3 },
  ].slice(0, phaseFuseCount(level))) {
    let options = cells.filter(
      c =>
        c.d > 8 &&
        !fuses.some(f => Math.hypot(f.x - c.x, f.y - c.y) < 4) &&
        Math.hypot(c.x - exit.x, c.y - exit.y) > 2,
    );
    if (!options.length) options = cells.filter(c => !fuses.some(f => f.x === c.x && f.y === c.y));
    let c = options.sort(
      (a, b) =>
        Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y),
    )[0];
    fuses.push({ ...c, type: 'fuse', taken: false });
  }
  const available = cells.filter(
    c =>
      c.d > 2 &&
      Math.hypot(c.x - exit.x, c.y - exit.y) > 1 &&
      !fuses.some(f => f.x === c.x && f.y === c.y),
  );
  for (let i = available.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [available[i], available[j]] = [available[j], available[i]];
  }
  const coins = available
    .slice(0, 75)
    .map((c, id) => ({ id, x: c.x, y: c.y, type: 'coin', taken: false }));
  const originalEnemy = cells[Math.min(12, cells.length - 1)];
  const smileCell =
    cells.find(c => Math.hypot(c.x - originalEnemy.x, c.y - originalEnemy.y) > 7 && c.d > 10) ||
    cells[0];
  return {
    grid,
    exit,
    fuses,
    coins,
    smile: { x: smileCell.x, y: smileCell.y, type: 'smile' },
    enemy: { ...cells[Math.min(12, cells.length - 1)], type: 'enemy' },
    spawn: { x: 1.5, y: 1.5, a: 0 },
  };
}
export function findRoute(grid, sx, sy, tx, ty) {
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
      if (grid[b]?.[a] === 0 && !seen.has(key)) {
        seen.set(key, [x, y]);
        queue.push([a, b]);
      }
    }
  }
  return [];
}

export const BUILD_PROPS = ['table', 'chair', 'crate', 'pillar', 'barrier', 'lamp'];
export function newCustomMap() {
  const grid = Array.from({ length: 21 }, (_, y) =>
    Array.from({ length: 21 }, (_, x) => (x === 0 || y === 0 || x === 20 || y === 20 ? 1 : 0)),
  );
  return {
    version: 1,
    title: 'Minhas Backrooms',
    theme: 'backrooms',
    grid,
    props: [],
    spawn: { x: 2.5, y: 2.5, a: 0 },
    exit: { x: 18.5, y: 18.5 },
    fuses: [
      { x: 17.5, y: 3.5 },
      { x: 3.5, y: 17.5 },
      { x: 17.5, y: 17.5 },
    ],
    monsters: [],
    coins: [],
    floorPaint: {},
    wallPaint: {},
    wallColor: '',
    floorColor: '',
    ceilingColor: '',
    brightness: 1,
    monsterSpeed: 1,
  };
}
export function validateCustomMap(input, playable = false) {
  const bad = message => {
    throw new Error(message);
  };
  if (!input || typeof input !== 'object' || input.version !== 1) bad('Mapa inválido.');
  const title =
    typeof input.title === 'string' ? input.title.trim().replace(/[\x00-\x1f\x7f]/g, '') : '';
  if (!title || title.length > 48) bad('Dê um nome ao mapa (até 48 letras).');
  if (!PHASE_ORDER.includes(input.theme)) bad('Escolha um tema disponível.');
  if (
    !Array.isArray(input.grid) ||
    input.grid.length !== 21 ||
    input.grid.some(r => !Array.isArray(r) || r.length !== 21 || r.some(v => ![0, 1].includes(v)))
  )
    bad('A grade deve ter 21 × 21 espaços.');
  const grid = input.grid.map(r => r.slice());
  for (let i = 0; i < 21; i++)
    if (grid[0][i] !== 1 || grid[20][i] !== 1 || grid[i][0] !== 1 || grid[i][20] !== 1)
      bad('Mantenha as paredes externas do mapa.');
  const point = p => {
    if (
      !p ||
      !Number.isFinite(p.x) ||
      !Number.isFinite(p.y) ||
      p.x < 1.5 ||
      p.x > 19.5 ||
      p.y < 1.5 ||
      p.y > 19.5 ||
      p.x % 1 !== 0.5 ||
      p.y % 1 !== 0.5
    )
      bad('Coloque os objetos dentro do mapa.');
    return { x: p.x, y: p.y };
  };
  const list = (items, max, label) => {
    if (!Array.isArray(items) || items.length > max) bad('Limite de ' + max + ' ' + label + '.');
    return items.map(point);
  };
  const hex = value => {
    if (value === '' || value === undefined) return '';
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) bad('Cor inválida.');
    return value.toLowerCase();
  };
  const paint = value => {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length > 441
    )
      bad('Pintura inválida.');
    const out = {};
    for (const [key, c] of Object.entries(value)) {
      if (!/^(?:[0-9]|1[0-9]|20),(?:[0-9]|1[0-9]|20)$/.test(key)) bad('Pintura fora do mapa.');
      out[key] = hex(c);
    }
    return out;
  };
  if (!Array.isArray(input.props) || input.props.length > 80) bad('Use até 80 móveis e luzes.');
  const props = input.props.map(p => {
    if (!BUILD_PROPS.includes(p.kind)) bad('Objeto desconhecido.');
    return {
      ...point(p),
      kind: p.kind,
      color: hex(p.color) || '#bcae79',
      rotation: [0, 1, 2, 3].includes(p.rotation) ? p.rotation : 0,
    };
  });
  if (
    !Number.isFinite(input.brightness) ||
    input.brightness < 0.25 ||
    input.brightness > 1.5 ||
    !Number.isFinite(input.monsterSpeed) ||
    input.monsterSpeed < 0.5 ||
    input.monsterSpeed > 2
  )
    bad('Iluminação ou velocidade inválida.');
  const spawn = { ...point(input.spawn), a: Number.isFinite(input.spawn.a) ? input.spawn.a : 0 };
  const map = {
    version: 1,
    title,
    theme: input.theme,
    grid,
    props,
    spawn,
    exit: input.exit ? point(input.exit) : null,
    fuses: list(input.fuses, 3, 'fusíveis'),
    monsters: list(input.monsters, 2, 'monstros'),
    coins: list(input.coins, 75, 'moedas'),
    floorPaint: paint(input.floorPaint),
    wallPaint: paint(input.wallPaint),
    wallColor: hex(input.wallColor),
    floorColor: hex(input.floorColor),
    ceilingColor: hex(input.ceilingColor),
    brightness: input.brightness,
    monsterSpeed: input.monsterSpeed,
  };
  const occupied = new Set();
  for (const p of [
    ...props,
    ...map.fuses,
    ...map.monsters,
    ...map.coins,
    ...(map.exit ? [map.exit] : []),
    spawn,
  ]) {
    const key = p.x + ',' + p.y;
    if (grid[Math.floor(p.y)][Math.floor(p.x)] !== 0 || occupied.has(key))
      bad('Cada objeto precisa de um espaço livre, sem sobreposição.');
    occupied.add(key);
  }
  if (playable) {
    if (map.fuses.length !== 3 || !map.exit)
      bad('Coloque os 3 fusíveis e uma saída antes de testar ou publicar.');
    const world = createCustomWorld(map),
      sx = Math.floor(spawn.x),
      sy = Math.floor(spawn.y);
    for (const [label, items] of [
      ['fusível', map.fuses],
      ['saída', [map.exit]],
      ['monstro', map.monsters],
      ['moeda', map.coins],
    ])
      for (const p of items)
        if (!findRoute(world.grid, sx, sy, Math.floor(p.x), Math.floor(p.y)).length)
          bad('Há um ' + label + ' sem caminho. Abra uma passagem a partir do início.');
  }
  return map;
}
export function createCustomWorld(map) {
  const grid = map.grid.map(row => row.slice());
  for (const p of map.props) if (p.kind !== 'lamp') grid[Math.floor(p.y)][Math.floor(p.x)] = 2;
  return {
    grid,
    spawn: { ...map.spawn },
    exit: { ...(map.exit || map.spawn), type: 'exit' },
    fuses: map.fuses.map(p => ({ ...p, type: 'fuse', taken: false })),
    coins: map.coins.map((p, id) => ({ ...p, id, type: 'coin', taken: false })),
    enemy: map.monsters[0] ? { ...map.monsters[0], type: 'enemy' } : null,
    smile: map.monsters[1] ? { ...map.monsters[1], type: 'smile' } : null,
  };
}

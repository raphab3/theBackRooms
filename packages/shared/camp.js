// Mundo aberto da expedição: o acampamento a céu aberto (grade grande, em células como world.js),
// o gerador no centro, o portal de volta ao Posto Zero e as edificações em volta, cada uma com a
// porta virada para o gerador. Os interiores usam os níveis clássicos de world.js.

export const CAMP_SIZE = 48; // células (o cliente desenha 1 célula = 2 m)
export const GENERATOR = { x: 24, y: 24 }; // canto superior esquerdo do bloco 2×2 do gerador
export const CAMP_SPAWN = { x: 24.5, y: 28.5 };
export const PORTAL = { x: 24.5, y: 32.5 };
export const USE_REACH = 1.3; // células: porta, saída e portal
export const LEAVE_MS = 2000; // segurar E no portal para voltar ao Posto Zero
export const RESPAWN_MS = 30000; // quem é pego volta ao acampamento depois disso
export const ENTER_GRACE_MS = 8000; // a entidade de uma edificação espera antes de caçar
const FOOT = 5; // edificação = bloco 5×5 células

// Etapa 1: duas edificações. As próximas etapas trazem os outros níveis clássicos.
export const BUILDINGS = [
  { id: 'b0', level: 'backrooms', name: 'Nível 0 · Backrooms', x: 22, y: 6, door: 'south' },
  { id: 'b1', level: 'poolrooms', name: 'Poolrooms', x: 37, y: 22, door: 'west' },
];

/** Semente do interior de cada edificação (o cliente gera o mesmo labirinto que o servidor). */
export const buildingSeed = (seed, index) => (seed + (index + 1) * 7919) >>> 0;
export const INSIDE_EXIT = { x: 1.5, y: 1.5 }; // a entrada de toda edificação também é a saída

/** Ponto em frente à porta (no chão do acampamento), por onde se entra. */
export function doorPoint(b) {
  const mid = Math.floor(FOOT / 2);
  if (b.door === 'south') return { x: b.x + mid + 0.5, y: b.y + FOOT + 0.5 };
  if (b.door === 'north') return { x: b.x + mid + 0.5, y: b.y - 0.5 };
  if (b.door === 'west') return { x: b.x - 0.5, y: b.y + mid + 0.5 };
  return { x: b.x + FOOT + 0.5, y: b.y + mid + 0.5 };
}

/**
 * Grade do acampamento (0 = chão, 1 = bloqueado): cerca na borda, gerador, edificações e alguns
 * postes de concreto espalhados pela semente, sem bloquear portas, portal nem o redor do gerador.
 */
export function createCamp(seed) {
  let s = (seed ^ 0x5eed1234) >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const grid = Array.from({ length: CAMP_SIZE }, (_, y) =>
    Array.from({ length: CAMP_SIZE }, (_, x) =>
      x === 0 || y === 0 || x === CAMP_SIZE - 1 || y === CAMP_SIZE - 1 ? 1 : 0,
    ),
  );
  for (let y = 0; y < 2; y++)
    for (let x = 0; x < 2; x++) grid[GENERATOR.y + y][GENERATOR.x + x] = 1;
  for (const b of BUILDINGS)
    for (let y = 0; y < FOOT; y++) for (let x = 0; x < FOOT; x++) grid[b.y + y][b.x + x] = 1;
  const keepClear = [
    { x: GENERATOR.x + 1, y: GENERATOR.y + 1, r: 7 },
    { ...PORTAL, r: 3 },
    ...BUILDINGS.map(b => ({ ...doorPoint(b), r: 3 })),
  ];
  const pylons = [];
  for (let i = 0; i < 60; i++) {
    const x = 2 + Math.floor(rand() * (CAMP_SIZE - 4)),
      y = 2 + Math.floor(rand() * (CAMP_SIZE - 4));
    if (grid[y][x] || keepClear.some(c => Math.hypot(c.x - x - 0.5, c.y - y - 0.5) < c.r)) continue;
    grid[y][x] = 1;
    pylons.push({ x, y });
  }
  return {
    grid,
    pylons,
    buildings: BUILDINGS.map(b => ({ ...b, foot: FOOT, doorAt: doorPoint(b) })),
  };
}

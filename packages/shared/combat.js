// Braço de Fogo: números do tiro e o traçado do disparo na grade (o servidor decide o acerto; o
// cliente usa o mesmo traçado só para desenhar). Valores iniciais para teste de sensação.

export const FIRE = {
  primary: { damage: 10, cooldownMs: 250, range: 8, radius: 0.45, burnDps: 3, burnMs: 2000 },
  charged: { damage: 40, cooldownMs: 1200, chargeMs: 1200, range: 8, radius: 0.45, blast: 2 },
};
export const ENEMY_HP = 100;
export const ENEMY_RESPAWN_MS = 30000;

const STEP = 0.05;
const solid = (grid, x, y) => grid[Math.floor(y)]?.[Math.floor(x)] !== 0;

/** Distância ao longo do raio até a primeira parede (ou `max`), em passos de 5 cm de célula. */
export function rayToWall(grid, x, y, a, max) {
  const dx = Math.cos(a),
    dy = Math.sin(a);
  for (let d = STEP; d <= max; d += STEP) if (solid(grid, x + dx * d, y + dy * d)) return d - STEP;
  return max;
}

/**
 * Traça um disparo de `from` no ângulo `a` contra `target` ({x, y} ou null).
 * Primário: acerta se o alvo está no caminho antes da parede. Carregado: explode no primeiro
 * obstáculo (alvo ou parede) e acerta quem estiver no raio da explosão.
 * Devolve { end: {x, y}, hit }.
 */
export function traceShot(grid, from, a, target, kind) {
  const spec = FIRE[kind],
    wall = rayToWall(grid, from.x, from.y, a, spec.range),
    dx = Math.cos(a),
    dy = Math.sin(a);
  let along = Infinity,
    onLine = false;
  if (target) {
    const tx = target.x - from.x,
      ty = target.y - from.y;
    along = tx * dx + ty * dy;
    onLine = along > 0 && along <= wall + spec.radius && Math.abs(tx * dy - ty * dx) <= spec.radius;
  }
  const dist = onLine ? Math.min(along, wall) : wall,
    end = { x: from.x + dx * dist, y: from.y + dy * dist };
  const hit =
    !!target &&
    (kind === 'charged' ? Math.hypot(target.x - end.x, target.y - end.y) <= spec.blast : onLine);
  return { end, hit };
}

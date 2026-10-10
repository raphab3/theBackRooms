// Lógica de rede sem DOM nem WebSocket: backoff, interpolação de snapshots e checagem de predição.
export const INPUT_INTERVAL_MS = 1000 / 30;
export const INTERP_DELAY_MS = 100;
export const CORRECTION_DISTANCE = 0.5;
const BACKOFF_STEPS_MS = [1000, 2000, 4000],
  BACKOFF_MAX_MS = 10000,
  BUFFER_MS = 1000,
  TELEPORT_DISTANCE = 2;

/** Espera antes da tentativa `attempt` (0, 1, 2…): 1 s, 2 s, 4 s e depois 10 s. */
export function reconnectDelay(attempt) {
  return BACKOFF_STEPS_MS[attempt] ?? BACKOFF_MAX_MS;
}

function lerpAngle(a, b, t) {
  const turn = ((((b - a) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
  return a + turn * t;
}

/** Guarda snapshots dos jogadores remotos com a hora local de chegada e amostra ~100 ms atrás. */
export class SnapshotBuffer {
  constructor() {
    this.frames = [];
  }
  clear() {
    this.frames = [];
  }
  push(time, players) {
    const map = new Map(players.map(p => [p.id, { x: p.x, y: p.y, a: p.a }]));
    this.frames.push({ time, players: map });
    while (this.frames.length > 2 && time - this.frames[1].time > BUFFER_MS) this.frames.shift();
  }
  /** Posição do jogador em `now - INTERP_DELAY_MS`; devolve null se nunca foi visto. */
  sample(id, now) {
    const at = now - INTERP_DELAY_MS,
      frames = this.frames;
    let next = frames.findIndex(f => f.time >= at);
    if (next === -1) next = frames.length;
    const after = frames[next]?.players.get(id),
      before = frames[next - 1]?.players.get(id);
    if (!before) return after ? { ...after } : null;
    if (!after) return { ...before };
    const t0 = frames[next - 1].time,
      t1 = frames[next].time,
      t = t1 > t0 ? Math.max(0, Math.min(1, (at - t0) / (t1 - t0))) : 1;
    if (Math.hypot(after.x - before.x, after.y - before.y) > TELEPORT_DISTANCE)
      return { ...(t < 1 ? before : after) };
    return {
      x: before.x + (after.x - before.x) * t,
      y: before.y + (after.y - before.y) * t,
      a: lerpAngle(before.a, after.a, t),
    };
  }
}

/**
 * Posições recentes do jogador local. O snapshot do servidor chega atrasado, então a posição dele é
 * comparada com o passado do cliente: só há divergência se nenhum ponto recente chegar perto.
 */
export class PredictionHistory {
  constructor() {
    this.points = [];
  }
  clear() {
    this.points = [];
  }
  record(time, x, y) {
    const last = this.points.at(-1);
    if (last && last.x === x && last.y === y) last.time = time;
    else this.points.push({ time, x, y });
    while (this.points.length && time - this.points[0].time > BUFFER_MS) this.points.shift();
  }
  diverged(x, y) {
    if (!this.points.length) return false;
    return this.points.every(p => Math.hypot(p.x - x, p.y - y) > CORRECTION_DISTANCE);
  }
}

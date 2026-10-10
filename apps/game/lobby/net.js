// Rede do lobby: REST para escolher o lobby, WebSocket para o resto e interpolação dos outros.
export const INTERP_DELAY_MS = 150;
const BUFFER_MS = 1500,
  MAX_EXTRAPOLATE_MS = 250;

export async function enterLobby(action, body) {
  const response = await fetch('/api/lobby/' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw Error('Não foi possível conectar. Atualize a página e tente de novo.');
  }
  if (!response.ok) throw Error(data.error || 'O lobby não respondeu.');
  return data;
}

export function openLobbySocket(key, name, onMessage, onClose) {
  const scheme = location.protocol === 'http:' ? 'ws:' : 'wss:',
    ws = new WebSocket(
      `${scheme}//${location.host}/api/lobby/${key}/ws?name=${encodeURIComponent(name)}`,
    );
  ws.onmessage = event => {
    try {
      onMessage(JSON.parse(event.data));
    } catch (error) {
      console.error('Mensagem do lobby inválida', error);
    }
  };
  ws.onclose = event => onClose(event);
  return {
    send(message) {
      if (ws.readyState === 1) ws.send(JSON.stringify(message));
    },
    close() {
      ws.onclose = null;
      ws.close();
    },
  };
}

const lerpAngle = (a, b, t) => {
  const turn = ((((b - a) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
  return a + turn * t;
};

/** Guarda snapshots com a hora local de chegada e amostra cada jogador INTERP_DELAY_MS atrás. */
export class RemoteBuffer {
  constructor() {
    this.frames = [];
  }
  push(time, players) {
    this.frames.push({ time, players: new Map(players.map(p => [p.id, p])) });
    while (this.frames.length > 2 && time - this.frames[1].time > BUFFER_MS) this.frames.shift();
  }
  sample(id, now) {
    const at = now - INTERP_DELAY_MS,
      frames = this.frames;
    let next = frames.findIndex(f => f.time >= at);
    if (next === -1) next = frames.length;
    const a = frames[next - 1]?.players.get(id),
      b = frames[next]?.players.get(id);
    if (!a && !b) return null;
    if (!a || !b) {
      // Só um lado: extrapola pouco a partir dos dois últimos quadros com esse jogador.
      const last = b || a,
        seen = frames.filter(f => f.players.has(id)).slice(-2);
      if (seen.length < 2) return { ...last, speed: 0 };
      const [f0, f1] = seen,
        p0 = f0.players.get(id),
        dt = (f1.time - f0.time) / 1000 || 1,
        ahead = Math.min(MAX_EXTRAPOLATE_MS, Math.max(0, at - f1.time)) / 1000,
        vx = (last.x - p0.x) / dt,
        vz = (last.z - p0.z) / dt;
      return { ...last, x: last.x + vx * ahead, z: last.z + vz * ahead, speed: Math.hypot(vx, vz) };
    }
    const fa = frames[next - 1],
      fb = frames[next],
      span = fb.time - fa.time || 1,
      t = Math.min(1, Math.max(0, (at - fa.time) / span));
    return {
      ...b,
      x: a.x + (b.x - a.x) * t,
      z: a.z + (b.z - a.z) * t,
      yaw: lerpAngle(a.yaw, b.yaw, t),
      speed: Math.hypot(b.x - a.x, b.z - a.z) / (span / 1000),
    };
  }
}

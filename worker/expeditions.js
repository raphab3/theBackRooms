// Criação de salas de partida (RoomDO), usada pela API e pelo portal do lobby.
import { createWorld } from '@backrooms/shared/world.js';
import { ApiError } from './http.js';
import { beginPhase } from './rooms.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode() {
  return Array.from(
    crypto.getRandomValues(new Uint8Array(6)),
    n => CODE_ALPHABET[n % CODE_ALPHABET.length],
  ).join('');
}

function roomStub(env, code) {
  if (!env.ROOMS) throw new ApiError('Salas indisponíveis neste momento. Tente novamente.', 503);
  return env.ROOMS.get(env.ROOMS.idFromName(code));
}
// Encaminha uma requisição interna (/init, /action, /state, /admin) ao Durable Object da sala.
function roomRequest(env, code, path, payload) {
  return roomStub(env, code).fetch(
    new Request('https://room.internal' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  );
}

// Cria uma sala com `players` já dentro (o primeiro é o anfitrião). Com `start`, a partida já
// começa na primeira fase, como quando o grupo atravessa o portal do lobby.
async function createRoom(env, players, { level, mode, campaign, start = false }) {
  const now = Date.now(),
    seed = crypto.getRandomValues(new Uint32Array(1))[0],
    world = createWorld(seed, level);
  for (let i = 0; i < 5; i++) {
    const code = randomCode(),
      room = {
        code,
        seed,
        level,
        mode,
        campaign,
        world,
        coinRespawns: {},
        smile: mode === 'hardcore' ? { ...world.smile } : null,
        players,
        host: players[0].id,
        status: 'lobby',
        round: 0,
        started: 0,
        lastTick: now,
        balance: 0,
        collectedCoins: [],
        fuses: world.fuses.map(() => false),
        enemy: { ...world.enemy },
      };
    if (start) beginPhase(room, now, level);
    const response = await roomRequest(env, code, '/init', { room });
    if (response.ok) {
      // O D1 guarda só o código, para o painel admin listar as salas.
      await env.DB.prepare(
        "INSERT INTO rooms(code,state,updated_at) VALUES(?,'{}',?) ON CONFLICT(code) DO UPDATE SET updated_at=excluded.updated_at",
      )
        .bind(code, now)
        .run();
      return (await response.json()).room;
    }
    if (response.status !== 409) {
      const data = await response.json().catch(() => ({}));
      throw new ApiError(data.error || 'Não foi possível criar a sala.', response.status);
    }
  }
  throw new ApiError('Não foi possível criar a sala. Tente novamente.', 503);
}

export { createRoom, randomCode, roomRequest, roomStub };

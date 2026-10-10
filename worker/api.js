import { PHASE_ORDER, createWorld } from '../public/world.js';
import { globalChat } from './chat.js';
import { ApiError, dbFor, json } from './http.js';
import { globalLeaderboard } from './leaderboard.js';
import { customMapsApi } from './maps.js';
import { nameOf, newPlayer } from './players.js';
import { explorerProfile } from './profiles.js';
import { ROOM_ACTIONS } from './room-actions.js';
import { validatedLevel, validatedMode } from './rooms.js';

function roomStub(env, code) {
  if (!env.ROOMS) throw new ApiError('Salas indisponíveis neste momento. Tente novamente.', 503);
  return env.ROOMS.get(env.ROOMS.idFromName(code));
}
// Encaminha uma requisição interna (/init, /action, /state) ao Durable Object da sala.
function roomRequest(env, code, path, payload) {
  return roomStub(env, code).fetch(
    new Request('https://room.internal' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  );
}
async function roomState(env, code) {
  if (typeof code !== 'string') throw new ApiError('Sala não encontrada.', 404);
  const response = await roomRequest(env, code, '/state', {});
  if (!response.ok) throw new ApiError('Sala não encontrada.', 404);
  return (await response.json()).room;
}
// GET /api/rooms/:code/ws — upgrade para WebSocket, repassado ao DO da sala.
function roomSocket(request, env, url) {
  const code = url.pathname.split('/')[3].toUpperCase();
  if (request.headers.get('Upgrade') !== 'websocket')
    throw new ApiError('Use uma conexão WebSocket.', 426);
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) throw new ApiError('Origem não permitida.', 403);
  return roomStub(env, code).fetch(request);
}

async function api(request, env) {
  try {
    const url = new URL(request.url);
    if (request.method === 'GET' && /^\/api\/rooms\/[A-Za-z2-9]{6}\/ws$/.test(url.pathname))
      return await roomSocket(request, env, url);
    if (request.method !== 'POST') throw new ApiError('Método não permitido.', 405);
    const maxBody = url.pathname.startsWith('/api/maps/') ? 65536 : 4096;
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) throw new ApiError('Origem não permitida.', 403);
    if (Number(request.headers.get('Content-Length') || 0) > maxBody)
      throw new ApiError('Pedido muito grande.', 413);
    const raw = await request.text();
    if (raw.length > maxBody) throw new ApiError('Pedido muito grande.', 413);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new ApiError('Pedido inválido.');
    }
    if (!body || typeof body !== 'object') throw new ApiError('Pedido inválido.');
    const db = dbFor(env),
      action = url.pathname.split('/').pop();
    if (url.pathname.startsWith('/api/maps/')) return json(await customMapsApi(db, action, body));
    if (url.pathname.startsWith('/api/profiles/'))
      return json(await explorerProfile(db, action, body));
    if (url.pathname.startsWith('/api/leaderboard/'))
      return json(await globalLeaderboard(db, action, body, code => roomState(env, code)));
    if (url.pathname.startsWith('/api/global/')) return json(await globalChat(db, action, body));
    if (action === 'create') {
      const name = nameOf(body),
        now = Date.now(),
        p = newPlayer(name, now),
        seed = crypto.getRandomValues(new Uint32Array(1))[0],
        level = body.campaign ? PHASE_ORDER[0] : validatedLevel(body.level),
        mode = validatedMode(body.mode),
        world = createWorld(seed, level);
      let code;
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      for (let i = 0; i < 5; i++) {
        code = Array.from(
          crypto.getRandomValues(new Uint8Array(6)),
          n => alphabet[n % alphabet.length],
        ).join('');
        const room = {
          code,
          seed,
          level,
          mode,
          campaign: body.campaign === true,
          world,
          coinRespawns: {},
          smile: mode === 'hardcore' ? { ...world.smile } : null,
          players: [p],
          host: p.id,
          status: 'lobby',
          round: 0,
          started: 0,
          lastTick: now,
          balance: 0,
          collectedCoins: [],
          fuses: world.fuses.map(() => false),
          enemy: { ...world.enemy },
        };
        const response = await roomRequest(env, code, '/init', { room });
        if (response.ok)
          return json({ id: p.id, token: p.token, room: (await response.json()).room });
        if (response.status !== 409) return response;
      }
      throw new ApiError('Não foi possível criar a sala. Tente novamente.', 503);
    }
    const code = typeof body.code === 'string' ? body.code.toUpperCase().trim() : '';
    if (!/^[A-Z2-9]{6}$/.test(code)) throw new ApiError('Digite o código de 6 caracteres da sala.');
    if (!ROOM_ACTIONS.includes(action)) throw new ApiError('Ação não encontrada.', 404);
    return roomRequest(env, code, '/action', { action, body });
  } catch (error) {
    if (!(error instanceof ApiError)) console.error('Room API failure', error);
    return json(
      {
        error:
          error instanceof ApiError
            ? error.message
            : 'A conexão com a sala falhou. Tente novamente.',
      },
      error.status || 503,
    );
  }
}

export { api };

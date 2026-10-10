import { PHASE_ORDER } from '@backrooms/shared/world.js';
import { adminApi, requireAccess } from './admin.js';
import { globalChat } from './chat.js';
import { createRoom, roomRequest, roomStub } from './expeditions.js';
import { ApiError, dbFor, json } from './http.js';
import { globalLeaderboard } from './leaderboard.js';
import { inventoryApi } from './inventory.js';
import { lobbyApi, lobbySocket } from './lobby-api.js';
import { workshopApi } from './workshop.js';
import { customMapsApi } from './maps.js';
import { nameOf, newPlayer } from './players.js';
import { explorerProfile } from './profiles.js';
import { ROOM_ACTIONS } from './room-actions.js';
import { validatedLevel, validatedMode } from './rooms.js';

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
    if (request.method === 'GET' && /^\/api\/lobby\/[^/]+\/ws$/.test(url.pathname))
      return await lobbySocket(request, env, url);
    const admin = url.pathname.startsWith('/api/admin/');
    if (admin) await requireAccess(request, env);
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
    if (admin)
      return json(
        await adminApi(db, action, body, {
          state: code => roomState(env, code),
          admin: async (code, adminAction, payload) => {
            const response = await roomRequest(env, code, '/admin', {
              action: adminAction,
              body: payload,
            });
            const data = await response.json();
            if (!response.ok) throw new ApiError(data.error, response.status);
            return data;
          },
        }),
      );
    if (url.pathname.startsWith('/api/lobby/')) return json(await lobbyApi(env, action, body));
    if (url.pathname.startsWith('/api/inventory/'))
      return json(await inventoryApi(db, action, body));
    if (url.pathname.startsWith('/api/workshop/')) return json(await workshopApi(db, action, body));
    if (url.pathname.startsWith('/api/maps/')) return json(await customMapsApi(db, action, body));
    if (url.pathname.startsWith('/api/profiles/'))
      return json(await explorerProfile(db, action, body));
    if (url.pathname.startsWith('/api/leaderboard/'))
      return json(await globalLeaderboard(db, action, body, code => roomState(env, code)));
    if (url.pathname.startsWith('/api/global/')) return json(await globalChat(db, action, body));
    if (action === 'create') {
      const p = newPlayer(nameOf(body), Date.now()),
        room = await createRoom(env, [p], {
          level: body.campaign ? PHASE_ORDER[0] : validatedLevel(body.level),
          mode: validatedMode(body.mode),
          campaign: body.campaign === true,
        });
      return json({ id: p.id, token: p.token, room });
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

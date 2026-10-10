// /api/lobby/*: entrar no lobby público, criar ou entrar num lobby privado e abrir o WebSocket.
import { randomCode } from './expeditions.js';
import { ApiError } from './http.js';
import { nameOf } from './players.js';

const KEY = /^(pub-\d{1,4}|priv-[A-Z2-9]{6})$/;

function lobbyStub(env, key) {
  if (!env.LOBBIES) throw new ApiError('Lobby indisponível neste momento. Tente novamente.', 503);
  return env.LOBBIES.get(env.LOBBIES.idFromName(key));
}

async function lobbyCall(env, key, path, payload) {
  const response = await lobbyStub(env, key).fetch('https://lobby.internal' + path, {
    method: 'POST',
    body: JSON.stringify(payload ?? {}),
  });
  return { status: response.status, data: await response.json() };
}

async function lobbyApi(env, action, body) {
  nameOf(body);
  if (action === 'public') {
    const directory = env.LOBBY_DIRECTORY.get(env.LOBBY_DIRECTORY.idFromName('main')),
      { key } = await (await directory.fetch('https://lobby.internal/assign')).json();
    await lobbyCall(env, key, '/init', { key, public: true }); // 409 = já existia
    return { key };
  }
  if (action === 'private') {
    for (let i = 0; i < 5; i++) {
      const code = randomCode(),
        key = 'priv-' + code,
        { status } = await lobbyCall(env, key, '/init', {
          key,
          code,
          public: false,
          owner: nameOf(body), // o Posto Zero do time leva o nome de quem o criou
          createdAt: Date.now(),
        });
      if (status === 200) return { key, code };
    }
    throw new ApiError('Não foi possível criar o lobby. Tente novamente.', 503);
  }
  if (action === 'join') {
    const code = typeof body.code === 'string' ? body.code.toUpperCase().trim() : '';
    if (!/^[A-Z2-9]{6}$/.test(code))
      throw new ApiError('Digite o código de 6 caracteres do lobby.');
    const key = 'priv-' + code,
      { data } = await lobbyCall(env, key, '/info');
    if (!data.exists) throw new ApiError('Lobby não encontrado. Confira o código.', 404);
    return { key, code };
  }
  throw new ApiError('Ação não encontrada.', 404);
}

// GET /api/lobby/:key/ws?name=… — upgrade repassado ao Durable Object do lobby.
function lobbySocket(request, env, url) {
  const key = decodeURIComponent(url.pathname.split('/')[3]);
  if (!KEY.test(key)) throw new ApiError('Lobby inválido.', 404);
  if (request.headers.get('Upgrade') !== 'websocket')
    throw new ApiError('Use uma conexão WebSocket.', 426);
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) throw new ApiError('Origem não permitida.', 403);
  return lobbyStub(env, key).fetch(request);
}

export { lobbyApi, lobbySocket };

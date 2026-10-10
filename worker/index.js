// Entrada do Worker: /api/* vai para a API; o resto é servido pelos assets estáticos (public/).
import { api } from './api.js';

export { api };
export { LobbyDirectoryDO, LobbyDO } from './lobby-do.js';
export { RoomDO } from './room-do.js';

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/api/')) return api(request, env);
    return env.ASSETS.fetch(request);
  },
};

// Uma expedição do mundo aberto = um Durable Object. Estado em memória, cópia no storage a cada
// 5 s; tick de 20 Hz enquanto houver jogadores conectados. Cada socket recebe só a sua zona.
import { ApiError, json } from './http.js';
import { creditPlayer } from './inventory.js';
import { saveRun } from './ranking.js';
import { createExpedition, stepWorld, tickWorld, viewFor } from './world-sim.js';

const TICK_MS = 50,
  SAVE_MS = 5000,
  MAX_MESSAGE = 4096;

class WorldDO {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.ready = ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get('state')) ?? null;
      if (this.state && ctx.getWebSockets().length) this.startTick();
    });
  }

  async fetch(request) {
    try {
      await this.ready;
      const path = new URL(request.url).pathname;
      if (request.headers.get('Upgrade') === 'websocket') return this.upgrade();
      if (path === '/init') {
        if (this.state) throw new ApiError('Código em uso.', 409);
        const { code, seed, players, lobbyKey } = await request.json();
        this.state = createExpedition({ code, seed, players, lobbyKey, now: Date.now() });
        await this.ctx.storage.put('state', this.state);
        return json({ code });
      }
      throw new ApiError('Ação não encontrada.', 404);
    } catch (error) {
      if (!(error instanceof ApiError)) console.error('World DO failure', error);
      return json({ error: error.message }, error.status || 503);
    }
  }

  upgrade() {
    if (!this.state) throw new ApiError('Expedição não encontrada.', 404);
    const pair = new WebSocketPair(),
      [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({});
    this.startTick();
    return new Response(null, { status: 101, webSocket: client });
  }

  // Protocolo: {action, reqId, ...corpo} → {type:'result'|'error', reqId}; o primeiro é
  // {action:'hello', id, token}, que liga o socket ao jogador (os seguintes não repetem o token).
  async webSocketMessage(ws, message) {
    await this.ready;
    let msg;
    try {
      if (typeof message !== 'string' || message.length > MAX_MESSAGE) throw new Error('size');
      msg = JSON.parse(message);
    } catch {
      return ws.send(JSON.stringify({ type: 'error', error: 'Pedido inválido.', status: 400 }));
    }
    const { action, reqId = null, ...body } = msg,
      bound = ws.deserializeAttachment(),
      player = this.state.players.find(p => p.id === (action === 'hello' ? body.id : bound.id)),
      auth = action === 'hello' ? body : { id: bound.id, token: player?.token };
    try {
      const now = Date.now(),
        result = stepWorld(this.state, action, { ...body, ...auth }, now);
      if (action === 'hello') ws.serializeAttachment({ id: body.id });
      ws.send(JSON.stringify({ type: 'result', reqId, ...result }));
      if (result.extracted) await this.credit(player, result.extracted);
      await this.settle();
      this.broadcast(now);
      this.dirty = true;
    } catch (error) {
      ws.send(
        JSON.stringify({
          type: 'error',
          reqId,
          error: error instanceof ApiError ? error.message : 'Erro na expedição.',
          status: error.status || 503,
        }),
      );
    }
  }

  // Quem sai pelo portal leva a mochila para o estoque (e as resgatadas para os donos).
  async credit(player, extracted) {
    const db = this.env?.DB;
    if (!db) return;
    const byId = new Map(this.state.players.map(p => [p.id, p]));
    for (const [ownerId, items] of Object.entries(extracted)) {
      const owner = byId.get(ownerId);
      if (owner?.keyHash)
        await creditPlayer(db, {
          id: `${this.state.code}:${ownerId}:${Date.now()}`,
          code: this.state.code,
          keyHash: owner.keyHash,
          items,
          startedAt: this.state.startedAt,
        }).catch(error => console.error('Falha ao creditar estoque', error));
    }
    if (this.state.status === 'ended' && this.state.lobbyKey && this.env.LOBBIES)
      this.ctx.waitUntil?.(
        this.env.LOBBIES.get(this.env.LOBBIES.idFromName(this.state.lobbyKey))
          .fetch('https://lobby.internal/result', {
            method: 'POST',
            body: JSON.stringify({ won: false, loot: extracted[player.id] || {} }),
          })
          .catch(() => {}),
      );
  }

  // Vitória (chefão derrotado): credita a mochila de todos. Gerador apagado ou chefão vencido:
  // avisa o Posto Zero uma vez.
  async settle() {
    const state = this.state,
      extract = state.pendingExtract;
    if (extract) {
      state.pendingExtract = null;
      const byId = new Map(state.players.map(p => [p.id, p]));
      for (const [ownerId, items] of Object.entries(extract)) {
        const owner = byId.get(ownerId);
        if (owner?.keyHash && this.env?.DB)
          await creditPlayer(this.env.DB, {
            id: `${state.code}:${ownerId}:won`,
            code: state.code,
            keyHash: owner.keyHash,
            items,
            startedAt: state.startedAt,
          }).catch(error => console.error('Falha ao creditar estoque', error));
      }
      state.wonLoot = Object.values(extract).reduce((all, items) => {
        for (const [item, qty] of Object.entries(items)) all[item] = (all[item] || 0) + qty;
        return all;
      }, {});
    }
    // Toda expedição terminada (saíram todos, venceram ou o gerador apagou) entra no ranking.
    if (state.status !== 'playing' && !state.runSaved && this.env?.DB) {
      state.runSaved = true;
      await saveRun(this.env.DB, state, Date.now()).catch(error =>
        console.error('Falha ao salvar no ranking', error),
      );
    }
    if ((state.status === 'failed' || state.status === 'won') && !state.failReported) {
      state.failReported = true;
      if (state.lobbyKey && this.env.LOBBIES)
        await this.env.LOBBIES.get(this.env.LOBBIES.idFromName(state.lobbyKey))
          .fetch('https://lobby.internal/result', {
            method: 'POST',
            body: JSON.stringify({ won: state.status === 'won', loot: state.wonLoot || {} }),
          })
          .catch(() => {});
    }
  }

  broadcast(now = Date.now()) {
    this.mapSent ??= new WeakMap();
    for (const ws of this.ctx.getWebSockets()) {
      const { id } = ws.deserializeAttachment() || {};
      if (!id) continue;
      try {
        const view = viewFor(this.state, id, now);
        ws.send(JSON.stringify({ type: 'world', view }));
        // A névoa do mini mapa só vai quando muda (e só para quem tem o mapa).
        const key = `${view.zone}:${view.map.version}`;
        if (view.map.owned && this.mapSent.get(ws) !== key) {
          this.mapSent.set(ws, key);
          ws.send(
            JSON.stringify({
              type: 'map',
              zone: view.zone,
              cells: this.state.explored[view.zone].join(''),
            }),
          );
        }
      } catch {}
    }
  }

  startTick() {
    if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  tick() {
    if (!this.state || !this.ctx.getWebSockets().length) {
      clearInterval(this.timer);
      this.timer = null;
      return;
    }
    const now = Date.now();
    tickWorld(this.state, now);
    this.broadcast(now);
    this.ctx.waitUntil?.(this.settle());
    if (now - (this.savedAt || 0) >= SAVE_MS) {
      this.savedAt = now;
      this.ctx.waitUntil?.(this.ctx.storage.put('state', this.state));
    }
  }

  webSocketClose(ws, code) {
    try {
      ws.close(code || 1000);
    } catch {}
  }
}

export { WorldDO };

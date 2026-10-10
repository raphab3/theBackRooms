import { ApiError, json } from './http.js';
import { TTL, beginPhase, safeRoom, tickRoom } from './rooms.js';
import { ROOM_ACTIONS, stepRoom } from './room-actions.js';
import { recordPlayers, recordRtt, recordSocketError, track } from './telemetry.js';

const TICK_MS = 50, // 20 Hz
  SAVE_MS = 5000,
  MAX_MESSAGE = 4096,
  SOCKET_ACTIONS = ROOM_ACTIONS.filter(a => a !== 'join');
const notFound = () => new ApiError('Sala não encontrada ou expirada. Confira o código.', 404);

// Uma sala = um Durable Object. O estado vive na memória; o ctx.storage guarda cópias periódicas.
class RoomDO {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.room = null;
    this.dirty = false;
    this.lastSave = 0;
    this.timer = null;
    this.ready = ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get('room')) ?? null;
      // Acordou da hibernação/evicção com jogadores ainda conectados: retoma o tick.
      if (this.room && ctx.getWebSockets().length) this.startTick();
    });
  }

  async fetch(request) {
    try {
      await this.ready;
      const path = new URL(request.url).pathname;
      if (request.headers.get('Upgrade') === 'websocket') return this.upgrade();
      if (path === '/init') return json(this.init(await request.json()));
      if (path === '/state') return json({ room: this.live() });
      if (path === '/admin') {
        const { action, body } = await request.json();
        return json(this.admin(action, body));
      }
      if (path === '/action') {
        const { action, body } = await request.json();
        return json(this.run(action, body));
      }
      throw new ApiError('Ação não encontrada.', 404);
    } catch (error) {
      return this.failure(error);
    }
  }

  failure(error) {
    if (!(error instanceof ApiError)) console.error('Room DO failure', error);
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

  live() {
    if (this.room && Date.now() - this.room.updatedAt > TTL && !this.ctx.getWebSockets().length) {
      this.room = null;
      this.dirty = false;
      this.stopTick();
      this.ctx.waitUntil?.(this.ctx.storage.deleteAll());
    }
    if (!this.room) throw notFound();
    return this.room;
  }

  init({ room }) {
    if (this.room) throw new ApiError('Código em uso.', 409);
    const now = Date.now();
    this.room = { ...room, revision: 0, updatedAt: now };
    this.persist();
    return { room: { ...safeRoom(this.room, now), revision: 0 } };
  }

  run(action, body) {
    const room = this.live(),
      now = Date.now(),
      before = room.status,
      beforeRound = room.round,
      extra = stepRoom(room, action, body || {}, now);
    room.revision = (room.revision || 0) + 1;
    room.updatedAt = now;
    // Movimento só vai para o storage a cada 5 s; qualquer outra mudança de estado, na hora.
    if (action !== 'sync' || room.status !== before || room.round !== beforeRound) this.persist();
    else this.markDirty();
    const view = { ...safeRoom(room, now), revision: room.revision };
    if (action !== 'sync') this.broadcast(view);
    return { ...extra, room: view };
  }

  // Ações do painel admin (o Worker já validou o Cloudflare Access).
  admin(action, body) {
    const room = this.live(),
      now = Date.now();
    if (action === 'level') {
      room.adminUsed = true;
      room.campaign = false;
      beginPhase(room, now, body.level);
    } else if (action === 'chat-delete')
      room.messages = (room.messages || []).filter(m => m.id !== body.id);
    else throw new ApiError('Ação não encontrada.', 404);
    room.revision = (room.revision || 0) + 1;
    room.updatedAt = now;
    this.persist();
    const view = { ...safeRoom(room, now), revision: room.revision };
    this.broadcast(view);
    return { room: view };
  }

  persist() {
    this.dirty = false;
    this.lastSave = Date.now();
    this.ctx.waitUntil?.(this.ctx.storage.put('room', this.room));
    this.ctx.storage.setAlarm?.(this.lastSave + TTL + 1000);
  }

  markDirty() {
    if (this.dirty) return;
    this.dirty = true;
    this.ctx.storage.setAlarm?.(Date.now() + SAVE_MS);
  }

  async alarm() {
    await this.ready;
    if (!this.room) return;
    if (this.dirty) return this.persist();
    if (Date.now() - this.room.updatedAt > TTL && !this.ctx.getWebSockets().length) {
      this.room = null;
      await this.ctx.storage.deleteAll();
    } else this.ctx.storage.setAlarm?.(this.room.updatedAt + TTL + 1000);
  }

  // --- WebSocket (Hibernation API) ---
  upgrade() {
    this.live();
    const pair = new WebSocketPair(),
      [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    this.startTick();
    server.send(JSON.stringify({ type: 'room', room: this.view() }));
    return new Response(null, { status: 101, webSocket: client });
  }

  view() {
    const now = Date.now(),
      room = this.live();
    return { ...safeRoom(room, now), revision: room.revision || 0 };
  }

  broadcast(view = this.view()) {
    const text = JSON.stringify({ type: 'room', room: view });
    for (const ws of this.ctx.getWebSockets())
      try {
        ws.send(text);
      } catch {}
  }

  async webSocketMessage(ws, message) {
    await this.ready;
    let msg;
    try {
      if (typeof message !== 'string' || message.length > MAX_MESSAGE) throw new Error('size');
      msg = JSON.parse(message);
      if (!msg || typeof msg !== 'object') throw new Error('shape');
    } catch {
      return ws.send(JSON.stringify({ type: 'error', error: 'Pedido inválido.', status: 400 }));
    }
    const { reqId = null, action, ...body } = msg;
    try {
      if (!SOCKET_ACTIONS.includes(action)) throw new ApiError('Ação não encontrada.', 404);
      if (body.rtt !== undefined) recordRtt(this.env, this.room?.code, body.id, body.rtt);
      ws.send(JSON.stringify({ type: 'result', reqId, ...this.run(action, body) }));
    } catch (error) {
      const failed = JSON.parse(await this.failure(error).text());
      ws.send(
        JSON.stringify({ type: 'error', reqId, error: failed.error, status: error.status || 503 }),
      );
    }
  }

  webSocketClose(ws, code) {
    try {
      ws.close(code || 1000);
    } catch {}
    this.afterDisconnect(ws);
  }

  webSocketError(ws, error) {
    recordSocketError(this.env, this.room?.code, error?.message || 'error');
    this.afterDisconnect(ws);
  }

  afterDisconnect(ws) {
    if (this.ctx.getWebSockets().filter(s => s !== ws).length) return;
    this.stopTick();
    if (this.room && this.dirty) this.persist();
  }

  // --- tick de 20 Hz: só existe enquanto há jogadores conectados ---
  startTick() {
    if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stopTick() {
    clearInterval(this.timer);
    this.timer = null;
  }

  tick() {
    if (!this.room || !this.ctx.getWebSockets().length) return this.stopTick();
    const started = performance.now();
    this.stepTick();
    // Telemetria amostrada: o pior tick e os jogadores conectados a cada 5 s (não 20 pontos/s).
    this.worstTick = Math.max(this.worstTick || 0, performance.now() - started);
    if (Date.now() - (this.lastReport || 0) >= SAVE_MS) {
      this.lastReport = Date.now();
      track(this.env, 'tick', this.room?.code, this.worstTick);
      recordPlayers(this.env, this.room?.code, this.ctx.getWebSockets().length);
      this.worstTick = 0;
    }
  }

  stepTick() {
    const room = this.room,
      now = Date.now(),
      before = `${room.status}|${room.round}`;
    tickRoom(room, now);
    if (room.status === 'won') {
      if (!Number.isFinite(room.finished) || room.finished <= room.started) room.finished = now;
    } else room.finished = 0;
    const changed = before !== `${room.status}|${room.round}`;
    if (room.status === 'playing' || changed) {
      room.revision = (room.revision || 0) + 1;
      this.broadcast();
    }
    if (changed) this.persist();
    else if (this.dirty && now - this.lastSave >= SAVE_MS) this.persist();
  }
}

export { RoomDO };

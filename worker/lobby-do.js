// Lobby 3D: um Durable Object por grupo público (pub-N) ou lobby privado (priv-CODIGO).
// Guarda presença, posições, chat, emotes, grupos de amigos e os portais de 4 lugares.
import {
  EMOTES,
  LOBBY_CAPACITY,
  LOBBY_SPAWN,
  PARTY_MAX,
  RUN_SPEED,
  SKINS,
  clampToLobby,
  newPortals,
  setPortalTarget,
  stepPortals,
} from '@backrooms/shared/lobby.js';
import { PHASE_ORDER } from '@backrooms/shared/world.js';
import { createRoom } from './expeditions.js';
import { hashKey } from './inventory.js';
import { readArms } from './workshop.js';
import { ApiError, json } from './http.js';
import { colors, nameOf, newPlayer } from './players.js';

const TICK_MS = 100, // 10 Hz: lobby não precisa de mais
  MAX_MESSAGE = 1024,
  CHAT_GAP_MS = 800,
  EMOTE_MS = 3000,
  INVITE_MS = 30000,
  NOTICE_GAP_MS = 3000,
  ANIMS = ['idle', 'walk', 'run', 'jump'];

class LobbyDO {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.players = new Map(); // id → {id, name, color, x, z, yaw, anim, emote, moveAt, chatAt}
    this.parties = new Map(); // partyId → {leader, members}
    this.invites = new Map(); // convidado → {from, until}
    this.portals = newPortals();
    this.noticeAt = new Map();
    this.ready = ctx.blockConcurrencyWhile(async () => {
      this.meta = (await ctx.storage.get('meta')) ?? null;
      // Acordou da hibernação: os sockets voltam com o anexo; as posições recomeçam no spawn.
      for (const ws of ctx.getWebSockets()) this.addPlayer(ws.deserializeAttachment());
      if (this.players.size) this.startTick();
    });
  }

  async fetch(request) {
    try {
      await this.ready;
      const url = new URL(request.url);
      if (request.headers.get('Upgrade') === 'websocket') return this.upgrade(url);
      if (url.pathname === '/init') {
        if (this.meta) throw new ApiError('Código em uso.', 409);
        this.meta = await request.json();
        await this.ctx.storage.put('meta', this.meta);
        return json({ ok: true });
      }
      if (url.pathname === '/info')
        return json({ exists: !!this.meta, players: this.players.size });
      // Resultado de uma expedição que saiu deste lobby: vira histórico do Posto Zero do time.
      if (url.pathname === '/result') {
        const { won, loot } = await request.json(),
          base = (this.meta.base ??= { expeditions: 0, wins: 0, loot: {} });
        base.expeditions++;
        if (won) base.wins++;
        for (const [item, qty] of Object.entries(loot || {}))
          if (Number.isSafeInteger(qty)) base.loot[item] = (base.loot[item] || 0) + qty;
        await this.ctx.storage.put('meta', this.meta);
        return json({ ok: true });
      }
      throw new ApiError('Ação não encontrada.', 404);
    } catch (error) {
      if (!(error instanceof ApiError)) console.error('Lobby DO failure', error);
      return json({ error: error.message }, error.status || 503);
    }
  }

  upgrade(url) {
    if (!this.meta) throw new ApiError('Lobby não encontrado. Confira o código.', 404);
    if (this.players.size >= LOBBY_CAPACITY) throw new ApiError('Este lobby está cheio.', 409);
    const name = nameOf({ name: url.searchParams.get('name') }),
      used = [...this.players.values()].map(p => p.color),
      skin = url.searchParams.get('skin'),
      player = {
        id: crypto.randomUUID(),
        name,
        skin: SKINS.includes(skin) ? skin : SKINS[this.players.size % SKINS.length],
        color: colors.find(c => !used.includes(c)) || colors[this.players.size % colors.length],
      };
    const pair = new WebSocketPair(),
      [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(player);
    this.addPlayer(player);
    server.send(
      JSON.stringify({
        t: 'welcome',
        id: player.id,
        key: this.meta.key,
        code: this.meta.code,
        owner: this.meta.owner || null,
        base: this.meta.base || null,
      }),
    );
    this.startTick();
    this.report();
    return new Response(null, { status: 101, webSocket: client });
  }

  addPlayer({ id, name, color, skin, keyHash }) {
    this.players.set(id, {
      id,
      name,
      color,
      skin,
      keyHash,
      x: LOBBY_SPAWN.x + (Math.random() - 0.5) * 4,
      z: LOBBY_SPAWN.z + (Math.random() - 0.5) * 2,
      yaw: Math.PI,
      anim: 'idle',
      emote: null,
      moveAt: Date.now(),
      chatAt: 0,
    });
  }

  removePlayer(id) {
    if (!this.players.delete(id)) return;
    this.invites.delete(id);
    this.leaveParty(id);
    this.report();
  }

  socketOf(id) {
    return this.ctx.getWebSockets().find(ws => ws.deserializeAttachment()?.id === id);
  }

  send(id, message) {
    try {
      this.socketOf(id)?.send(JSON.stringify(message));
    } catch {}
  }

  broadcast(message) {
    const text = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets())
      try {
        ws.send(text);
      } catch {}
  }

  notice(id, text) {
    const now = Date.now();
    if (now - (this.noticeAt.get(id) || 0) < NOTICE_GAP_MS) return;
    this.noticeAt.set(id, now);
    this.send(id, { t: 'notice', text });
  }

  // O diretório de grupos públicos acompanha a lotação para mandar gente nova para o grupo certo.
  report() {
    if (!this.meta?.public || !this.env.LOBBY_DIRECTORY) return;
    const directory = this.env.LOBBY_DIRECTORY.get(this.env.LOBBY_DIRECTORY.idFromName('main'));
    this.ctx.waitUntil?.(
      directory
        .fetch('https://lobby.internal/report', {
          method: 'POST',
          body: JSON.stringify({ key: this.meta.key, count: this.players.size }),
        })
        .catch(() => {}),
    );
  }

  async webSocketMessage(ws, message) {
    await this.ready;
    const me = ws.deserializeAttachment(),
      p = this.players.get(me?.id);
    if (!p) return;
    let msg;
    try {
      if (typeof message !== 'string' || message.length > MAX_MESSAGE) throw new Error('size');
      msg = JSON.parse(message);
    } catch {
      return this.send(p.id, { t: 'error', error: 'Pedido inválido.' });
    }
    try {
      await this.handle(p, msg, Date.now());
    } catch (error) {
      this.send(p.id, { t: 'error', error: error instanceof ApiError ? error.message : 'Erro.' });
    }
  }

  handle(p, msg, now) {
    if (msg.t === 'move') {
      const { x, z, yaw } = msg;
      if (![x, z, yaw].every(Number.isFinite)) throw new ApiError('Movimento inválido.');
      // Folga de 50% e 0,5 m sobre a corrida: tolera atraso de rede, recusa teleporte.
      const limit = RUN_SPEED * 1.5 * Math.max(0.05, (now - p.moveAt) / 1000) + 0.5;
      if (Math.hypot(x - p.x, z - p.z) > limit) {
        p.moveAt = now;
        return this.send(p.id, { t: 'correct', x: p.x, z: p.z });
      }
      Object.assign(p, clampToLobby(x, z), {
        yaw,
        anim: ANIMS.includes(msg.anim) ? msg.anim : 'idle',
        moveAt: now,
      });
      if (p.anim !== 'idle' && p.emote) p.emote = null;
      return;
    }
    if (msg.t === 'chat') {
      const text =
        typeof msg.text === 'string' ? msg.text.replace(/[\x00-\x1f\x7f]/g, ' ').trim() : '';
      if (!text || text.length > 240)
        throw new ApiError('Escreva uma mensagem com até 240 caracteres.');
      if (now - p.chatAt < CHAT_GAP_MS)
        throw new ApiError('Espere um instante antes de enviar outra mensagem.');
      p.chatAt = now;
      return this.broadcast({ t: 'chat', id: p.id, name: p.name, color: p.color, text });
    }
    if (msg.t === 'emote') {
      if (!EMOTES.includes(msg.e)) throw new ApiError('Emote inválido.');
      // n conta os gestos: apertar de novo o mesmo gesto faz o boneco repetir.
      p.emote = { e: msg.e, until: now + EMOTE_MS, n: (p.emoteN = (p.emoteN || 0) + 1) };
      return;
    }
    if (msg.t === 'portalTarget') {
      const portal = this.portals.find(v => v.id === msg.portal);
      if (!portal) throw new ApiError('Portal não encontrado.');
      try {
        setPortalTarget(portal, p.id, msg.n);
      } catch (error) {
        throw new ApiError(error.message);
      }
      return;
    }
    if (msg.t === 'auth') return this.auth(p, msg.key);
    if (msg.t === 'invite') return this.invite(p, msg.to, now);
    if (msg.t === 'accept') return this.accept(p, now);
    if (msg.t === 'leaveParty') return this.leaveParty(p.id);
    throw new ApiError('Mensagem desconhecida.');
  }

  // A chave do aparelho chega pelo socket (nunca na URL); só o hash fica guardado.
  async auth(p, key) {
    p.keyHash = await hashKey(key);
    const ws = this.socketOf(p.id);
    ws?.serializeAttachment({ ...ws.deserializeAttachment(), keyHash: p.keyHash });
  }

  partyOf(id) {
    for (const [pid, party] of this.parties) if (party.members.includes(id)) return [pid, party];
    return [null, null];
  }

  invite(p, to, now) {
    const target = this.players.get(to);
    if (!target || to === p.id) throw new ApiError('Jogador não encontrado.');
    const [, mine] = this.partyOf(p.id);
    if (mine && mine.leader !== p.id) throw new ApiError('Só o líder do grupo pode convidar.');
    if (mine && mine.members.length >= PARTY_MAX) throw new ApiError('O grupo já tem 4 jogadores.');
    if (this.partyOf(to)[1]) throw new ApiError(`${target.name} já está em um grupo.`);
    this.invites.set(to, { from: p.id, until: now + INVITE_MS });
    this.send(to, { t: 'invited', from: p.id, name: p.name });
    this.send(p.id, { t: 'notice', text: `Convite enviado para ${target.name}.` });
  }

  accept(p, now) {
    const invite = this.invites.get(p.id);
    this.invites.delete(p.id);
    const host = invite && this.players.get(invite.from);
    if (!host || invite.until < now) throw new ApiError('O convite expirou.');
    this.leaveParty(p.id);
    let [, party] = this.partyOf(host.id);
    if (!party) {
      party = { leader: host.id, members: [host.id] };
      this.parties.set(crypto.randomUUID(), party);
    }
    if (party.members.length >= PARTY_MAX) throw new ApiError('O grupo já está cheio.');
    party.members.push(p.id);
  }

  leaveParty(id) {
    const [pid, party] = this.partyOf(id);
    if (!party) return;
    party.members = party.members.filter(m => m !== id);
    if (party.members.length < 2) this.parties.delete(pid);
    else if (party.leader === id) party.leader = party.members[0];
  }

  startTick() {
    if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  tick() {
    if (!this.ctx.getWebSockets().length) {
      clearInterval(this.timer);
      this.timer = null;
      return;
    }
    const now = Date.now();
    for (const p of this.players.values()) if (p.emote && p.emote.until < now) p.emote = null;
    const { fired, notices } = stepPortals(this.portals, this.players, this.parties, now);
    for (const n of notices) this.notice(n.id, n.text);
    for (const f of fired) {
      // Quem viaja sai do lobby na hora, senão continuaria na plataforma e entraria de novo.
      const group = f.ids.map(id => this.players.get(id)).filter(Boolean);
      for (const p of group) this.removePlayer(p.id);
      void this.travel(f.level, group);
    }
    this.broadcast({
      t: 'snap',
      now,
      players: [...this.players.values()].map(p => ({
        id: p.id,
        name: p.name,
        color: p.color,
        skin: p.skin,
        x: Math.round(p.x * 100) / 100,
        z: Math.round(p.z * 100) / 100,
        yaw: Math.round(p.yaw * 1000) / 1000,
        anim: p.anim,
        emote: p.emote?.e || null,
        emoteN: p.emote?.n || 0,
        party: this.partyOf(p.id)[0],
      })),
      portals: this.portals.map(({ id, level, slots, endsAt, owner, target }) => ({
        id,
        level,
        slots,
        endsAt,
        owner,
        target,
      })),
    });
  }

  // O portal disparou: cria a partida com todos dentro e manda a cada um a sua credencial.
  async travel(level, group) {
    if (!group.length) return;
    const now = Date.now(),
      players = [];
    for (const p of group) {
      // O nível do braço vai junto para a partida (o servidor da sala calcula o dano com ele).
      const armLevel =
        p.keyHash && this.env.DB
          ? (await readArms(this.env.DB, p.keyHash).catch(() => ({ fire: 1 }))).fire
          : 1;
      players.push({
        ...newPlayer(p.name, now, players),
        skin: p.skin,
        keyHash: p.keyHash,
        armLevel,
      });
    }
    try {
      const room = await createRoom(this.env, players, {
        level: level || PHASE_ORDER[0],
        mode: 'normal',
        // Expedição de um nível só: no fim o grupo volta ao lobby, sem avançar de fase sozinho.
        campaign: false,
        start: true,
        lobbyKey: this.meta.key,
      });
      group.forEach((p, i) => {
        this.send(p.id, {
          t: 'travel',
          code: room.code,
          id: players[i].id,
          token: players[i].token,
          name: p.name,
        });
        try {
          this.socketOf(p.id)?.close(1000, 'travel');
        } catch {}
      });
    } catch (error) {
      console.error('Portal failure', error);
      // Volta para o lobby quem ainda está conectado.
      for (const p of group) {
        if (!this.socketOf(p.id)) continue;
        this.addPlayer(p);
        this.send(p.id, { t: 'notice', text: 'O portal falhou. Tente de novo.' });
      }
    }
  }

  webSocketClose(ws, code) {
    try {
      ws.close(code || 1000);
    } catch {}
    this.removePlayer(ws.deserializeAttachment()?.id);
  }

  webSocketError(ws) {
    this.removePlayer(ws.deserializeAttachment()?.id);
  }
}

// Diretório dos grupos públicos: devolve o primeiro com vaga ou abre um novo.
class LobbyDirectoryDO {
  constructor(ctx) {
    this.ctx = ctx;
    this.ready = ctx.blockConcurrencyWhile(async () => {
      this.counts = (await ctx.storage.get('counts')) ?? {};
    });
  }

  async fetch(request) {
    await this.ready;
    const path = new URL(request.url).pathname;
    if (path === '/report') {
      const { key, count } = await request.json();
      this.counts[key] = count;
    } else if (path === '/assign') {
      const keys = Object.keys(this.counts).sort(
        (a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]),
      );
      let key = keys.find(k => this.counts[k] < LOBBY_CAPACITY);
      if (!key) key = `pub-${keys.length + 1}`;
      // Reserva a vaga já, para uma leva de gente entrando junto não lotar o mesmo grupo.
      this.counts[key] = (this.counts[key] || 0) + 1;
      await this.ctx.storage.put('counts', this.counts);
      return json({ key });
    } else return json({ error: 'Ação não encontrada.' }, 404);
    await this.ctx.storage.put('counts', this.counts);
    return json({ ok: true });
  }
}

export { LobbyDirectoryDO, LobbyDO };

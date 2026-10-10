import { PHASE_ORDER, createWorld } from '../public/world.js';
import { globalChat } from './chat.js';
import { ApiError, dbFor, json } from './http.js';
import { globalLeaderboard } from './leaderboard.js';
import { customMapsApi } from './maps.js';
import { adminName, authorize, colors, nameOf, newPlayer } from './players.js';
import { explorerProfile } from './profiles.js';
import {
  ACTIVE_MS,
  MAX_PLAYERS,
  TTL,
  beginPhase,
  distance,
  mutate,
  safeRoom,
  validateMovement,
  validatedLevel,
  validatedMode,
} from './rooms.js';

async function api(request, env) {
  try {
    const url = new URL(request.url);
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
      return json(await globalLeaderboard(db, action, body));
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
        const result = await db
          .prepare('INSERT OR IGNORE INTO rooms(code,state,revision,updated_at) VALUES(?,?,0,?)')
          .bind(code, JSON.stringify(room), now)
          .run();
        if (result.meta.changes) {
          await db
            .prepare(
              'DELETE FROM rooms WHERE code IN (SELECT code FROM rooms WHERE updated_at<? LIMIT 30)',
            )
            .bind(now - TTL)
            .run();
          return json({ id: p.id, token: p.token, room: { ...safeRoom(room, now), revision: 0 } });
        }
      }
      throw new ApiError('Não foi possível criar a sala. Tente novamente.', 503);
    }
    const code = typeof body.code === 'string' ? body.code.toUpperCase().trim() : '';
    if (!/^[A-Z2-9]{6}$/.test(code)) throw new ApiError('Digite o código de 6 caracteres da sala.');
    if (action === 'join') {
      const name = nameOf(body),
        p = newPlayer(name, Date.now());
      return json(
        await mutate(db, code, (room, now) => {
          if (room.status === 'won' || room.status === 'lost')
            throw new ApiError('A partida acabou. Peça ao anfitrião para reiniciar.', 409);
          room.players = room.players.filter(p => now - p.seen < ACTIVE_MS);
          if (room.players.length >= MAX_PLAYERS)
            throw new ApiError('Esta sala está cheia (4 jogadores).', 409);
          p.color = colors.find(c => !room.players.some(v => v.color === c)) || colors[0];
          room.players.push(p);
          return { id: p.id, token: p.token };
        }),
      );
    }
    if (
      !['sync', 'start', 'leave', 'revive', 'level', 'mode', 'chat', 'admin-level'].includes(action)
    )
      throw new ApiError('Ação não encontrada.', 404);
    return json(
      await mutate(db, code, (room, now) => {
        const p = authorize(room, body),
          previousSeen = p.seen;
        p.seen = now;
        if (action === 'chat') {
          const text =
            typeof body.text === 'string' ? body.text.replace(/[\x00-\x1f\x7f]/g, ' ').trim() : '';
          if (!text || text.length > 240)
            throw new ApiError('Escreva uma mensagem com até 240 caracteres.');
          if (typeof body.messageId !== 'string' || !/^[a-zA-Z0-9-]{8,64}$/.test(body.messageId))
            throw new ApiError('Mensagem inválida.');
          room.messages = room.messages || [];
          if (room.messages.some(m => m.sender === p.id && m.clientId === body.messageId))
            return {};
          if (p.lastChat && now - p.lastChat < 800)
            throw new ApiError('Espere um instante antes de enviar outra mensagem.', 429);
          p.lastChat = now;
          room.messages.push({
            id: crypto.randomUUID(),
            clientId: body.messageId,
            sender: p.id,
            name: p.name,
            color: p.color,
            text,
            at: now,
          });
          room.messages = room.messages.slice(-50);
          return {};
        }
        if (action === 'leave') {
          room.players = room.players.filter(v => v.id !== p.id);
          if (room.host === p.id) room.host = room.players[0]?.id || '';
          return {};
        }
        if (
          room.campaign &&
          room.status === 'won' &&
          PHASE_ORDER[PHASE_ORDER.indexOf(room.level) + 1] &&
          ['start', 'mode'].includes(action)
        )
          throw new ApiError('Aguarde a passagem para a próxima fase.', 409);
        if (action === 'admin-level') {
          if (!adminName(p.name)) throw new ApiError('Painel exclusivo do admin.', 403);
          const level = body.level === 'lurking' ? 'lurking' : validatedLevel(body.level);
          room.adminUsed = true;
          room.campaign = false;
          beginPhase(room, now, level);
          return {};
        }
        if (action === 'revive') {
          if (room.mode === 'hardcore' && !adminName(p.name))
            throw new ApiError('No Hardcore não é possível reviver.', 409);
          if (!['playing', 'lost'].includes(room.status))
            throw new ApiError('A expedição precisa estar em andamento.', 409);
          const captured = room.players.filter(v => !v.alive && now - v.seen < ACTIVE_MS);
          if (!captured.length) throw new ApiError('Todos os exploradores já estão vivos.', 409);
          if (!adminName(p.name) && room.balance < 25)
            throw new ApiError('A equipe precisa de 25 moedas para reviver.', 409);
          if (adminName(p.name)) room.adminUsed = true;
          else room.balance -= 25;
          room.status = 'playing';
          room.lastTick = now;
          for (const v of captured) {
            v.alive = true;
            v.x = 1.5;
            v.y = 1.5;
            v.a = 0;
            v.protectedUntil = now + 5000;
            v.moveOrdinal = 0;
            v.moveCredit = 0.5;
            v.moveClock = now;
            v.respawns = (v.respawns || 0) + 1;
          }
          return { revived: captured.length };
        }
        if (action === 'level' || action === 'mode') {
          if (action === 'level' && room.campaign)
            throw new ApiError('As fases da expedição seguem uma sequência.', 409);
          if (room.host !== p.id)
            throw new ApiError('Somente o anfitrião pode escolher o cenário.', 403);
          if (room.status === 'playing')
            throw new ApiError('Escolha o cenário antes de iniciar a partida.', 409);
          const level = action === 'level' ? validatedLevel(body.level) : room.level,
            mode = action === 'mode' ? validatedMode(body.mode) : room.mode;
          if (level === room.level && mode === room.mode) return {};
          room.mode = mode;
          room.level = level;
          room.world = createWorld(room.seed, level);
          room.enemy = { ...room.world.enemy };
          room.smile = room.mode === 'hardcore' ? { ...room.world.smile } : null;
          room.status = 'lobby';
          room.round++;
          room.started = 0;
          room.balance = 0;
          room.collectedCoins = [];
          room.coinRespawns = {};
          room.fuses = room.world.fuses.map(() => false);
          for (const v of room.players) {
            v.x = 1.5;
            v.y = 1.5;
            v.a = 0;
            v.alive = true;
            v.seq = 0;
            v.moveOrdinal = 0;
            v.moveCredit = 0.5;
            v.moveClock = now;
            v.respawns = 0;
            v.protectedUntil = 0;
          }
          return {};
        }
        if (action === 'start') {
          if (room.host !== p.id) throw new ApiError('Somente o anfitrião pode iniciar.', 403);
          if (room.status === 'playing') return {};
          if (room.campaign) {
            const level =
              room.status === 'won' && !PHASE_ORDER[PHASE_ORDER.indexOf(room.level) + 1]
                ? PHASE_ORDER[0]
                : room.level;
            if (room.status === 'won' && level === PHASE_ORDER[0]) room.campaignStarted = now;
            beginPhase(room, now, level);
            return {};
          }
          room.status = 'playing';
          room.started = now;
          room.lastTick = now;
          room.round++;
          room.balance = 0;
          room.collectedCoins = [];
          room.coinRespawns = {};
          room.fuses = room.world.fuses.map(() => false);
          room.enemy = { ...room.world.enemy };
          room.smile = room.mode === 'hardcore' ? { ...room.world.smile } : null;
          for (const v of room.players) {
            v.x = 1.5;
            v.y = 1.5;
            v.a = 0;
            v.alive = true;
            v.seq = 0;
            v.moveOrdinal = 0;
            v.moveCredit = 0.5;
            v.moveClock = now;
            v.protectedUntil = 0;
            v.respawns = 0;
          }
          return {};
        }
        if (
          room.status === 'playing' &&
          p.alive &&
          body.round === room.round &&
          Number.isSafeInteger(body.seq) &&
          body.seq > p.seq
        ) {
          p.seq = body.seq;
          const movement = validateMovement(room, p, body, now, previousSeen),
            accepted = movement.accepted;
          if (room.mode !== 'hardcore')
            for (const coin of room.world.coins)
              if (!room.collectedCoins.includes(coin.id) && distance(p, coin) < 0.55) {
                room.collectedCoins.push(coin.id);
                room.coinRespawns[coin.id] = now + 10000;
                room.balance++;
              }
          for (let i = 0; i < room.world.fuses.length; i++)
            if (distance(p, room.world.fuses[i]) < 0.7) room.fuses[i] = true;
          if (
            now - room.started > (room.level === 'run' ? 6000 : 22000) &&
            now >= (p.protectedUntil || 0) &&
            (distance(p, room.enemy) < 0.43 ||
              (room.mode === 'hardcore' && distance(p, room.smile) < 0.43))
          )
            p.alive = false;
          if (p.alive && room.fuses.every(Boolean) && distance(p, room.world.exit) < 0.7)
            room.status = 'won';
          if (!room.players.some(v => v.alive && now - v.seen < ACTIVE_MS)) room.status = 'lost';
          return {
            positionAccepted: accepted,
            movementReason: movement.reason || null,
            ackMovement: movement.ackMovement,
          };
        }
        return {};
      }),
    );
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

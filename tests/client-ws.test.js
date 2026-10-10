import { SELF, env, runInDurableObject } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { createWorld } from '../packages/shared/world.js';

const migrations = import.meta.glob('../drizzle/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const ORIGIN = 'https://game.test';
async function post(path, body) {
  const response = await SELF.fetch(ORIGIN + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}
const call = (action, body) => post('/api/rooms/' + action, body);
const stubOf = code => env.ROOMS.get(env.ROOMS.idFromName(code));

// Conecta ao DO e devolve helpers: send() espera a resposta pelo reqId, next() espera um broadcast.
async function connect(code) {
  const response = await SELF.fetch(`${ORIGIN}/api/rooms/${code}/ws`, {
    headers: { Upgrade: 'websocket', Origin: ORIGIN },
  });
  expect(response.status).toBe(101);
  const ws = response.webSocket;
  ws.accept();
  const inbox = [],
    waiting = [];
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const index = waiting.findIndex(w => w.test(message));
    if (index >= 0) waiting.splice(index, 1)[0].resolve(message);
    else inbox.push(message);
  });
  const wait = test =>
    new Promise((resolve, reject) => {
      const index = inbox.findIndex(test);
      if (index >= 0) return resolve(inbox.splice(index, 1)[0]);
      const timer = globalThis.setTimeout(() => reject(new Error('timeout')), 3000);
      waiting.push({
        test,
        resolve: m => {
          globalThis.clearTimeout(timer);
          resolve(m);
        },
      });
    });
  let n = 0;
  return {
    ws,
    inbox,
    wait,
    first: () => wait(m => m.type === 'room'),
    send(action, body = {}) {
      const reqId = ++n;
      ws.send(JSON.stringify({ reqId, action, ...body }));
      return wait(m => m.reqId === reqId);
    },
  };
}

// Mensagens exatamente como apps/game/js/net.js as monta (roomPayload + action + reqId).
const payload = (p, room, extra = {}) => ({
  id: p.id,
  token: p.token,
  round: room.round,
  seq: 1,
  x: 1.5,
  y: 1.5,
  a: 0,
  respawns: 0,
  ...extra,
});

describe('cliente WebSocket (apps/game/js/net.js) contra o RoomDO real', () => {
  beforeAll(async () => {
    for (const sql of Object.values(migrations))
      for (const statement of sql.split('--> statement-breakpoint'))
        await env.DB.prepare(statement).run();
  });

  it('a sala empurrada pelo servidor cobre entrada, início, saída e erros com reqId', async () => {
    const host = (await call('create', { name: 'Rafael', campaign: true })).data,
      code = host.room.code,
      hostSocket = await connect(code);
    expect((await hostSocket.first()).room.players).toHaveLength(1);
    // Quem entra depois (REST) aparece para quem já está conectado, sem o cliente perguntar.
    const guest = (await call('join', { name: 'Ana', code })).data,
      pushedJoin = await hostSocket.wait(m => m.type === 'room' && m.room.players.length === 2);
    expect(pushedJoin.room.players.map(p => p.name)).toEqual(['Rafael', 'Ana']);
    const guestSocket = await connect(code);
    await guestSocket.first();
    // lobby → playing: broadcast antes do result, para todos.
    const started = hostSocket.send('start', payload(host, host.room)),
      pushedStart = await guestSocket.wait(m => m.type === 'room' && m.room.status === 'playing');
    const result = await started;
    expect(result.type).toBe('result');
    expect(result.room.status).toBe('playing');
    expect(pushedStart.room.round).toBe(result.room.round);
    // Reviver sem moedas: erro com reqId e status, nada muda.
    const revive = await hostSocket.send('revive', payload(host, result.room, { seq: 2 }));
    expect(revive.type).toBe('error');
    expect(revive.status).toBe(409);
    expect(typeof revive.error).toBe('string');
    // 'level' é recusado na campanha; 'admin-level' exige o painel do admin.
    const level = await hostSocket.send('level', payload(host, result.room, { level: 'pool' }));
    expect(level.status).toBe(409);
    const admin = await hostSocket.send(
      'admin-level',
      payload(host, result.room, { level: 'poolrooms' }),
    );
    expect(admin.status).toBe(403);
    // Movimento: o sync a 30 Hz é aceito e o tick de 20 Hz devolve a posição no snapshot da sala.
    const world = createWorld(result.room.seed, result.room.level),
      target = world.grid[1][2] === 0 ? { x: 1.7, y: 1.5 } : { x: 1.5, y: 1.7 },
      moved = await hostSocket.send('sync', payload(host, result.room, { seq: 3, ...target }));
    expect(moved.positionAccepted).toBe(true);
    const tick = await guestSocket.wait(
      m => m.type === 'room' && m.room.players.find(p => p.id === host.id).x === target.x,
    );
    expect(tick.room.revision).toBeGreaterThan(result.room.revision);
    // Saída: o outro lado vê a lista encolher.
    const left = guestSocket.wait(m => m.type === 'room' && m.room.players.length === 1);
    expect((await hostSocket.send('leave', payload(host, result.room, { seq: 4 }))).type).toBe(
      'result',
    );
    expect((await left).room.players[0].id).toBe(guest.id);
    hostSocket.ws.close();
    guestSocket.ws.close();
  });

  it('queda de conexão por mais de 5 s não tira o jogador da sala e a vitória avança a fase', async () => {
    const host = (await call('create', { name: 'Rafael', campaign: true })).data,
      code = host.room.code,
      auth = { id: host.id, token: host.token };
    await call('start', { code, ...auth });
    const first = await connect(code);
    await first.first();
    first.ws.close();
    // Passados 5 s sem socket, quem volta reabre a conexão com o mesmo id/token e recebe a sala inteira.
    await runInDurableObject(stubOf(code), inst => {
      for (const p of inst.room.players) p.seen -= 5000;
    });
    const second = await connect(code),
      back = (await second.first()).room;
    expect(back.players.map(p => p.id)).toEqual([host.id]);
    expect(back.status).toBe('playing');
    const accepted = await second.send('sync', payload(host, back, { seq: 1 }));
    expect(accepted.type).toBe('result');
    // Vitória na campanha: depois de 3 s o tick troca de fase e empurra round/level novos.
    await runInDurableObject(stubOf(code), inst => {
      inst.room.status = 'won';
      inst.room.finished = Date.now() - 4000;
    });
    const next = await second.wait(m => m.type === 'room' && m.room.round > back.round);
    expect(next.room.level).not.toBe(back.level);
    expect(next.room.status).toBe('playing');
    second.ws.close();
  });
});

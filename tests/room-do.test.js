import { SELF, env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { createWorld } from '../public/world.js';

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
      const timer = setTimeout(() => reject(new Error('timeout')), 3000);
      waiting.push({
        test,
        resolve: m => {
          clearTimeout(timer);
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
async function newGame() {
  const host = (await call('create', { name: 'Rafael' })).data,
    guest = (await call('join', { name: 'Ana', code: host.room.code })).data;
  return { host, guest, code: host.room.code, auth: p => ({ id: p.id, token: p.token }) };
}
const step = room => {
  const world = createWorld(room.seed, room.level);
  return world.grid[1][2] === 0 ? { x: 1.7, y: 1.5 } : { x: 1.5, y: 1.7 };
};

describe('RoomDO', () => {
  beforeAll(async () => {
    for (const sql of Object.values(migrations))
      for (const statement of sql.split('--> statement-breakpoint'))
        await env.DB.prepare(statement).run();
  });

  it('create/join/start continuam REST e o estado fica no Durable Object', async () => {
    const { host, guest, code, auth } = await newGame();
    expect(guest.room.players).toHaveLength(2);
    expect((await call('start', { code, ...auth(guest) })).status).toBe(403);
    expect((await call('start', { code, ...auth(host) })).data.room.status).toBe('playing');
    expect((await call('join', { name: 'Fantasma', code: 'AAAAAA' })).status).toBe(404);
    const stored = await runInDurableObject(stubOf(code), (_, state) => state.storage.get('room'));
    expect(stored.status).toBe('playing');
    // Nada de salas no D1: apenas ranking/perfis/mapas continuam lá.
    const rows = await env.DB.prepare('SELECT count(*) AS n FROM rooms').first();
    expect(rows.n).toBe(0);
  });

  it('WebSocket valida movimento no servidor e transmite o estado', async () => {
    const { host, guest, code, auth } = await newGame();
    await call('start', { code, ...auth(host) });
    const client = await connect(code);
    const hello = await client.first();
    expect(hello.room.status).toBe('playing');
    const target = step(hello.room);
    let r = await client.send('sync', {
      ...auth(host),
      round: 1,
      seq: 1,
      a: 0,
      ...target,
    });
    expect(r.positionAccepted).toBe(true);
    r = await client.send('sync', { ...auth(host), round: 1, seq: 2, a: 0, x: 19.5, y: 19.5 });
    expect(r.positionAccepted).toBe(false);
    r = await client.send('sync', { ...auth(guest), id: 'x', token: 'y' });
    expect(r.type).toBe('error');
    expect(r.status).toBe(401);
    const bad = await client.send('create', {});
    expect(bad.status).toBe(404);
    // O tick de 20 Hz transmite o estado sem nenhuma requisição do cliente.
    const a = await client.wait(m => m.type === 'room'),
      b = await client.wait(m => m.type === 'room');
    expect(b.room.revision).toBeGreaterThan(a.room.revision);
    client.ws.close();
  });

  it('sem jogadores conectados o DO para de fazer tick', async () => {
    const { host, code, auth } = await newGame();
    await call('start', { code, ...auth(host) });
    const stub = stubOf(code);
    const client = await connect(code);
    await client.first();
    expect(await runInDurableObject(stub, inst => inst.timer !== null)).toBe(true);
    client.ws.close();
    await new Promise(r => setTimeout(r, 200));
    expect(await runInDurableObject(stub, inst => inst.timer)).toBe(null);
    const revision = await runInDurableObject(stub, inst => inst.room.revision);
    await new Promise(r => setTimeout(r, 300));
    expect(await runInDurableObject(stub, inst => inst.room.revision)).toBe(revision);
  });

  it('a sala sobrevive à reconexão e persiste a cada 5 s via alarme', async () => {
    const { host, code, auth } = await newGame();
    await call('start', { code, ...auth(host) });
    const first = await connect(code);
    const room = (await first.first()).room;
    const target = step(room);
    await first.send('sync', { ...auth(host), round: 1, seq: 1, a: 0, ...target });
    // Movimento fica só em memória até o alarme de 5 s.
    const stub = stubOf(code);
    let stored = await runInDurableObject(stub, (_, state) => state.storage.get('room'));
    expect(stored.players[0].x).toBe(1.5);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    stored = await runInDurableObject(stub, (_, state) => state.storage.get('room'));
    expect(stored.players[0].x).toBe(target.x);
    first.ws.close();
    const second = await connect(code);
    const back = (await second.first()).room;
    expect(back.players.find(p => p.id === host.id)).toMatchObject(target);
    expect(back.status).toBe('playing');
    second.ws.close();
  });
});

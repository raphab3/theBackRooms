import { SELF, env, runInDurableObject } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { LOBBY_CAPACITY } from '@backrooms/shared/lobby.js';

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
const lobby = (action, body) => post('/api/lobby/' + action, body);

// Abre o WebSocket do lobby e devolve wait(teste) para esperar uma mensagem específica.
async function connect(key, name) {
  const response = await SELF.fetch(
    `${ORIGIN}/api/lobby/${key}/ws?name=${encodeURIComponent(name)}`,
    { headers: { Upgrade: 'websocket', Origin: ORIGIN } },
  );
  if (response.status !== 101) return { status: response.status };
  const ws = response.webSocket;
  ws.accept();
  const inbox = [],
    waiting = [];
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data),
      index = waiting.findIndex(w => w.test(message));
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
  const welcome = await wait(m => m.t === 'welcome');
  return { status: 101, ws, wait, id: welcome.id, send: m => ws.send(JSON.stringify(m)) };
}

describe('LobbyDO', () => {
  beforeAll(async () => {
    for (const sql of Object.values(migrations))
      for (const statement of sql.split('--> statement-breakpoint'))
        await env.DB.prepare(statement).run();
  });

  it('lobby público: o 25º jogador cai num segundo grupo', async () => {
    const keys = [];
    for (let i = 0; i <= LOBBY_CAPACITY; i++)
      keys.push((await lobby('public', { name: 'P' + i })).data.key);
    expect(new Set(keys.slice(0, LOBBY_CAPACITY))).toEqual(new Set(['pub-1']));
    expect(keys.at(-1)).toBe('pub-2');
  });

  it('lobby privado só aceita quem tem o código', async () => {
    const { data } = await lobby('private', { name: 'Rafa' });
    expect(data.code).toMatch(/^[A-Z2-9]{6}$/);
    expect((await lobby('join', { name: 'Ana', code: data.code })).data.key).toBe(data.key);
    expect((await lobby('join', { name: 'Ana', code: 'ZZZZZZ' })).status).toBe(404);
    expect((await connect('priv-ZZZZZZ', 'Ana')).status).toBe(404);
  });

  it('presença, movimento e chat chegam para todos', async () => {
    const { data } = await lobby('private', { name: 'Rafa' }),
      a = await connect(data.key, 'Rafa'),
      b = await connect(data.key, 'Ana');
    const snap = await b.wait(m => m.t === 'snap' && m.players.length === 2);
    expect(snap.players.map(p => p.name).sort()).toEqual(['Ana', 'Rafa']);
    expect(snap.portals).toHaveLength(3);
    const start = snap.players.find(p => p.id === a.id);
    a.send({ t: 'move', x: start.x + 0.3, z: start.z, yaw: 1, anim: 'walk' });
    await b.wait(m => m.t === 'snap' && m.players.some(p => p.id === a.id && p.anim === 'walk'));
    // Teleporte é recusado com uma correção para a última posição aceita.
    a.send({ t: 'move', x: start.x + 30, z: start.z, yaw: 1, anim: 'run' });
    expect((await a.wait(m => m.t === 'correct')).x).toBeCloseTo(start.x + 0.3, 1);
    // Cada gesto é numerado: apertar o mesmo de novo faz o boneco repetir.
    a.send({ t: 'emote', e: 'wave' });
    const first = await b.wait(
      m => m.t === 'snap' && m.players.some(p => p.id === a.id && p.emote === 'wave'),
    );
    a.send({ t: 'emote', e: 'wave' });
    const n1 = first.players.find(p => p.id === a.id).emoteN;
    await b.wait(m => m.t === 'snap' && m.players.some(p => p.id === a.id && p.emoteN === n1 + 1));
    a.send({ t: 'chat', text: 'oi' });
    expect((await b.wait(m => m.t === 'chat')).text).toBe('oi');
  });

  it('convite forma grupo e o portal leva o grupo para a mesma partida', async () => {
    const { data } = await lobby('private', { name: 'Rafa' }),
      a = await connect(data.key, 'Rafa'),
      b = await connect(data.key, 'Ana');
    a.send({ t: 'invite', to: b.id });
    expect((await b.wait(m => m.t === 'invited')).name).toBe('Rafa');
    b.send({ t: 'accept' });
    await a.wait(m => m.t === 'snap' && m.players.every(p => p.party) && m.players.length === 2);
    // O portal dispara: cada um recebe a credencial da mesma sala, já em jogo.
    const stub = env.LOBBIES.get(env.LOBBIES.idFromName(data.key));
    await runInDurableObject(stub, instance => {
      const group = [a.id, b.id].map(id => instance.players.get(id));
      for (const p of group) instance.removePlayer(p.id);
      return instance.travel('backrooms', group);
    });
    const [ta, tb] = await Promise.all([a, b].map(c => c.wait(m => m.t === 'travel')));
    expect(ta.code).toBe(tb.code);
    const resumed = await post('/api/rooms/resume', { code: tb.code, id: tb.id, token: tb.token });
    expect(resumed.status).toBe(200);
    expect(resumed.data.room.status).toBe('playing');
    expect(resumed.data.room.players.map(p => p.name).sort()).toEqual(['Ana', 'Rafa']);
  });

  it('vitória credita o estoque uma vez só e entra no histórico do Posto Zero', async () => {
    const key = 'ab'.repeat(32),
      { data } = await lobby('private', { name: 'Rafa' }),
      a = await connect(data.key, 'Rafa');
    a.send({ t: 'auth', key });
    await a.wait(m => m.t === 'snap');
    const stub = env.LOBBIES.get(env.LOBBIES.idFromName(data.key));
    // Espera o hash da chave chegar ao jogador antes de atravessar o portal.
    await runInDurableObject(stub, async instance => {
      for (let i = 0; i < 20 && !instance.players.get(a.id).keyHash; i++)
        await new Promise(r => setTimeout(r, 25));
      const group = [instance.players.get(a.id)];
      instance.removePlayer(a.id);
      await instance.travel('backrooms', group);
    });
    const ticket = await a.wait(m => m.t === 'travel');
    // A equipe vence com sucata na mochila.
    const room = env.ROOMS.get(env.ROOMS.idFromName(ticket.code));
    await runInDurableObject(room, async instance => {
      const r = instance.room,
        p = r.players[0];
      p.bag.push({ item: 'scrap', qty: 6 });
      r.fuses = r.fuses.map(() => true);
      r.status = 'won';
      instance.run('sync', { id: p.id, token: p.token });
      await instance.saving;
      // Salvar de novo não credita duas vezes.
      r.expeditionSaved = false;
      instance.saveResult();
      await instance.saving;
    });
    const inv = await post('/api/inventory/get', { key, name: 'Rafa' });
    expect(inv.data.items).toEqual({ scrap: 6, almond: 2 });
    // O Posto Zero do time guardou a expedição.
    const again = await connect(data.key, 'Rafa');
    expect(again.status).toBe(101);
    const info = await runInDurableObject(stub, instance => instance.meta);
    expect(info.owner).toBe('Rafa');
    expect(info.base).toEqual({ expeditions: 1, wins: 1, loot: { scrap: 6, almond: 2 } });
  });

  it('chave inválida não abre estoque', async () => {
    expect((await post('/api/inventory/get', { key: 'curta', name: 'Rafa' })).status).toBe(401);
  });
});

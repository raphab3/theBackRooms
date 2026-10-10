import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { damageMultiplier, upgradeCost } from '@backrooms/shared/arms.js';
import { createWorld } from '@backrooms/shared/world.js';
import { hashKey } from '../worker/inventory.js';
import { newPlayer } from '../worker/players.js';
import { stepRoom } from '../worker/room-actions.js';
import { beginPhase } from '../worker/rooms.js';

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
const shop = (action, body) => post('/api/workshop/' + action, body);
async function stock(key, items) {
  const hash = await hashKey(key);
  for (const [item, qty] of Object.entries(items))
    await env.DB.prepare(
      'INSERT INTO inventories(key_hash,item,qty) VALUES(?,?,?) ON CONFLICT(key_hash,item) DO UPDATE SET qty=excluded.qty',
    )
      .bind(hash, item, qty)
      .run();
}

describe('regras do braço', () => {
  it('custo e dano por nível', () => {
    expect(upgradeCost(1)).toEqual({ scrap: 20, core_fire: 1 });
    expect(upgradeCost(5)).toEqual({ scrap: 100, core_fire: 5 });
    expect(damageMultiplier(1)).toBe(1);
    expect(damageMultiplier(6)).toBeCloseTo(1.4);
  });
});

describe('bancada', () => {
  beforeAll(async () => {
    for (const sql of Object.values(migrations))
      for (const statement of sql.split('--> statement-breakpoint'))
        await env.DB.prepare(statement).run();
  });

  it('todo mundo começa com o Braço de Fogo nível 1', async () => {
    const { data } = await shop('get', { key: '01'.repeat(32) });
    expect(data.arms.fire).toBe(1);
  });

  it('evolui gastando sucata e núcleo; sem recursos recusa sem mexer em nada', async () => {
    const key = '02'.repeat(32);
    await stock(key, { scrap: 25, core_fire: 1 });
    const up = await shop('upgrade', { key, element: 'fire' });
    expect(up.status).toBe(200);
    expect(up.data.arms.fire).toBe(2);
    expect(up.data.items).toEqual({ scrap: 5 });
    const poor = await shop('upgrade', { key, element: 'fire' });
    expect(poor.status).toBe(409);
    expect(poor.data.error).toContain('Faltam recursos');
    expect((await shop('get', { key })).data).toEqual({ arms: { fire: 2 }, items: { scrap: 5 } });
  });

  it('dois cliques ao mesmo tempo com recursos para um só cobram uma vez', async () => {
    const key = '03'.repeat(32);
    await stock(key, { scrap: 20, core_fire: 1 });
    const results = await Promise.all([
      shop('upgrade', { key, element: 'fire' }),
      shop('upgrade', { key, element: 'fire' }),
    ]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    expect((await shop('get', { key })).data).toEqual({ arms: { fire: 2 }, items: {} });
  });

  it('outros elementos chegam na Fase 3', async () => {
    const r = await shop('upgrade', { key: '04'.repeat(32), element: 'ice' });
    expect(r.status).toBe(409);
  });
});

describe('braço evoluído na expedição', () => {
  it('o dano do tiro sobe com o nível do braço', () => {
    const world = createWorld(5, 'backrooms'),
      now = 5_000_000,
      p = { ...newPlayer('Rafa', now), armLevel: 6 },
      room = {
        code: 'ARMS01',
        seed: 5,
        level: 'backrooms',
        mode: 'normal',
        campaign: false,
        world,
        coinRespawns: {},
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
    beginPhase(room, now);
    // Entidade colada no jogador: qualquer direção acerta.
    Object.assign(room.enemy, { x: p.x + 0.2, y: p.y });
    stepRoom(room, 'shoot', { id: p.id, token: p.token, a: 0 }, now);
    expect(room.enemy.hp).toBeCloseTo(100 - 10 * 1.4);
  });
});

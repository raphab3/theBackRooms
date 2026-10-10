import { describe, expect, it } from 'vitest';
import {
  BAG_SLOTS,
  SALVAGE_MS,
  START_ALMOND,
  addItems,
  countItem,
  createLoot,
  removeItems,
} from '@backrooms/shared/loot.js';
import { createWorld } from '@backrooms/shared/world.js';
import { newPlayer } from '../worker/players.js';
import { stepRoom } from '../worker/room-actions.js';
import { beginPhase } from '../worker/rooms.js';

describe('mochila', () => {
  it('empilha até o limite e respeita os 12 espaços', () => {
    const bag = [];
    expect(addItems(bag, 'scrap', 25)).toBe(25);
    expect(bag).toEqual([
      { item: 'scrap', qty: 20 },
      { item: 'scrap', qty: 5 },
    ]);
    expect(addItems(bag, 'scrap', 1000)).toBe(20 * BAG_SLOTS - 25);
    expect(bag).toHaveLength(BAG_SLOTS);
    expect(addItems(bag, 'almond', 1)).toBe(0);
  });
  it('tira só se tiver tudo', () => {
    const bag = [{ item: 'almond', qty: 2 }];
    expect(removeItems(bag, 'almond', 3)).toBe(false);
    expect(removeItems(bag, 'almond', 2)).toBe(true);
    expect(bag).toEqual([]);
  });
});

describe('createLoot', () => {
  it('é igual para a mesma semente e não cai em fusível, saída, moeda ou no início', () => {
    const world = createWorld(77, 'backrooms'),
      loot = createLoot(world, 77);
    expect(createLoot(world, 77)).toEqual(loot);
    const busy = [world.exit, ...world.fuses, ...world.coins];
    for (const item of [...loot.piles, ...loot.almonds]) {
      expect(world.grid[Math.floor(item.y)][Math.floor(item.x)]).toBe(0);
      expect(busy.some(b => b.x === item.x && b.y === item.y)).toBe(false);
      expect(Math.hypot(item.x - 1.5, item.y - 1.5)).toBeGreaterThan(3);
    }
    expect(loot.piles).toHaveLength(8);
    expect(loot.almonds).toHaveLength(3);
  });
});

// Sala do portal com dois jogadores já em jogo.
function room2() {
  const world = createWorld(55, 'backrooms'),
    now = 2_000_000,
    a = newPlayer('Rafa', now),
    b = newPlayer('Ana', now, [a]),
    room = {
      code: 'LOOT01',
      seed: 55,
      level: 'backrooms',
      mode: 'normal',
      campaign: false,
      world,
      coinRespawns: {},
      players: [a, b],
      host: a.id,
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
  return { room, a, b, now };
}
const auth = p => ({ id: p.id, token: p.token });
// Um "sync" parado no lugar onde o jogador já está (o servidor confere o movimento).
const stay = (room, p, t) =>
  stepRoom(
    room,
    'sync',
    { ...auth(p), round: room.round, seq: (p.seq || 0) + 1, x: p.x, y: p.y, a: 0 },
    t,
  );

describe('recursos na expedição', () => {
  it('todo mundo começa com Amêndoa e o tiro carregado gasta uma', () => {
    const { room, a, now } = room2();
    expect(countItem(a.bag, 'almond')).toBe(START_ALMOND);
    stepRoom(room, 'shoot', { ...auth(a), a: 0, kind: 'charged' }, now);
    expect(countItem(a.bag, 'almond')).toBe(START_ALMOND - 1);
    a.bag = [];
    expect(() =>
      stepRoom(room, 'shoot', { ...auth(a), a: 0, kind: 'charged' }, now + 5000),
    ).toThrow('Sem Amêndoa');
  });

  it('desmontar sucata exige ficar perto por 2 s', () => {
    const { room, a, now } = room2(),
      pile = room.loot.piles[0];
    expect(() => stepRoom(room, 'salvageStart', { ...auth(a), pile: pile.id }, now)).toThrow(
      'perto',
    );
    Object.assign(a, { x: pile.x, y: pile.y });
    stepRoom(room, 'salvageStart', { ...auth(a), pile: pile.id }, now);
    expect(() => stepRoom(room, 'salvage', { ...auth(a), pile: pile.id }, now + 500)).toThrow(
      'Segure',
    );
    stepRoom(room, 'salvageStart', { ...auth(a), pile: pile.id }, now + 1000);
    const { got } = stepRoom(
      room,
      'salvage',
      { ...auth(a), pile: pile.id },
      now + 1000 + SALVAGE_MS,
    );
    expect(got).toBeGreaterThanOrEqual(2);
    expect(countItem(a.bag, 'scrap')).toBe(got);
    expect(room.loot.piles[0].salvaged).toBe(true);
  });

  it('Amêndoa é pega passando por cima', () => {
    const { room, a, now } = room2(),
      bottle = room.loot.almonds[0];
    Object.assign(a, { x: bottle.x, y: bottle.y });
    stay(room, a, now + 100);
    expect(countItem(a.bag, 'almond')).toBe(START_ALMOND + 1);
    expect(room.loot.almonds[0].taken).toBe(true);
  });

  it('mochila de quem foi pego é resgatada e volta ao dono na extração', () => {
    const { room, a, b, now } = room2();
    addItems(a.bag, 'scrap', 7);
    // Rafa é pego onde está; a mochila fica no chão (Ana, no mesmo ponto, está protegida).
    room.started = now - 60000;
    b.protectedUntil = now + 99999;
    Object.assign(room.enemy, { x: a.x, y: a.y, dead: false });
    stay(room, a, now + 100);
    expect(a.alive).toBe(false);
    expect(room.loot.bags).toHaveLength(1);
    // Ana passa por cima e carrega a mochila.
    Object.assign(room.enemy, { x: 10.5, y: 10.5 });
    Object.assign(b, { x: room.loot.bags[0].x, y: room.loot.bags[0].y });
    stay(room, b, now + 200);
    expect(b.carrying).toHaveLength(1);
    // A equipe vence: o que Ana carregava volta para Rafa.
    room.fuses = room.fuses.map(() => true);
    Object.assign(b, { x: room.world.exit.x, y: room.world.exit.y });
    stay(room, b, now + 300);
    expect(room.status).toBe('won');
    expect(room.extracted[a.id]).toEqual({ almond: START_ALMOND, scrap: 7 });
    expect(room.extracted[b.id]).toEqual({ almond: START_ALMOND });
  });

  it('na derrota ninguém extrai nada', () => {
    const { room, a, b, now } = room2();
    addItems(a.bag, 'scrap', 3);
    room.started = now - 60000;
    for (const p of [a, b]) {
      Object.assign(room.enemy, { x: p.x, y: p.y, dead: false });
      stay(room, p, now + 100);
    }
    expect(room.status).toBe('lost');
    expect(room.extracted).toEqual({});
  });

  it('o "start" do jogo clássico também prepara recursos e mochilas', () => {
    const world = createWorld(9, 'backrooms'),
      now = 3_000_000,
      a = newPlayer('Rafa', now),
      room = {
        code: 'CLASS1',
        seed: 9,
        level: 'backrooms',
        mode: 'normal',
        campaign: false,
        world,
        coinRespawns: {},
        players: [a],
        host: a.id,
        status: 'lobby',
        round: 0,
        started: 0,
        lastTick: now,
        balance: 0,
        collectedCoins: [],
        fuses: world.fuses.map(() => false),
        enemy: { ...world.enemy },
      };
    stepRoom(room, 'start', auth(a), now);
    expect(room.status).toBe('playing');
    expect(countItem(a.bag, 'almond')).toBe(START_ALMOND);
    expect(room.loot.piles.length).toBeGreaterThan(0);
  });
});

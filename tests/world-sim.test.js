import { describe, expect, it } from 'vitest';
import {
  CAMP_SPAWN,
  DAY_MS,
  ENTER_GRACE_MS,
  GENERATOR_CENTER,
  GENERATOR_OFF_FAIL_MS,
  LEAVE_MS,
  NIGHT_MS,
  PORTAL,
  RESPAWN_MS,
  SCRAP_FUEL,
  waveSize,
} from '@backrooms/shared/camp.js';
import { countItem } from '@backrooms/shared/loot.js';
import { newPlayer } from '../worker/players.js';
import { createExpedition, stepWorld, tickWorld, viewFor } from '../worker/world-sim.js';

const T0 = 10_000_000;
function setup() {
  const a = newPlayer('Rafa', T0),
    b = newPlayer('Ana', T0, [a]),
    state = createExpedition({ code: 'MUNDO1', seed: 4242, players: [a, b], now: T0 });
  return { state, a: state.players[0], b: state.players[1] };
}
const auth = p => ({ id: p.id, token: p.token });
const at = (p, point) => Object.assign(p, { x: point.x, y: point.y });

describe('mundo aberto', () => {
  it('todos começam no acampamento, perto do gerador, com 2 Amêndoas', () => {
    const { state, a } = setup();
    expect(a.zone).toBe('camp');
    expect(Math.hypot(a.x - CAMP_SPAWN.x, a.y - CAMP_SPAWN.y)).toBeLessThan(1);
    expect(countItem(a.bag, 'almond')).toBe(2);
    expect(Object.keys(state.zones)).toEqual(['b0', 'b1']);
  });

  it('entra pela porta, sai pela entrada e volta para a frente da porta', () => {
    const { state, a } = setup(),
      door = state.camp.buildings[0].doorAt;
    expect(() => stepWorld(state, 'use', auth(a), T0)).toThrow('perto');
    at(a, door);
    expect(stepWorld(state, 'use', auth(a), T0 + 100).zone).toBe('b0');
    expect([a.zone, a.x, a.y]).toEqual(['b0', 1.5, 1.5]);
    // Quem ficou no acampamento não vê quem entrou.
    expect(viewFor(state, state.players[1].id, T0).players).toEqual([]);
    expect(stepWorld(state, 'use', auth(a), T0 + 200).zone).toBe('camp');
    expect([a.x, a.y]).toEqual([door.x, door.y]);
  });

  it('a entidade espera um pouco, depois caça; quem é pego deixa a mochila e volta ao acampamento', () => {
    const { state, a } = setup();
    at(a, state.camp.buildings[0].doorAt);
    stepWorld(state, 'use', auth(a), T0);
    const zone = state.zones.b0,
      start = { x: zone.enemy.x, y: zone.enemy.y };
    tickWorld(state, T0 + 1000);
    expect({ x: zone.enemy.x, y: zone.enemy.y }).toEqual(start);
    // Depois do tempo de graça, a entidade encosta e pega.
    Object.assign(zone.enemy, { x: a.x, y: a.y });
    tickWorld(state, T0 + ENTER_GRACE_MS + 100);
    expect(a.alive).toBe(false);
    expect(zone.loot.bags).toHaveLength(1);
    expect(() =>
      stepWorld(state, 'sync', { ...auth(a), seq: 1, x: a.x, y: a.y, a: 0 }, T0 + 9000),
    ).toThrow('pego');
    tickWorld(state, T0 + ENTER_GRACE_MS + 100 + RESPAWN_MS);
    expect([a.alive, a.zone, a.bag]).toEqual([true, 'camp', []]);
  });

  it('o tiro acerta a entidade dentro da edificação e no acampamento não há alvo', () => {
    const { state, a } = setup();
    expect(stepWorld(state, 'shoot', { ...auth(a), a: 0 }, T0).hit).toBe(false);
    at(a, state.camp.buildings[0].doorAt);
    stepWorld(state, 'use', auth(a), T0 + 300);
    Object.assign(state.zones.b0.enemy, { x: a.x + 0.2, y: a.y });
    expect(stepWorld(state, 'shoot', { ...auth(a), a: 0 }, T0 + 600).hit).toBe(true);
    expect(state.zones.b0.enemy.hp).toBe(90);
  });

  it('sair pelo portal exige segurar E e leva a mochila; com todos fora, a expedição termina', () => {
    const { state, a, b } = setup();
    at(a, PORTAL);
    stepWorld(state, 'use', auth(a), T0);
    expect(() => stepWorld(state, 'leave', auth(a), T0 + 500)).toThrow('Segure');
    const { extracted } = stepWorld(state, 'leave', auth(a), T0 + LEAVE_MS);
    expect(extracted[a.id]).toEqual({ almond: 2 });
    expect(a.left).toBe(true);
    expect(state.status).toBe('playing');
    at(b, PORTAL);
    stepWorld(state, 'use', auth(b), T0 + 100);
    stepWorld(state, 'leave', auth(b), T0 + 100 + LEAVE_MS);
    expect(state.status).toBe('ended');
  });

  it('o movimento respeita a grade da zona (postes e paredes bloqueiam)', () => {
    const { state, a } = setup(),
      pylon = state.camp.pylons[0];
    // Um passo pequeno no chão aberto é aceito; atravessar um poste não.
    const ok = stepWorld(
      state,
      'sync',
      { ...auth(a), seq: 1, x: a.x, y: a.y - 0.3, a: 0 },
      T0 + 500,
    );
    expect(ok.positionAccepted).toBe(true);
    at(a, { x: pylon.x - 0.6, y: pylon.y + 0.5 });
    const blocked = stepWorld(
      state,
      'sync',
      { ...auth(a), seq: 2, x: pylon.x + 1.5, y: pylon.y + 0.5, a: 0 },
      T0 + 5000,
    );
    expect(blocked.positionAccepted).toBe(false);
  });

  describe('noites, gerador e monstros', () => {
    it('ao anoitecer chega a onda da noite 1; ao amanhecer os monstros fogem', () => {
      const { state } = setup();
      tickWorld(state, T0 + DAY_MS);
      expect(state.clock).toMatchObject({ phase: 'night', night: 1 });
      const wave = waveSize(1);
      expect(state.spawnQueue).toHaveLength(wave.scrap + wave.apparition);
      tickWorld(state, T0 + DAY_MS + 61000);
      expect(state.monsters.length).toBe(wave.scrap + wave.apparition);
      tickWorld(state, T0 + DAY_MS + NIGHT_MS);
      expect([state.clock.phase, state.monsters.length]).toEqual(['day', 0]);
    });

    it('o gerador gasta combustível e cada sucata abastece e conserta', () => {
      const { state, a } = setup();
      // O tique limita cada passo a 0,75 s: avança em passos de meio segundo.
      for (let t = 500; t <= 10000; t += 500) tickWorld(state, T0 + t);
      expect(state.generator.fuel).toBeCloseTo(100 - 0.2 * 10, 1);
      state.generator.fuel = 50;
      state.generator.hp = 80;
      at(a, { x: GENERATOR_CENTER.x, y: GENERATOR_CENTER.y + 1.6 }); // encostado no gerador
      expect(() => stepWorld(state, 'refuel', auth(a), T0 + 10100)).toThrow('sucata');
      a.bag.push({ item: 'scrap', qty: 3 });
      stepWorld(state, 'refuel', auth(a), T0 + 10200);
      // (o tique entre as ações ainda gasta um pouquinho de combustível)
      expect(state.generator.fuel).toBeCloseTo(50 + SCRAP_FUEL, 0);
      expect(state.generator.hp).toBe(85);
      at(a, { x: 5.5, y: 5.5 });
      expect(() => stepWorld(state, 'refuel', auth(a), T0 + 10300)).toThrow('gerador');
    });

    it('monstro de sucata colado no gerador tira vida dele', () => {
      const { state } = setup();
      state.monsters.push({
        id: 'm',
        type: 'scrap',
        x: GENERATOR_CENTER.x + 1.2,
        y: GENERATOR_CENTER.y,
        hp: 30,
        path: [],
        pathAt: T0,
      });
      tickWorld(state, T0 + 500);
      expect(state.generator.hp).toBeCloseTo(100 - 6 * 0.5, 1);
    });

    it('aparição pega quem está fora da luz, mas não quem está dentro', () => {
      const { state, a, b } = setup();
      at(a, { x: 6.5, y: 40.5 }); // longe do gerador
      at(b, { x: GENERATOR_CENTER.x, y: GENERATOR_CENTER.y + 2 }); // dentro da área segura
      state.monsters.push(
        { id: 'x', type: 'apparition', x: 6.5, y: 40.5, hp: 15, path: [], pathAt: T0 },
        { id: 'y', type: 'apparition', x: b.x, y: b.y, hp: 15, path: [], pathAt: T0 },
      );
      tickWorld(state, T0 + 100);
      expect(a.alive).toBe(false);
      expect(b.alive).toBe(true);
    });

    it('o tiro mata o monstro de sucata, que solta sucata no chão', () => {
      const { state, a } = setup();
      a.armLevel = 1;
      state.monsters.push({
        id: 'm',
        type: 'scrap',
        x: a.x + 1,
        y: a.y,
        hp: 10,
        path: [],
        pathAt: T0,
      });
      expect(stepWorld(state, 'shoot', { ...auth(a), a: 0 }, T0).hit).toBe(true);
      expect(state.monsters).toHaveLength(0);
      expect(state.campLoot.drops).toMatchObject([{ item: 'scrap', qty: 2 }]);
    });

    it('gerador apagado por 45 s: a expedição fracassa e ninguém leva nada', () => {
      const { state, a } = setup();
      a.bag.push({ item: 'scrap', qty: 5 });
      state.generator.fuel = 0;
      tickWorld(state, T0 + 1000);
      expect(state.status).toBe('playing');
      tickWorld(state, T0 + 1000 + GENERATOR_OFF_FAIL_MS);
      expect(state.status).toBe('failed');
      expect(state.players.every(p => p.left && !p.bag.length)).toBe(true);
    });
  });
});

import { describe, expect, it } from 'vitest';
import {
  CAMP_SPAWN,
  ENTER_GRACE_MS,
  LEAVE_MS,
  PORTAL,
  RESPAWN_MS,
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
});

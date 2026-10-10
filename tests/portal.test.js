import { describe, expect, it } from 'vitest';
import {
  PORTAL_COUNTDOWN_MS,
  PORTAL_FULL_MS,
  newPortals,
  stepPortals,
} from '@backrooms/shared/lobby.js';

// Jogadores em cima do portal p1 (x -8, z -10) ou longe dele.
const on = { x: -8, z: -10 },
  away = { x: 0, z: 9 };
const players = entries => new Map(entries.map(([id, at]) => [id, { ...at }]));

describe('portal de 4 lugares', () => {
  it('3 jogadores entram, a contagem zera e os 3 viajam juntos', () => {
    const portals = newPortals(),
      ps = players([
        ['a', on],
        ['b', on],
        ['c', on],
      ]);
    expect(stepPortals(portals, ps, new Map(), 0).fired).toEqual([]);
    expect(portals[0].slots.filter(Boolean)).toEqual(['a', 'b', 'c']);
    expect(portals[0].endsAt).toBe(PORTAL_COUNTDOWN_MS);
    expect(stepPortals(portals, ps, new Map(), PORTAL_COUNTDOWN_MS - 1).fired).toEqual([]);
    const { fired } = stepPortals(portals, ps, new Map(), PORTAL_COUNTDOWN_MS);
    expect(fired).toEqual([{ portal: 'p1', level: 'backrooms', ids: ['a', 'b', 'c'] }]);
    expect(portals[0].slots.every(s => s === null)).toBe(true);
  });

  it('o 4º jogador lota o portal e ele dispara em 3 s', () => {
    const portals = newPortals(),
      ps = players([
        ['a', on],
        ['b', on],
        ['c', on],
      ]);
    stepPortals(portals, ps, new Map(), 0);
    ps.set('d', { ...on });
    stepPortals(portals, ps, new Map(), 1000);
    expect(portals[0].endsAt).toBe(1000 + PORTAL_FULL_MS);
    expect(stepPortals(portals, ps, new Map(), 1000 + PORTAL_FULL_MS).fired[0].ids).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('sair da plataforma libera a vaga e portal vazio cancela a contagem', () => {
    const portals = newPortals(),
      ps = players([['a', on]]);
    stepPortals(portals, ps, new Map(), 0);
    ps.set('a', { ...away });
    stepPortals(portals, ps, new Map(), 500);
    expect(portals[0].slots.every(s => s === null)).toBe(true);
    expect(portals[0].endsAt).toBe(0);
  });

  it('um grupo de 3 não entra num portal com 2 vagas e o líder é avisado', () => {
    const portals = newPortals(),
      ps = players([
        ['x', on],
        ['y', on],
        ['lider', on],
        ['m1', away],
        ['m2', away],
      ]),
      parties = new Map([['g', { leader: 'lider', members: ['lider', 'm1', 'm2'] }]]);
    const { notices } = stepPortals(portals, ps, parties, 0);
    expect(portals[0].slots.filter(Boolean)).toEqual(['x', 'y']);
    expect(notices).toEqual([{ id: 'lider', text: expect.stringContaining('Sem espaço') }]);
  });

  it('o líder leva o grupo inteiro, mesmo com os membros fora da plataforma', () => {
    const portals = newPortals(),
      ps = players([
        ['lider', on],
        ['m1', away],
      ]),
      parties = new Map([['g', { leader: 'lider', members: ['lider', 'm1'] }]]);
    stepPortals(portals, ps, parties, 0);
    expect(portals[0].slots.filter(Boolean)).toEqual(['lider', 'm1']);
    ps.set('lider', { ...away });
    stepPortals(portals, ps, parties, 100);
    expect(portals[0].slots.every(s => s === null)).toBe(true);
  });

  it('dois portais disparando juntos formam expedições separadas', () => {
    const portals = newPortals(),
      ps = players([
        ['a', on],
        ['b', { x: 8, z: -10 }],
      ]);
    stepPortals(portals, ps, new Map(), 0);
    const { fired } = stepPortals(portals, ps, new Map(), PORTAL_COUNTDOWN_MS);
    expect(fired.map(f => [f.portal, f.ids])).toEqual([
      ['p1', ['a']],
      ['p3', ['b']],
    ]);
  });
});

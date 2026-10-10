import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { nightsSurvived, saveRun } from '../worker/ranking.js';

const migrations = import.meta.glob('../drizzle/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const ORIGIN = 'https://game.test';
const run = (code, nights, status, minutes) => ({
  code,
  status,
  startedAt: 0,
  clock: { phase: 'day', night: nights },
  players: [{ name: `Equipe ${code}`, color: '#fff' }],
  minutes,
});

describe('ranking por noites', () => {
  beforeAll(async () => {
    for (const sql of Object.values(migrations))
      for (const statement of sql.split('--> statement-breakpoint'))
        await env.DB.prepare(statement).run();
  });

  it('a noite em curso não conta', () => {
    expect(nightsSurvived({ phase: 'night', night: 3 })).toBe(2);
    expect(nightsSurvived({ phase: 'day', night: 3 })).toBe(3);
    expect(nightsSurvived({ phase: 'day', night: 0 })).toBe(0);
  });

  it('vitória primeiro, depois mais noites, depois a mais rápida; salvar de novo não duplica', async () => {
    for (const r of [
      run('AAAAAA', 3, 'ended', 20),
      run('BBBBBB', 7, 'won', 40),
      run('CCCCCC', 8, 'failed', 50),
      run('DDDDDD', 7, 'won', 30),
    ])
      await saveRun(env.DB, r, r.minutes * 60_000);
    await saveRun(env.DB, run('AAAAAA', 9, 'won', 1), 60_000);
    const response = await SELF.fetch(ORIGIN + '/api/ranking/nights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
        body: '{}',
      }),
      { runs } = await response.json();
    expect(runs.map(r => [r.team[0].name, r.won, r.nights])).toEqual([
      ['Equipe DDDDDD', true, 7],
      ['Equipe BBBBBB', true, 7],
      ['Equipe CCCCCC', false, 8],
      ['Equipe AAAAAA', false, 3],
    ]);
  });
});

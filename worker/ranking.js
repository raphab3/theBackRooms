// Ranking do mundo aberto: cada expedição terminada vira uma linha (vitória primeiro, depois
// mais noites sobrevividas, depois a mais rápida).
import { ApiError } from './http.js';

/** Noites que a equipe atravessou inteiras (a noite em curso não conta). */
export const nightsSurvived = clock =>
  Math.max(0, clock.phase === 'night' ? clock.night - 1 : clock.night);

export async function saveRun(db, state, now) {
  await db
    .prepare(
      'INSERT OR IGNORE INTO world_runs(code,nights,won,team,duration_ms,created_at) VALUES(?,?,?,?,?,?)',
    )
    .bind(
      state.code,
      nightsSurvived(state.clock),
      state.status === 'won' ? 1 : 0,
      JSON.stringify(state.players.map(p => ({ name: p.name, color: p.color }))),
      Math.max(0, now - state.startedAt),
      now,
    )
    .run();
}

export async function rankingApi(db, action) {
  if (action !== 'nights') throw new ApiError('Ação não encontrada.', 404);
  const { results } = await db
    .prepare(
      'SELECT code,nights,won,team,duration_ms,created_at FROM world_runs ORDER BY won DESC, nights DESC, duration_ms ASC LIMIT 20',
    )
    .all();
  return {
    runs: results.map(r => ({
      nights: r.nights,
      won: !!r.won,
      team: JSON.parse(r.team),
      durationMs: r.duration_ms,
      at: r.created_at,
    })),
  };
}

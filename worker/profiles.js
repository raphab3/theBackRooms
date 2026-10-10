import { ApiError } from './http.js';
import { nameOf } from './players.js';

async function explorerProfile(db, action, body) {
  const profile = nameOf(body).normalize('NFKC').toLocaleLowerCase('pt-BR');
  if (!['load', 'save'].includes(action)) throw new ApiError('Ação não encontrada.', 404);
  if (action === 'save') {
    const progress = body.progress;
    if (
      !progress ||
      typeof progress !== 'object' ||
      Array.isArray(progress) ||
      Object.keys(progress).length > 30
    )
      throw new ApiError('Progresso inválido.');
    for (const [key, value] of Object.entries(progress))
      if (
        (!/^(visit-|win-|credited-)[a-zA-Z0-9-]{1,90}$/.test(key) &&
          ![
            'explored',
            'fuses',
            'coins',
            'wins',
            'coop',
            'coopWins',
            'rescues',
            'hardWins',
          ].includes(key)) ||
        !Number.isSafeInteger(value) ||
        value < 0 ||
        value > 1000000000
      )
        throw new ApiError('Progresso inválido.');
    await db
      .prepare(
        'INSERT INTO explorer_missions(profile,key,value) SELECT ?,key,value FROM json_each(?) WHERE true ON CONFLICT(profile,key) DO UPDATE SET value=MAX(explorer_missions.value,excluded.value)',
      )
      .bind(profile, JSON.stringify(progress))
      .run();
  }
  const rows = await db
    .prepare('SELECT key,value FROM explorer_missions WHERE profile=?')
    .bind(profile)
    .all();
  return { profile, progress: Object.fromEntries(rows.results.map(r => [r.key, r.value])) };
}

export { explorerProfile };

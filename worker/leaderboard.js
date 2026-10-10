import { PHASE_ORDER } from '@backrooms/shared/world.js';
import { ApiError } from './http.js';
import { adminName, authorize, nameOf } from './players.js';
import { validatedLevel } from './rooms.js';

async function globalLeaderboard(db, action, body) {
  if (action === 'top') {
    const rows = await db
      .prepare(
        'SELECT name,milliseconds,level,updated_at AS updatedAt FROM campaign_leaderboard WHERE level=? ORDER BY milliseconds ASC,updated_at ASC,profile COLLATE NOCASE ASC LIMIT 50',
      )
      .bind(PHASE_ORDER.at(-1))
      .all();
    return { entries: rows.results };
  }
  if (action !== 'submit') throw new ApiError('Ação não encontrada.', 404);
  let name = nameOf(body),
    milliseconds = body.milliseconds;
  if (body.code) {
    const row = await db.prepare('SELECT state FROM rooms WHERE code=?').bind(body.code).first();
    if (!row) throw new ApiError('Sala não encontrada.', 404);
    const room = JSON.parse(row.state),
      p = authorize(room, body);
    if (
      room.adminUsed ||
      !room.campaign ||
      room.status !== 'won' ||
      room.level !== PHASE_ORDER.at(-1) ||
      !room.campaignStarted
    )
      throw new ApiError('Complete todas as fases para entrar no ranking.', 409);
    name = p.name;
    milliseconds = room.finished - room.campaignStarted;
  } else if (
    body.completed !== true ||
    body.phases !== PHASE_ORDER.length ||
    body.level !== PHASE_ORDER.at(-1)
  )
    throw new ApiError('Complete todas as fases para entrar no ranking.', 409);
  if (adminName(name)) throw new ApiError('Partidas admin não entram no ranking.', 409);
  const profile = name.normalize('NFKC').toLocaleLowerCase('pt-BR');
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1000 || milliseconds > 86400000)
    throw new ApiError('Tempo inválido.');
  const level = validatedLevel(body.level);
  await db
    .prepare(
      'INSERT INTO campaign_leaderboard(profile,name,milliseconds,level,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(profile) DO UPDATE SET name=excluded.name,milliseconds=excluded.milliseconds,level=excluded.level,updated_at=excluded.updated_at WHERE campaign_leaderboard.level<>excluded.level OR excluded.milliseconds<campaign_leaderboard.milliseconds',
    )
    .bind(profile, name, milliseconds, level, Date.now())
    .run();
  const row = await db
    .prepare('SELECT name,milliseconds,level FROM campaign_leaderboard WHERE profile=?')
    .bind(profile)
    .first();
  return { entry: row };
}

export { globalLeaderboard };

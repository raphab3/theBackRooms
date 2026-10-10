import { ApiError } from './http.js';
import { colors, nameOf } from './players.js';
import { ACTIVE_MS, TTL } from './rooms.js';

async function globalChat(db, action, body) {
  const now = Date.now();
  if (action === 'session') {
    const name = nameOf(body),
      id = crypto.randomUUID(),
      token = crypto.randomUUID() + crypto.randomUUID(),
      color = colors[crypto.getRandomValues(new Uint8Array(1))[0] % colors.length];
    await db
      .prepare('INSERT INTO chat_sessions(id,token,name,color,seen) VALUES(?,?,?,?,?)')
      .bind(id, token, name, color, now)
      .run();
    await db
      .prepare('DELETE FROM chat_sessions WHERE seen<?')
      .bind(now - TTL)
      .run();
    return { id, token, name };
  }
  if (!['poll', 'send'].includes(action)) throw new ApiError('Ação não encontrada.', 404);
  const p = await db
    .prepare('SELECT id,name,color FROM chat_sessions WHERE id=? AND token=? AND seen>?')
    .bind(body.id || '', body.token || '', now - TTL)
    .first();
  if (!p) throw new ApiError('Reconectando ao chat global…', 401);
  if (body.name) {
    p.name = nameOf(body);
    await db.prepare('UPDATE chat_sessions SET name=? WHERE id=?').bind(p.name, p.id).run();
  }
  await db.prepare('UPDATE chat_sessions SET seen=? WHERE id=?').bind(now, p.id).run();
  if (action === 'send') {
    const text =
      typeof body.text === 'string' ? body.text.replace(/[\x00-\x1f\x7f]/g, ' ').trim() : '';
    if (!text || text.length > 240)
      throw new ApiError('Escreva uma mensagem com até 240 caracteres.');
    if (typeof body.messageId !== 'string' || !/^[a-zA-Z0-9-]{8,64}$/.test(body.messageId))
      throw new ApiError('Mensagem inválida.');
    const old = await db
      .prepare('SELECT id FROM chat_messages WHERE sender=? AND request_id=?')
      .bind(p.id, body.messageId)
      .first();
    if (!old) {
      const inserted = await db
        .prepare(
          'INSERT OR IGNORE INTO chat_messages(request_id,sender,name,color,text,created) SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM chat_messages WHERE sender=? AND created>?) RETURNING id',
        )
        .bind(body.messageId, p.id, p.name, p.color, text, now, p.id, now - 1000)
        .first();
      if (!inserted) {
        const retry = await db
          .prepare('SELECT id FROM chat_messages WHERE sender=? AND request_id=?')
          .bind(p.id, body.messageId)
          .first();
        if (!retry) throw new ApiError('Espere um segundo antes de enviar outra mensagem.', 429);
      }
    }
    await db
      .prepare(
        'DELETE FROM chat_messages WHERE id NOT IN (SELECT id FROM chat_messages ORDER BY id DESC LIMIT 100)',
      )
      .bind()
      .run();
  }
  const messages = await db
    .prepare(
      'SELECT id,sender,name,color,text,created AS at FROM chat_messages WHERE created>? ORDER BY id DESC LIMIT 50',
    )
    .bind(now - 86400000)
    .all();
  const online = await db
    .prepare('SELECT COUNT(*) AS total FROM chat_sessions WHERE seen>?')
    .bind(now - ACTIVE_MS)
    .first();
  return { messages: messages.results.reverse(), online: online.total };
}

export { globalChat };

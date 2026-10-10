import { validateCustomMap } from '../public/world.js';
import { ApiError } from './http.js';
import { TTL } from './rooms.js';

async function customMapsApi(db, action, body) {
  const now = Date.now();
  let owner = '',
    author = '';
  if (body.sessionId && body.sessionToken) {
    const session = await db
      .prepare('SELECT name FROM chat_sessions WHERE id=? AND token=? AND seen>?')
      .bind(body.sessionId, body.sessionToken, now - TTL)
      .first();
    if (!session) throw new ApiError('Entre novamente para salvar seus mapas.', 401);
    author = session.name;
    owner = author.normalize('NFKC').toLocaleLowerCase('pt-BR');
  }
  const requireOwner = () => {
    if (!owner) throw new ApiError('Entre com seu nome para acessar seus mapas.', 401);
  };
  if (action === 'gallery' || action === 'mine') {
    if (action === 'mine') requireOwner();
    const offset =
      Number.isSafeInteger(body.offset) && body.offset >= 0 ? Math.min(body.offset, 10000) : 0;
    const field = action === 'mine' ? 'data' : 'published_data';
    const where = action === 'mine' ? 'owner=?' : 'published_data IS NOT NULL';
    const rows = await db
      .prepare(
        `SELECT id,author,revision,updated_at AS updatedAt,published_data IS NOT NULL AS published,json_extract(${field},'$.title') AS title,json_extract(${field},'$.theme') AS theme,json_extract(${field},'$.grid') AS preview FROM custom_maps WHERE ${where} ORDER BY updated_at DESC,id ASC LIMIT 13 OFFSET ?`,
      )
      .bind(...(action === 'mine' ? [owner, offset] : [offset]))
      .all();
    return {
      maps: rows.results.slice(0, 12),
      nextOffset: rows.results.length > 12 ? offset + 12 : null,
    };
  }
  if (action === 'save') {
    requireOwner();
    let map;
    try {
      map = validateCustomMap(body.map, body.publish === true);
    } catch (e) {
      throw new ApiError(e.message);
    }
    const data = JSON.stringify(map);
    if (body.mapId) {
      const old = await db
        .prepare('SELECT owner,revision FROM custom_maps WHERE id=?')
        .bind(body.mapId)
        .first();
      if (!old || old.owner !== owner)
        throw new ApiError('Este mapa não pertence ao seu perfil.', 403);
      const r = await db
        .prepare(
          'UPDATE custom_maps SET data=?,author=?,published_data=CASE WHEN ?=1 THEN ? ELSE published_data END,revision=revision+1,updated_at=? WHERE id=? AND owner=? AND revision=?',
        )
        .bind(
          data,
          author,
          body.publish === true ? 1 : 0,
          data,
          now,
          body.mapId,
          owner,
          body.revision,
        )
        .run();
      if (!r.meta.changes)
        throw new ApiError(
          'Este mapa foi atualizado em outra aba. Reabra em Meus mapas antes de editar.',
          409,
        );
      return { mapId: body.mapId, revision: old.revision + 1, published: body.publish === true };
    }
    const id = crypto.randomUUID();
    const inserted = await db
      .prepare(
        'INSERT INTO custom_maps(id,owner,author,data,published_data,revision,created_at,updated_at) SELECT ?,?,?,?,?,1,?,? WHERE (SELECT COUNT(*) FROM custom_maps WHERE owner=?)<20',
      )
      .bind(id, owner, author, data, body.publish === true ? data : null, now, now, owner)
      .run();
    if (!inserted.meta.changes)
      throw new ApiError('Seu perfil já tem 20 mapas. Exclua um para criar outro.', 409);
    return { mapId: id, revision: 1, published: body.publish === true };
  }
  if (!['get', 'unpublish', 'delete'].includes(action))
    throw new ApiError('Ação não encontrada.', 404);
  if (typeof body.mapId !== 'string' || body.mapId.length > 64)
    throw new ApiError('Mapa inválido.');
  const row = await db.prepare('SELECT * FROM custom_maps WHERE id=?').bind(body.mapId).first();
  if (!row) throw new ApiError('Mapa não encontrado.', 404);
  if (action === 'get') {
    const edit = body.edit === true;
    if (edit) {
      requireOwner();
      if (row.owner !== owner) throw new ApiError('Este mapa não pertence ao seu perfil.', 403);
    }
    if (!edit && !row.published_data)
      throw new ApiError('Este mapa ainda não está publicado.', 404);
    return {
      mapId: row.id,
      revision: row.revision,
      author: row.author,
      map: JSON.parse(edit ? row.data : row.published_data),
      published: !!row.published_data,
    };
  }
  requireOwner();
  if (row.owner !== owner) throw new ApiError('Este mapa não pertence ao seu perfil.', 403);
  if (action === 'delete')
    await db
      .prepare('DELETE FROM custom_maps WHERE id=? AND owner=? AND revision=?')
      .bind(row.id, owner, body.revision)
      .run()
      .then(r => {
        if (!r.meta.changes) throw new ApiError('O mapa mudou. Atualize a lista.', 409);
      });
  else {
    const r = await db
      .prepare(
        'UPDATE custom_maps SET published_data=NULL,revision=revision+1,updated_at=? WHERE id=? AND owner=? AND revision=?',
      )
      .bind(now, row.id, owner, body.revision)
      .run();
    if (!r.meta.changes) throw new ApiError('O mapa mudou. Atualize a lista.', 409);
  }
  return { ok: true };
}

export { customMapsApi };

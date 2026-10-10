// Estoque pessoal entre partidas. Identidade sem login: cada aparelho guarda uma chave secreta
// (64 hex) e o servidor só conhece o hash dela. O que a vitória extrai entra no estoque uma vez só.
import { ITEMS } from '@backrooms/shared/loot.js';
import { ApiError } from './http.js';
import { nameOf } from './players.js';

const KEY = /^[0-9a-f]{64}$/;

async function hashKey(key) {
  if (typeof key !== 'string' || !KEY.test(key))
    throw new ApiError('Chave do aparelho inválida.', 401);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function readInventory(db, keyHash) {
  const rows = await db
    .prepare('SELECT item, qty FROM inventories WHERE key_hash=? AND qty>0')
    .bind(keyHash)
    .all();
  return Object.fromEntries(rows.results.filter(r => r.item in ITEMS).map(r => [r.item, r.qty]));
}

// POST /api/inventory/get {key, name}: registra o apelido do aparelho e devolve o estoque.
async function inventoryApi(db, action, body) {
  if (action !== 'get') throw new ApiError('Ação não encontrada.', 404);
  const keyHash = await hashKey(body.key),
    name = nameOf(body),
    now = Date.now();
  await db
    .prepare(
      'INSERT INTO players(key_hash,name,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT(key_hash) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at',
    )
    .bind(keyHash, name, now, now)
    .run();
  return { items: await readInventory(db, keyHash) };
}

/**
 * Guarda o fim da expedição: registra a partida e soma o que cada um extraiu ao estoque.
 * Idempotente pelo id (sala + rodada): se já foi registrada, não credita de novo.
 */
async function saveExpedition(db, room, now) {
  const id = `${room.code}:${room.round}`,
    loot = {};
  for (const p of room.players) if (room.extracted?.[p.id]) loot[p.id] = room.extracted[p.id];
  const inserted = await db
    .prepare(
      'INSERT OR IGNORE INTO expeditions(id,room_code,level,result,duration_ms,loot,created_at) VALUES(?,?,?,?,?,?,?)',
    )
    .bind(
      id,
      room.code,
      room.level,
      room.status,
      Math.max(0, (room.finished || now) - room.started),
      JSON.stringify(loot),
      now,
    )
    .run();
  if (!inserted.meta.changes) return false;
  const credits = [];
  for (const p of room.players) {
    if (!p.keyHash) continue;
    for (const [item, qty] of Object.entries(room.extracted?.[p.id] || {}))
      if (item in ITEMS && Number.isSafeInteger(qty) && qty > 0)
        credits.push(
          db
            .prepare(
              'INSERT INTO inventories(key_hash,item,qty) VALUES(?,?,?) ON CONFLICT(key_hash,item) DO UPDATE SET qty=qty+excluded.qty',
            )
            .bind(p.keyHash, item, qty),
        );
  }
  if (credits.length) await db.batch(credits);
  return true;
}

/** Crédito individual (saída pelo portal do mundo aberto), idempotente pelo id. */
async function creditPlayer(db, { id, code, keyHash, items, startedAt }) {
  const now = Date.now(),
    inserted = await db
      .prepare(
        "INSERT OR IGNORE INTO expeditions(id,room_code,level,result,duration_ms,loot,created_at) VALUES(?,?,'camp','left',?,?,?)",
      )
      .bind(id, code, Math.max(0, now - startedAt), JSON.stringify(items), now)
      .run();
  if (!inserted.meta.changes) return false;
  const credits = Object.entries(items)
    .filter(([item, qty]) => item in ITEMS && Number.isSafeInteger(qty) && qty > 0)
    .map(([item, qty]) =>
      db
        .prepare(
          'INSERT INTO inventories(key_hash,item,qty) VALUES(?,?,?) ON CONFLICT(key_hash,item) DO UPDATE SET qty=qty+excluded.qty',
        )
        .bind(keyHash, item, qty),
    );
  if (credits.length) await db.batch(credits);
  return true;
}

export { creditPlayer, hashKey, inventoryApi, readInventory, saveExpedition };

// Bancada e armeiro do Posto Zero: braços de cada jogador e a evolução paga com o estoque.
import { ARMS, upgradeCost } from '@backrooms/shared/arms.js';
import { ApiError } from './http.js';
import { hashKey, readInventory } from './inventory.js';

async function readArms(db, keyHash) {
  const rows = await db
    .prepare('SELECT element, level FROM arms WHERE key_hash=?')
    .bind(keyHash)
    .all();
  // Todo explorador já tem o Braço de Fogo nível 1, mesmo sem linha no banco.
  return { fire: 1, ...Object.fromEntries(rows.results.map(r => [r.element, r.level])) };
}

/**
 * Evolui o braço numa transação só (batch do D1). Cliques repetidos não cobram duas vezes:
 * o nível só sobe se ainda for o nível lido e houver recursos, e o desconto só acontece para a
 * evolução marcada com o id desta chamada.
 */
async function upgradeArm(db, keyHash, element) {
  if (element !== 'fire') throw new ApiError('Esse braço chega na Fase 3.', 409);
  const level = (await readArms(db, keyHash)).fire;
  if (level >= ARMS.fire.maxLevel)
    throw new ApiError('O Braço de Fogo já está no nível máximo.', 409);
  const cost = upgradeCost(level),
    upgradeId = crypto.randomUUID(),
    have = item => `COALESCE((SELECT qty FROM inventories WHERE key_hash=?1 AND item='${item}'),0)`;
  const results = await db.batch([
    db
      .prepare(
        "INSERT INTO arms(key_hash,element,level,upgrade_id) VALUES(?1,'fire',1,NULL) ON CONFLICT(key_hash,element) DO NOTHING",
      )
      .bind(keyHash),
    db
      .prepare(
        `UPDATE arms SET level=level+1, upgrade_id=?2 WHERE key_hash=?1 AND element='fire' AND level=?3 AND ${have('scrap')}>=?4 AND ${have('core_fire')}>=?5`,
      )
      .bind(keyHash, upgradeId, level, cost.scrap, cost.core_fire),
    db
      .prepare(
        "UPDATE inventories SET qty=qty-CASE item WHEN 'scrap' THEN ?3 ELSE ?4 END WHERE key_hash=?1 AND item IN ('scrap','core_fire') AND (SELECT upgrade_id FROM arms WHERE key_hash=?1 AND element='fire')=?2",
      )
      .bind(keyHash, upgradeId, cost.scrap, cost.core_fire),
  ]);
  if (!results[1].meta.changes)
    throw new ApiError(
      `Faltam recursos: ${cost.scrap} de Sucata e ${cost.core_fire} Núcleo(s) de Fogo.`,
      409,
    );
}

// POST /api/workshop/get|upgrade {key, element?}
async function workshopApi(db, action, body) {
  const keyHash = await hashKey(body.key);
  if (action === 'upgrade') await upgradeArm(db, keyHash, body.element);
  else if (action !== 'get') throw new ApiError('Ação não encontrada.', 404);
  return { arms: await readArms(db, keyHash), items: await readInventory(db, keyHash) };
}

export { readArms, workshopApi };

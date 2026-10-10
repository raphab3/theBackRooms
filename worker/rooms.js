import { ENEMY_HP, ENEMY_RESPAWN_MS, FIRE } from '@backrooms/shared/combat.js';
import { START_ALMOND, addTotals, createLoot } from '@backrooms/shared/loot.js';
import { PHASE_ORDER, createWorld, findRoute } from '@backrooms/shared/world.js';
import { ApiError } from './http.js';

const LEVELS = PHASE_ORDER;
function validatedLevel(value = 'backrooms') {
  if (!LEVELS.includes(value)) throw new ApiError('Escolha um dos cenários disponíveis.');
  return value;
}
function validatedMode(value = 'normal') {
  if (!['normal', 'hardcore'].includes(value)) throw new ApiError('Escolha Normal ou Hardcore.');
  return value;
}
const MAX_PLAYERS = 4,
  ACTIVE_MS = 18000,
  TTL = 7200000;
// Recursos, mochilas e tiros zerados no começo de cada partida (campanha ou não).
function resetExpedition(room) {
  room.effects = [];
  room.loot = createLoot(room.world, room.seed);
  room.extracted = null;
  for (const p of room.players)
    Object.assign(p, {
      bag: [{ item: 'almond', qty: START_ALMOND }],
      carrying: [],
      salvaging: null,
    });
}
function beginPhase(room, now, level = room.level) {
  if (!room.campaignStarted && level === PHASE_ORDER[0]) room.campaignStarted = now;
  room.level = level;
  room.seed = crypto.getRandomValues(new Uint32Array(1))[0];
  room.world = createWorld(room.seed, level);
  room.status = 'playing';
  room.started = now;
  room.finished = 0;
  room.lastTick = now;
  room.round++;
  room.balance = 0;
  room.collectedCoins = [];
  room.coinRespawns = {};
  room.fuses = room.world.fuses.map(() => false);
  room.enemy = { ...room.world.enemy };
  room.smile = room.mode === 'hardcore' ? { ...room.world.smile } : null;
  resetExpedition(room);
  for (const p of room.players)
    Object.assign(p, {
      x: 1.5,
      y: 1.5,
      a: 0,
      alive: true,
      seq: 0,
      moveOrdinal: 0,
      moveCredit: 0.5,
      moveClock: now,
      protectedUntil: 0,
      respawns: 0,
    });
}

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Braço de Fogo: dano na entidade; morta, ela some e reaparece longe da equipe depois.
function damageEnemy(room, amount, now) {
  const enemy = room.enemy;
  if (enemy.dead) return;
  enemy.hp = (enemy.hp ?? ENEMY_HP) - amount;
  if (enemy.hp <= 0) {
    enemy.hp = 0;
    enemy.dead = true;
    enemy.respawnAt = now + ENEMY_RESPAWN_MS;
    enemy.burnUntil = 0;
    enemy.path = [];
    // Cada entidade derrotada deixa um Núcleo de Fogo onde caiu.
    room.loot?.cores.push({ id: crypto.randomUUID(), x: enemy.x, y: enemy.y });
  }
}
// Pego pela entidade: a mochila (e as que carregava de colegas) fica no chão para ser resgatada.
function catchPlayer(room, p) {
  if (!p.alive) return;
  p.alive = false;
  const drop = (owner, ownerName, items) =>
    items.length &&
    room.loot?.bags.push({ id: crypto.randomUUID(), owner, ownerName, x: p.x, y: p.y, items });
  drop(p.id, p.name, p.bag || []);
  for (const bag of p.carrying || []) drop(bag.owner, bag.ownerName, bag.items);
  p.bag = [];
  p.carrying = [];
}
// Fim da expedição: vitória extrai a mochila de quem está vivo e as resgatadas voltam ao dono.
function settleExpedition(room) {
  if (room.extracted || !['won', 'lost'].includes(room.status)) return;
  const extracted = {};
  if (room.status === 'won')
    for (const p of room.players.filter(v => v.alive)) {
      addTotals((extracted[p.id] ??= {}), p.bag || []);
      for (const bag of p.carrying || []) addTotals((extracted[bag.owner] ??= {}), bag.items);
    }
  room.extracted = extracted;
}
function updateEnemyHealth(room, now, dt) {
  const enemy = room.enemy;
  if (!enemy.dead && (enemy.burnUntil || 0) > now)
    damageEnemy(room, FIRE.primary.burnDps * dt, now);
  if (enemy.dead && now >= enemy.respawnAt) {
    // Reaparece na célula livre mais longe de todos os exploradores vivos.
    const alive = room.players.filter(p => p.alive),
      cells = [room.world.enemy, ...room.world.coins],
      far = c => Math.min(Infinity, ...alive.map(p => distance(p, c))),
      spot = cells.reduce((best, c) => (far(c) > far(best) ? c : best), cells[0]);
    Object.assign(enemy, { x: spot.x, y: spot.y, hp: ENEMY_HP, dead: false, path: [], pathAt: 0 });
  }
}
const isOpen = (grid, x, y) =>
  Number.isFinite(x) && Number.isFinite(y) && grid[Math.floor(y)]?.[Math.floor(x)] === 0;
function tickRoom(room, now) {
  room.level = room.level || 'backrooms';
  room.mode = room.mode || 'normal';
  if (room.campaign && room.status === 'won' && room.finished && now - room.finished >= 3000) {
    const next = PHASE_ORDER[PHASE_ORDER.indexOf(room.level) + 1];
    if (next) beginPhase(room, now, next);
  }
  if (room.mode === 'hardcore' && !room.smile) {
    room.world.smile = room.world.smile || createWorld(room.seed, room.level).smile;
    room.smile = { ...room.world.smile };
  }
  // Rooms created before the coin update retain their original map and progress.
  if (!room.world.coins) room.world.coins = createWorld(room.seed, room.level).coins;
  room.loot ??= createLoot(room.world, room.seed);
  if (!Array.isArray(room.collectedCoins)) room.collectedCoins = [];
  if (!Number.isFinite(room.balance)) room.balance = 0;
  if (!room.coinRespawns) {
    room.coinRespawns = {};
    for (const id of room.collectedCoins) room.coinRespawns[id] = now + 10000;
  }
  room.collectedCoins = room.collectedCoins.filter(id => {
    if (room.coinRespawns[id] === undefined) room.coinRespawns[id] = now + 10000;
    if (now >= room.coinRespawns[id]) {
      delete room.coinRespawns[id];
      return false;
    }
    return true;
  });
  if (room.mode === 'hardcore') {
    room.balance = 0;
    room.collectedCoins = [];
    room.coinRespawns = {};
  }
  const dt = Math.min(0.75, Math.max(0, (now - room.lastTick) / 1000));
  room.lastTick = now;
  room.players = room.players.filter(p => now - p.seen < TTL);
  const online = room.players.filter(p => now - p.seen < ACTIVE_MS);
  if (!online.some(p => p.id === room.host) && online.length) room.host = online[0].id;
  if (room.status !== 'playing') return;
  const alive = online.filter(p => p.alive);
  if (!alive.length) {
    if (online.length) room.status = 'lost';
    return;
  }
  updateEnemyHealth(room, now, dt);
  if (now - room.started < (room.level === 'run' ? 6000 : 22000)) return;
  for (const enemy of room.mode === 'hardcore' ? [room.enemy, room.smile] : [room.enemy]) {
    if (enemy.dead) continue;
    if (
      !enemy.path?.length ||
      ((!enemy.pathAt || now - enemy.pathAt > 1000) &&
        Math.hypot(enemy.x - Math.floor(enemy.x) - 0.5, enemy.y - Math.floor(enemy.y) - 0.5) < 0.02)
    ) {
      let paths = alive
        .map(p =>
          findRoute(
            room.world.grid,
            Math.floor(enemy.x),
            Math.floor(enemy.y),
            Math.floor(p.x),
            Math.floor(p.y),
          ),
        )
        .filter(p => p.length);
      paths.sort((a, b) => a.length - b.length);
      enemy.path = paths[0]?.slice(1) || [];
      enemy.pathAt = now;
    }
    // Finish each cell-center waypoint before turning to prevent cutting through walls.
    let remaining =
      dt *
      (room.level === 'run'
        ? enemy.type === 'smile'
          ? 2.5
          : 2.65
        : (enemy.type === 'smile' ? 0.7 : 0.75) + room.fuses.filter(Boolean).length * 0.15);
    while (remaining > 0 && enemy.path?.length) {
      let target = enemy.path[0],
        dx = target[0] + 0.5 - enemy.x,
        dy = target[1] + 0.5 - enemy.y,
        d = Math.hypot(dx, dy);
      if (d < 0.001) {
        enemy.path.shift();
        continue;
      }
      let amount = Math.min(d, remaining);
      enemy.x += (dx / d) * amount;
      enemy.y += (dy / d) * amount;
      remaining -= amount;
      if (amount === d) enemy.path.shift();
      else break;
    }
    for (const p of alive)
      if (now >= (p.protectedUntil || 0) && distance(p, enemy) < 0.43) catchPlayer(room, p);
  }
  if (alive.every(p => !p.alive)) room.status = 'lost';
  settleExpedition(room);
}
function safeRoom(room, now) {
  return {
    code: room.code,
    adminUsed: !!room.adminUsed,
    campaign: !!room.campaign,
    campaignStarted: room.campaignStarted || 0,
    level: room.level || 'backrooms',
    mode: room.mode || 'normal',
    smile:
      room.mode === 'hardcore' && room.smile
        ? { x: room.smile.x, y: room.smile.y, type: 'smile' }
        : null,
    seed: room.seed,
    host: room.host,
    status: room.status,
    started: room.started,
    finished: room.finished || 0,
    now,
    round: room.round,
    fuses: room.fuses,
    balance: room.balance || 0,
    collectedCoins: room.collectedCoins || [],
    enemy: {
      x: room.enemy.x,
      y: room.enemy.y,
      type: 'enemy',
      hp: room.enemy.hp ?? ENEMY_HP,
      dead: !!room.enemy.dead,
      burning: (room.enemy.burnUntil || 0) > now,
    },
    loot: room.loot && {
      piles: room.loot.piles.filter(v => !v.salvaged).map(({ id, x, y }) => ({ id, x, y })),
      almonds: room.loot.almonds.filter(v => !v.taken).map(({ id, x, y }) => ({ id, x, y })),
      cores: room.loot.cores,
      bags: room.loot.bags.map(({ id, owner, ownerName, x, y }) => ({
        id,
        owner,
        ownerName,
        x,
        y,
      })),
    },
    extracted: room.extracted || null,
    // Disparos do último segundo, para cada um ver os tiros dos colegas.
    effects: (room.effects || []).filter(e => now - e.at < 1000),
    players: room.players
      .filter(p => now - p.seen < ACTIVE_MS)
      .map(({ id, name, color, skin, x, y, a, alive, respawns = 0, bag = [], carrying = [] }) => ({
        id,
        name,
        color,
        skin,
        bag,
        carrying: carrying.length,
        x,
        y,
        a,
        alive,
        respawns,
      })),
    messages: room.messages || [],
    capacity: MAX_PLAYERS,
  };
}
function validateMovement(room, p, body, now, previousSeen) {
  const reject = reason => ({ accepted: false, reason, ackMovement: p.moveOrdinal || 0 });
  if (body.respawns !== undefined && body.respawns !== (p.respawns || 0)) return reject('respawn');
  if (
    !Number.isFinite(body.x) ||
    !Number.isFinite(body.y) ||
    !Number.isFinite(body.a) ||
    Math.abs(body.a) > 1e8
  )
    return reject('invalid');
  const hasTrail = Array.isArray(body.trail);
  let points = [];
  if (hasTrail) {
    if (body.trail.length > 96) return reject('invalid');
    let ordinal = 0;
    for (const point of body.trail) {
      if (
        !Array.isArray(point) ||
        point.length !== 3 ||
        !Number.isSafeInteger(point[0]) ||
        point[0] <= ordinal ||
        !Number.isFinite(point[1]) ||
        !Number.isFinite(point[2])
      )
        return reject('invalid');
      ordinal = point[0];
      if (point[0] > (p.moveOrdinal || 0)) points.push(point);
    }
    const last = body.trail.at(-1);
    if (last && Math.hypot(last[1] - body.x, last[2] - body.y) > 0.01) return reject('invalid');
    if (!points.length && Math.hypot(body.x - p.x, body.y - p.y) > 0.01) return reject('invalid');
  } else points = [[0, body.x, body.y]];
  let x = p.x,
    y = p.y,
    total = 0;
  for (const [, nx, ny] of points) {
    const d = Math.hypot(nx - x, ny - y),
      steps = Math.max(1, Math.ceil(d / 0.06));
    if (d > 6) return reject('speed');
    total += d;
    for (let i = 1; i <= steps; i++)
      if (!isOpen(room.world.grid, x + ((nx - x) * i) / steps, y + ((ny - y) * i) / steps))
        return reject('wall');
    x = nx;
    y = ny;
  }
  const credit = Math.min(
    6,
    (p.moveCredit ?? 0.5) + (Math.max(0, now - (p.moveClock ?? previousSeen)) / 1000) * 3.5,
  );
  p.moveCredit = credit;
  p.moveClock = now;
  if (total > credit + 0.001) return reject('speed');
  p.moveCredit = Math.max(0, credit - total);
  p.x = x;
  p.y = y;
  p.a = body.a;
  if (hasTrail && points.length) p.moveOrdinal = points.at(-1)[0];
  return { accepted: true, ackMovement: p.moveOrdinal || 0 };
}

export {
  ACTIVE_MS,
  catchPlayer,
  damageEnemy,
  resetExpedition,
  settleExpedition,
  MAX_PLAYERS,
  TTL,
  beginPhase,
  distance,
  tickRoom,
  safeRoom,
  validateMovement,
  validatedLevel,
  validatedMode,
};

// Simulação do mundo aberto (sem Durable Object, para testar direto): acampamento + edificações.
// Cada jogador está numa zona ('camp' ou o id de uma edificação) e só interage com ela.
import { almondSaveChance, damageMultiplier } from '@backrooms/shared/arms.js';
import {
  CAMP_SPAWN,
  ENTER_GRACE_MS,
  LEAVE_MS,
  PORTAL,
  RESPAWN_MS,
  INSIDE_EXIT,
  USE_REACH,
  buildingSeed,
  createCamp,
} from '@backrooms/shared/camp.js';
import { ENEMY_HP, ENEMY_RESPAWN_MS, FIRE, traceShot } from '@backrooms/shared/combat.js';
import {
  PICKUP_REACH,
  SALVAGE_MS,
  SALVAGE_REACH,
  START_ALMOND,
  addItems,
  addTotals,
  countItem,
  createLoot,
  removeItems,
} from '@backrooms/shared/loot.js';
import { createWorld, findRoute } from '@backrooms/shared/world.js';
import { ApiError } from './http.js';
import { validateMovement } from './rooms.js';

const ACTIONS = ['hello', 'sync', 'use', 'leave', 'shoot', 'salvageStart', 'salvage', 'chat'];
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function createExpedition({ code, seed, players, lobbyKey = null, now }) {
  const camp = createCamp(seed),
    zones = {};
  camp.buildings.forEach((b, i) => {
    const world = createWorld(buildingSeed(seed, i), b.level);
    zones[b.id] = {
      world,
      enemy: { ...world.enemy, hp: ENEMY_HP, dead: false },
      loot: createLoot(world, (seed + i * 104729) >>> 0),
      collectedCoins: [],
      busySince: 0,
    };
  });
  return {
    code,
    seed,
    lobbyKey,
    startedAt: now,
    lastTick: now,
    status: 'playing',
    camp,
    zones,
    campLoot: { bags: [], cores: [] },
    balance: 0,
    effects: [],
    messages: [],
    players: players.map(p => ({
      ...p,
      zone: 'camp',
      x: CAMP_SPAWN.x + (Math.random() - 0.5),
      y: CAMP_SPAWN.y,
      a: -Math.PI / 2,
      alive: true,
      respawnAt: 0,
      protectedUntil: 0,
      bag: [{ item: 'almond', qty: START_ALMOND }],
      carrying: [],
      seq: 0,
      moveCredit: 0.5,
      moveClock: now,
      seen: now,
      left: false,
    })),
  };
}

const gridOf = (state, zone) => (zone === 'camp' ? state.camp.grid : state.zones[zone].world.grid);
const lootOf = (state, zone) => (zone === 'camp' ? state.campLoot : state.zones[zone].loot);

function authorize(state, body) {
  const p = state.players.find(v => v.id === body.id && v.token === body.token && !v.left);
  if (!p) throw new ApiError('Sua sessão da expedição expirou.', 401);
  return p;
}

function moveTo(p, zone, at, now) {
  Object.assign(p, { zone, x: at.x, y: at.y, moveCredit: 0.5, moveClock: now, salvaging: null });
}

// Pego: a mochila (e as carregadas) cai onde estava; volta ao acampamento depois de RESPAWN_MS.
function catchPlayer(state, p, now) {
  if (!p.alive) return;
  p.alive = false;
  p.respawnAt = now + RESPAWN_MS;
  const loot = lootOf(state, p.zone),
    drop = (owner, ownerName, items) =>
      items.length &&
      loot.bags.push({ id: crypto.randomUUID(), owner, ownerName, x: p.x, y: p.y, items });
  drop(p.id, p.name, p.bag);
  for (const bag of p.carrying) drop(bag.owner, bag.ownerName, bag.items);
  p.bag = [];
  p.carrying = [];
}

function damageEnemy(state, zone, amount, now) {
  const enemy = state.zones[zone].enemy;
  if (enemy.dead) return;
  enemy.hp -= amount;
  if (enemy.hp <= 0) {
    Object.assign(enemy, {
      hp: 0,
      dead: true,
      respawnAt: now + ENEMY_RESPAWN_MS,
      burnUntil: 0,
      path: [],
    });
    state.zones[zone].loot.cores.push({ id: crypto.randomUUID(), x: enemy.x, y: enemy.y });
  }
}

/** Uma ação de um jogador. Devolve o que o autor precisa saber (além da visão atualizada). */
function stepWorld(state, action, body, now) {
  if (!ACTIONS.includes(action)) throw new ApiError('Ação não encontrada.', 404);
  tickWorld(state, now);
  const p = authorize(state, body);
  p.seen = now;
  if (action === 'hello') return { id: p.id };
  if (action === 'chat') {
    const text =
      typeof body.text === 'string' ? body.text.replace(/[\x00-\x1f\x7f]/g, ' ').trim() : '';
    if (!text || text.length > 240)
      throw new ApiError('Escreva uma mensagem com até 240 caracteres.');
    if (p.lastChat && now - p.lastChat < 800) throw new ApiError('Espere um instante.', 429);
    p.lastChat = now;
    state.messages = [
      ...state.messages,
      { id: crypto.randomUUID(), sender: p.id, name: p.name, color: p.color, text, at: now },
    ].slice(-50);
    return {};
  }
  if (!p.alive) throw new ApiError('Você foi pego. Volta ao acampamento em instantes.', 409);
  if (action === 'use') return use(state, p, now);
  if (action === 'leave') return leave(state, p, body, now);
  if (action === 'shoot') return shoot(state, p, body, now);
  if (action === 'salvageStart' || action === 'salvage')
    return salvage(state, p, action, body, now);
  return sync(state, p, body, now);
}

// E perto de uma porta (entra), da saída de dentro (volta) ou do portal (começa a sair).
function use(state, p, now) {
  if (p.zone === 'camp') {
    const b = state.camp.buildings.find(v => distance(p, v.doorAt) <= USE_REACH);
    if (b) {
      moveTo(p, b.id, INSIDE_EXIT, now);
      const zone = state.zones[b.id];
      if (!state.players.some(v => v !== p && v.zone === b.id && v.alive)) zone.busySince = now;
      return { zone: b.id };
    }
    if (distance(p, PORTAL) <= USE_REACH) {
      p.leaving = now;
      return { leaving: true };
    }
    throw new ApiError('Chegue perto de uma porta ou do portal.');
  }
  if (distance(p, INSIDE_EXIT) <= USE_REACH) {
    const b = state.camp.buildings.find(v => v.id === p.zone);
    moveTo(p, 'camp', b.doorAt, now);
    return { zone: 'camp' };
  }
  throw new ApiError('A saída é por onde você entrou.');
}

// Segurou E no portal: sai da expedição levando a mochila (e as resgatadas voltam aos donos).
function leave(state, p, body, now) {
  if (p.zone !== 'camp' || distance(p, PORTAL) > USE_REACH) throw new ApiError('Vá até o portal.');
  if (!p.leaving || now - p.leaving < LEAVE_MS - 200) throw new ApiError('Segure E no portal.');
  const extracted = {};
  addTotals((extracted[p.id] ??= {}), p.bag);
  for (const bag of p.carrying) addTotals((extracted[bag.owner] ??= {}), bag.items);
  p.left = true;
  p.bag = [];
  p.carrying = [];
  if (state.players.every(v => v.left)) state.status = 'ended';
  return { extracted };
}

function shoot(state, p, body, now) {
  if (!Number.isFinite(body.a)) throw new ApiError('Disparo inválido.');
  const kind = body.kind === 'charged' ? 'charged' : 'primary',
    spec = FIRE[kind];
  if (now - (p.shotAt || 0) < spec.cooldownMs) return { hit: false, cooldown: true };
  if (kind === 'charged') {
    if (!countItem(p.bag, 'almond')) throw new ApiError('Sem Amêndoa para o tiro carregado.', 409);
    if (Math.random() >= almondSaveChance(p.armLevel || 1)) removeItems(p.bag, 'almond', 1);
  }
  p.shotAt = now;
  const zone = p.zone === 'camp' ? null : state.zones[p.zone],
    enemy = zone && !zone.enemy.dead ? zone.enemy : null,
    shot = traceShot(gridOf(state, p.zone), p, body.a, enemy, kind);
  if (shot.hit) {
    damageEnemy(state, p.zone, spec.damage * damageMultiplier(p.armLevel || 1), now);
    if (kind === 'primary' && !zone.enemy.dead) zone.enemy.burnUntil = now + spec.burnMs;
  }
  state.effects = [
    ...state.effects.filter(e => now - e.at < 1000),
    {
      id: crypto.randomUUID(),
      zone: p.zone,
      by: p.id,
      kind,
      from: { x: p.x, y: p.y },
      to: shot.end,
      hit: shot.hit,
      at: now,
    },
  ].slice(-20);
  return { hit: shot.hit };
}

function salvage(state, p, action, body, now) {
  const pile = lootOf(state, p.zone).piles?.find(v => v.id === body.pile && !v.salvaged);
  if (!pile || distance(p, pile) > SALVAGE_REACH)
    throw new ApiError('Chegue mais perto da sucata.');
  if (action === 'salvageStart') {
    p.salvaging = { pile: pile.id, at: now };
    return {};
  }
  if (p.salvaging?.pile !== pile.id || now - p.salvaging.at < SALVAGE_MS - 200)
    throw new ApiError('Segure E até terminar de desmontar.');
  p.salvaging = null;
  const got = addItems(p.bag, 'scrap', pile.amount);
  if (!got) throw new ApiError('Mochila cheia.', 409);
  pile.amount -= got;
  if (!pile.amount) pile.salvaged = true;
  return { got };
}

function sync(state, p, body, now) {
  if (!Number.isSafeInteger(body.seq) || body.seq <= p.seq) return {};
  p.seq = body.seq;
  const previous = p.moveClock,
    movement = validateMovement({ world: { grid: gridOf(state, p.zone) } }, p, body, now, previous);
  const loot = lootOf(state, p.zone);
  if (p.zone !== 'camp') {
    const zone = state.zones[p.zone];
    for (const coin of zone.world.coins)
      if (!zone.collectedCoins.includes(coin.id) && distance(p, coin) < 0.55) {
        zone.collectedCoins.push(coin.id);
        state.balance++;
      }
    for (const bottle of loot.almonds)
      if (!bottle.taken && distance(p, bottle) < PICKUP_REACH && addItems(p.bag, 'almond', 1))
        bottle.taken = true;
  }
  loot.cores = loot.cores.filter(
    core => distance(p, core) >= PICKUP_REACH || !addItems(p.bag, 'core_fire', 1),
  );
  loot.bags = loot.bags.filter(bag => {
    if (distance(p, bag) >= PICKUP_REACH) return true;
    p.carrying.push(bag);
    return false;
  });
  if (p.leaving && distance(p, PORTAL) > USE_REACH) p.leaving = 0;
  return { positionAccepted: movement.accepted, ackMovement: movement.ackMovement };
}

/** Passo do relógio: entidades caçam quem está na sua edificação; pegos voltam ao acampamento. */
function tickWorld(state, now) {
  const dt = Math.min(0.75, Math.max(0, (now - state.lastTick) / 1000));
  state.lastTick = now;
  for (const p of state.players)
    if (!p.left && !p.alive && now >= p.respawnAt) {
      p.alive = true;
      p.protectedUntil = now + 5000;
      p.bag = [];
      moveTo(p, 'camp', CAMP_SPAWN, now);
    }
  for (const [id, zone] of Object.entries(state.zones)) {
    const enemy = zone.enemy,
      hunted = state.players.filter(p => !p.left && p.alive && p.zone === id);
    if (!enemy.dead && (enemy.burnUntil || 0) > now)
      damageEnemy(state, id, FIRE.primary.burnDps * dt, now);
    if (enemy.dead && now >= enemy.respawnAt) {
      const far = c => Math.min(Infinity, ...hunted.map(p => distance(p, c))),
        cells = [zone.world.enemy, ...zone.world.coins],
        spot = cells.reduce((best, c) => (far(c) > far(best) ? c : best), cells[0]);
      Object.assign(enemy, { x: spot.x, y: spot.y, hp: ENEMY_HP, dead: false, path: [] });
    }
    if (enemy.dead || !hunted.length || now - zone.busySince < ENTER_GRACE_MS) continue;
    if (!enemy.path?.length || !enemy.pathAt || now - enemy.pathAt > 1000) {
      const paths = hunted
        .map(p =>
          findRoute(
            zone.world.grid,
            Math.floor(enemy.x),
            Math.floor(enemy.y),
            Math.floor(p.x),
            Math.floor(p.y),
          ),
        )
        .filter(r => r.length)
        .sort((a, b) => a.length - b.length);
      enemy.path = paths[0]?.slice(1) || [];
      enemy.pathAt = now;
    }
    let remaining = dt * 0.9;
    while (remaining > 0 && enemy.path.length) {
      const [tx, ty] = enemy.path[0],
        dx = tx + 0.5 - enemy.x,
        dy = ty + 0.5 - enemy.y,
        d = Math.hypot(dx, dy);
      if (d < 0.001) {
        enemy.path.shift();
        continue;
      }
      const step = Math.min(d, remaining);
      enemy.x += (dx / d) * step;
      enemy.y += (dy / d) * step;
      remaining -= step;
      if (step === d) enemy.path.shift();
    }
    for (const p of hunted)
      if (now >= p.protectedUntil && distance(p, enemy) < 0.43) catchPlayer(state, p, now);
  }
}

/** O que um jogador vê: a zona onde está, a equipe (nomes e onde cada um anda) e a mochila. */
function viewFor(state, playerId, now) {
  const me = state.players.find(p => p.id === playerId),
    zoneId = me?.zone || 'camp',
    zone = zoneId === 'camp' ? null : state.zones[zoneId],
    loot = lootOf(state, zoneId);
  return {
    code: state.code,
    status: state.status,
    now,
    startedAt: state.startedAt,
    zone: zoneId,
    level: zone ? state.camp.buildings.find(b => b.id === zoneId).level : null,
    seed: state.seed,
    balance: state.balance,
    me: me && {
      id: me.id,
      alive: me.alive,
      respawnIn: me.alive ? 0 : Math.max(0, me.respawnAt - now),
      x: me.x,
      y: me.y,
      bag: me.bag,
      carrying: me.carrying.length,
      armLevel: me.armLevel || 1,
      leaving: me.leaving ? now - me.leaving : 0,
      left: me.left,
    },
    team: state.players.map(p => ({
      id: p.id,
      name: p.name,
      color: p.color,
      zone: p.zone,
      alive: p.alive,
      left: p.left,
    })),
    players: state.players
      .filter(p => !p.left && p.zone === zoneId && p.id !== playerId)
      .map(({ id, name, color, skin, x, y, a, alive }) => ({
        id,
        name,
        color,
        skin,
        x,
        y,
        a,
        alive,
      })),
    enemy: zone && {
      x: zone.enemy.x,
      y: zone.enemy.y,
      hp: zone.enemy.hp,
      dead: zone.enemy.dead,
      burning: (zone.enemy.burnUntil || 0) > now,
    },
    collectedCoins: zone ? zone.collectedCoins : [],
    loot: {
      piles: (loot.piles || []).filter(v => !v.salvaged).map(({ id, x, y }) => ({ id, x, y })),
      almonds: (loot.almonds || []).filter(v => !v.taken).map(({ id, x, y }) => ({ id, x, y })),
      cores: loot.cores,
      bags: loot.bags.map(({ id, owner, ownerName, x, y }) => ({ id, owner, ownerName, x, y })),
    },
    effects: state.effects.filter(e => e.zone === zoneId && now - e.at < 1000),
    messages: state.messages.slice(-8),
  };
}

export { createExpedition, stepWorld, tickWorld, viewFor };

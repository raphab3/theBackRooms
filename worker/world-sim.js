// Simulação do mundo aberto (sem Durable Object, para testar direto): acampamento + edificações.
// Cada jogador está numa zona ('camp' ou o id de uma edificação) e só interage com ela.
import { almondSaveChance, damageMultiplier } from '@backrooms/shared/arms.js';
import {
  CAMP_SIZE,
  CAMP_SPAWN,
  DAY_MS,
  ENTER_GRACE_MS,
  FUEL_DRAIN,
  FUEL_MAX,
  GENERATOR_CENTER,
  GENERATOR_HP,
  GENERATOR_OFF_FAIL_MS,
  MONSTERS,
  NIGHT_MS,
  REFUEL_REACH,
  SCRAP_FUEL,
  SCRAP_REPAIR,
  WAVE_SPAWN_MS,
  safeRadius,
  waveSize,
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

const ACTIONS = [
  'hello',
  'sync',
  'use',
  'leave',
  'refuel',
  'shoot',
  'salvageStart',
  'salvage',
  'chat',
];
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
    campLoot: { bags: [], cores: [], drops: [] },
    clock: { phase: 'day', night: 0, endsAt: now + DAY_MS },
    generator: { fuel: FUEL_MAX, hp: GENERATOR_HP, offSince: 0 },
    monsters: [],
    spawnQueue: [],
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
  if (action === 'refuel') return refuel(state, p);
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
  if (p.zone === 'camp') return shootMonsters(state, p, body.a, kind, now);
  const zone = state.zones[p.zone],
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

// No acampamento o braço mira os monstros: o primário acerta o primeiro da linha; o carregado
// explode onde bater e acerta todos no raio.
function shootMonsters(state, p, a, kind, now) {
  const spec = FIRE[kind],
    grid = state.camp.grid,
    damage = spec.damage * damageMultiplier(p.armLevel || 1);
  let end = traceShot(grid, p, a, null, kind).end,
    first = null;
  for (const m of state.monsters) {
    const shot = traceShot(grid, p, a, m, 'primary');
    if (!shot.hit) continue;
    const d = distance(p, shot.end);
    if (!first || d < first.d) first = { m, d, end: shot.end };
  }
  if (first) end = first.end;
  const hits =
    kind === 'charged'
      ? state.monsters.filter(m => distance(m, end) <= spec.blast)
      : first
        ? [first.m]
        : [];
  for (const m of hits) hitMonster(state, m, damage, kind === 'primary' ? now + spec.burnMs : 0);
  state.effects = [
    ...state.effects.filter(e => now - e.at < 1000),
    {
      id: crypto.randomUUID(),
      zone: 'camp',
      by: p.id,
      kind,
      from: { x: p.x, y: p.y },
      to: end,
      hit: hits.length > 0,
      at: now,
    },
  ].slice(-20);
  return { hit: hits.length > 0 };
}
function hitMonster(state, m, damage, burnUntil) {
  m.hp -= damage;
  if (burnUntil) m.burnUntil = burnUntil;
  if (m.hp > 0) return;
  state.monsters = state.monsters.filter(v => v !== m);
  const spec = MONSTERS[m.type];
  state.campLoot.drops.push({
    id: crypto.randomUUID(),
    x: m.x,
    y: m.y,
    item: spec.drops,
    qty: spec.dropQty,
  });
}

// E perto do gerador: cada sucata vira combustível e conserto.
function refuel(state, p) {
  if (p.zone !== 'camp' || distance(p, GENERATOR_CENTER) > REFUEL_REACH)
    throw new ApiError('Chegue perto do gerador.');
  const g = state.generator;
  if (g.fuel >= FUEL_MAX && g.hp >= GENERATOR_HP) throw new ApiError('O gerador está cheio.');
  if (!removeItems(p.bag, 'scrap', 1))
    throw new ApiError('Traga sucata para abastecer o gerador.', 409);
  g.fuel = Math.min(FUEL_MAX, g.fuel + SCRAP_FUEL);
  g.hp = Math.min(GENERATOR_HP, g.hp + SCRAP_REPAIR);
  return { fuel: g.fuel, hp: g.hp };
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
  if (loot.drops)
    loot.drops = loot.drops.filter(
      drop => distance(p, drop) >= PICKUP_REACH || !addItems(p.bag, drop.item, drop.qty),
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
  if (state.status === 'playing') {
    tickClock(state, now);
    tickGenerator(state, now, dt);
    tickMonsters(state, now, dt);
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

// Dia → noite: chega uma onda espalhada no começo da noite. Noite → dia: os monstros fogem.
function tickClock(state, now) {
  const clock = state.clock;
  if (now < clock.endsAt) return;
  if (clock.phase === 'day') {
    clock.phase = 'night';
    clock.night++;
    clock.endsAt = now + NIGHT_MS;
    for (const [type, count] of Object.entries(waveSize(clock.night)))
      for (let i = 0; i < count; i++)
        state.spawnQueue.push({ type, at: now + Math.random() * WAVE_SPAWN_MS });
  } else {
    clock.phase = 'day';
    clock.endsAt = now + DAY_MS;
    state.monsters = [];
    state.spawnQueue = [];
  }
}

function tickGenerator(state, now, dt) {
  const g = state.generator;
  if (g.fuel > 0 && g.hp > 0) g.fuel = Math.max(0, g.fuel - FUEL_DRAIN[state.clock.phase] * dt);
  if (g.fuel > 0 && g.hp > 0) g.offSince = 0;
  else {
    g.offSince ||= now;
    // Apagado por tempo demais: a expedição fracassa e ninguém leva nada.
    if (now - g.offSince >= GENERATOR_OFF_FAIL_MS) {
      state.status = 'failed';
      for (const p of state.players) Object.assign(p, { left: true, bag: [], carrying: [] });
    }
  }
}

// Ponto de entrada de um monstro: uma célula aberta colada na cerca, num lado sorteado.
function edgeSpawn(grid) {
  for (let i = 0; i < 40; i++) {
    const t = 1 + Math.floor(Math.random() * (CAMP_SIZE - 2)),
      side = Math.floor(Math.random() * 4),
      [x, y] = [
        [t, 1],
        [t, CAMP_SIZE - 2],
        [1, t],
        [CAMP_SIZE - 2, t],
      ][side];
    if (grid[y][x] === 0) return { x: x + 0.5, y: y + 0.5 };
  }
  return { x: 1.5, y: 1.5 };
}

function tickMonsters(state, now, dt) {
  const grid = state.camp.grid,
    g = state.generator,
    radius = safeRadius(g.fuel, g.fuel > 0 && g.hp > 0);
  state.spawnQueue = state.spawnQueue.filter(spawn => {
    if (now < spawn.at) return true;
    const spec = MONSTERS[spawn.type];
    state.monsters.push({
      id: crypto.randomUUID(),
      type: spawn.type,
      ...edgeSpawn(grid),
      hp: spec.hp,
      path: [],
      pathAt: 0,
    });
    return false;
  });
  const campers = state.players.filter(p => !p.left && p.alive && p.zone === 'camp');
  for (const m of [...state.monsters]) {
    const spec = MONSTERS[m.type];
    if ((m.burnUntil || 0) > now) hitMonster(state, m, FIRE.primary.burnDps * dt, 0);
    if (m.hp <= 0) continue;
    // Monstro de sucata vai no gerador. Aparição caça quem está fora da luz; sem ninguém fora,
    // ronda a borda da área segura.
    let target = GENERATOR_CENTER;
    if (m.type === 'apparition') {
      const prey = campers
        .filter(p => now >= p.protectedUntil && distance(p, GENERATOR_CENTER) > radius)
        .sort((a, b) => distance(a, m) - distance(b, m))[0];
      if (prey) target = prey;
      else {
        const d = distance(m, GENERATOR_CENTER) || 1;
        target = {
          x: GENERATOR_CENTER.x + ((m.x - GENERATOR_CENTER.x) / d) * (radius + 1.5),
          y: GENERATOR_CENTER.y + ((m.y - GENERATOR_CENTER.y) / d) * (radius + 1.5),
        };
      }
    }
    if (now - m.pathAt > 1000) {
      const route = findRoute(
        grid,
        Math.floor(m.x),
        Math.floor(m.y),
        Math.floor(target.x),
        Math.floor(target.y),
      );
      m.path = route.slice(1);
      m.pathAt = now;
    }
    let remaining = dt * spec.speed;
    while (remaining > 0 && m.path.length) {
      const [tx, ty] = m.path[0],
        dx = tx + 0.5 - m.x,
        dy = ty + 0.5 - m.y,
        d = Math.hypot(dx, dy);
      if (d < 0.001) {
        m.path.shift();
        continue;
      }
      const step = Math.min(d, remaining);
      m.x += (dx / d) * step;
      m.y += (dy / d) * step;
      remaining -= step;
      if (step === d) m.path.shift();
    }
    if (m.type === 'scrap' && distance(m, GENERATOR_CENTER) <= 1.8 && g.hp > 0)
      g.hp = Math.max(0, g.hp - spec.biteDps * dt);
    if (m.type === 'apparition')
      for (const p of campers)
        if (
          now >= p.protectedUntil &&
          distance(p, m) < 0.5 &&
          distance(p, GENERATOR_CENTER) > radius
        )
          catchPlayer(state, p, now);
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
      drops: loot.drops || [],
    },
    clock: {
      phase: state.clock.phase,
      night: state.clock.night,
      endsIn: Math.max(0, state.clock.endsAt - now),
    },
    generator: {
      fuel: state.generator.fuel,
      hp: state.generator.hp,
      on: state.generator.fuel > 0 && state.generator.hp > 0,
      offFor: state.generator.offSince ? now - state.generator.offSince : 0,
      safeRadius: safeRadius(
        state.generator.fuel,
        state.generator.fuel > 0 && state.generator.hp > 0,
      ),
    },
    monsters:
      zoneId === 'camp'
        ? state.monsters.map(({ id, type, x, y, hp }) => ({
            id,
            type,
            x,
            y,
            hp,
            maxHp: MONSTERS[type].hp,
          }))
        : [],
    effects: state.effects.filter(e => e.zone === zoneId && now - e.at < 1000),
    messages: state.messages.slice(-8),
  };
}

export { createExpedition, stepWorld, tickWorld, viewFor };

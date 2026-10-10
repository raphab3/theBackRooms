import { describe, expect, it } from 'vitest';
import { ENEMY_HP, ENEMY_RESPAWN_MS, FIRE, traceShot } from '@backrooms/shared/combat.js';
import { createWorld } from '@backrooms/shared/world.js';
import { newPlayer } from '../worker/players.js';
import { stepRoom } from '../worker/room-actions.js';
import { beginPhase, tickRoom } from '../worker/rooms.js';

// Corredor reto de teste: linha 1 aberta de x=1 a x=9, o resto parede.
const grid = Array.from({ length: 5 }, (_, y) =>
  Array.from({ length: 12 }, (_, x) => (y === 1 && x >= 1 && x <= 9 ? 0 : 1)),
);

describe('traceShot', () => {
  it('primário acerta quem está no caminho', () => {
    const shot = traceShot(grid, { x: 1.5, y: 1.5 }, 0, { x: 5.5, y: 1.5 }, 'primary');
    expect(shot.hit).toBe(true);
    expect(shot.end.x).toBeCloseTo(5.5, 1);
  });
  it('primário erra quem está fora da linha e para na parede', () => {
    const shot = traceShot(grid, { x: 1.5, y: 1.5 }, 0, { x: 5.5, y: 2.5 }, 'primary');
    expect(shot.hit).toBe(false);
    expect(shot.end.x).toBeLessThan(10);
  });
  it('a parede protege o alvo atrás dela', () => {
    expect(traceShot(grid, { x: 1.5, y: 1.5 }, 0, { x: 11.5, y: 1.5 }, 'primary').hit).toBe(false);
  });
  it('carregado explode na parede e acerta quem está perto', () => {
    const shot = traceShot(grid, { x: 1.5, y: 1.5 }, 0, { x: 9.5, y: 2.2 }, 'charged');
    expect(shot.hit).toBe(true);
  });
});

// Sala de verdade, criada como o portal cria, com o jogador e a entidade alinhados num corredor.
function roomWithEnemyAhead() {
  const world = createWorld(123, 'backrooms'),
    now = 1_000_000,
    p = newPlayer('Rafa', now),
    room = {
      code: 'TESTE1',
      seed: 123,
      level: 'backrooms',
      mode: 'normal',
      campaign: false,
      world,
      coinRespawns: {},
      players: [p],
      host: p.id,
      status: 'lobby',
      round: 0,
      started: 0,
      lastTick: now,
      balance: 0,
      collectedCoins: [],
      fuses: world.fuses.map(() => false),
      enemy: { ...world.enemy },
    };
  beginPhase(room, now);
  // beginPhase sorteia um labirinto novo: procura o corredor no da sala.
  const grid = room.world.grid;
  // Acha uma direção aberta a partir do spawn e põe a entidade 1,5 célula à frente.
  const dirs = [
      [1, 0, 0],
      [0, 1, Math.PI / 2],
    ],
    [dx, dy, a] = dirs.find(
      ([dx, dy]) => grid[1 + dy][1 + dx] === 0 && grid[1 + 2 * dy][1 + 2 * dx] === 0,
    );
  Object.assign(room.enemy, { x: 1.5 + dx * 1.5, y: 1.5 + dy * 1.5 });
  return { room, p, a, now };
}
const auth = p => ({ id: p.id, token: p.token });

describe('ação shoot', () => {
  it('acerta, queima, respeita a recarga e mata em 10 tiros', () => {
    const { room, p, a, now } = roomWithEnemyAhead();
    expect(stepRoom(room, 'shoot', { ...auth(p), a }, now).hit).toBe(true);
    expect(room.enemy.hp).toBe(ENEMY_HP - FIRE.primary.damage);
    expect(room.enemy.burnUntil).toBe(now + FIRE.primary.burnMs);
    // Antes da recarga: ignorado, sem dano do tiro (só a queimadura de 0,1 s).
    expect(stepRoom(room, 'shoot', { ...auth(p), a }, now + 100)).toEqual({
      hit: false,
      cooldown: true,
    });
    expect(room.enemy.hp).toBeCloseTo(
      ENEMY_HP - FIRE.primary.damage - FIRE.primary.burnDps * 0.1,
      5,
    );
    let t = now;
    while (!room.enemy.dead)
      stepRoom(room, 'shoot', { ...auth(p), a }, (t += FIRE.primary.cooldownMs));
    expect(room.enemy.hp).toBe(0);
    expect(room.effects.length).toBeGreaterThan(0);
  });

  it('entidade morta não pega ninguém e reaparece longe depois de 30 s', () => {
    const { room, p, now } = roomWithEnemyAhead();
    Object.assign(room.enemy, {
      dead: true,
      hp: 0,
      respawnAt: now + ENEMY_RESPAWN_MS,
      x: p.x,
      y: p.y,
    });
    room.started = now - 60000; // já passou o tempo de graça do início
    room.lastTick = now;
    tickRoom(room, now + 1000);
    expect(p.alive).toBe(true);
    p.seen = now + ENEMY_RESPAWN_MS; // continua na sala (a sala só anda com alguém presente)
    tickRoom(room, now + ENEMY_RESPAWN_MS + 1);
    expect(room.enemy.dead).toBe(false);
    expect(room.enemy.hp).toBe(ENEMY_HP);
    expect(Math.hypot(room.enemy.x - p.x, room.enemy.y - p.y)).toBeGreaterThan(3);
  });

  it('quem foi pego não atira', () => {
    const { room, p, a, now } = roomWithEnemyAhead();
    p.alive = false;
    expect(() => stepRoom(room, 'shoot', { ...auth(p), a }, now)).toThrow('pego');
  });
});

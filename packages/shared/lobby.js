// Lobby 3D (Posto Zero): layout e regras do portal, compartilhados entre cliente e servidor.
// Coordenadas em metros; o chão é o plano XZ, com +Z apontando para a entrada do salão.

export const LOBBY_CAPACITY = 24;
export const LOBBY_BOUNDS = { minX: -17, maxX: 17, minZ: -13, maxZ: 13 };
export const LOBBY_SPAWN = { x: 0, z: 9 };
export const RUN_SPEED = 7.5; // m/s; o servidor tolera uma folga sobre isso
export const PORTAL_SLOTS = 4;
export const PORTAL_RADIUS = 1.6;
export const PORTAL_COUNTDOWN_MS = 20000;
export const PORTAL_FULL_MS = 3000;
export const PARTY_MAX = 4;
export const EMOTES = ['wave', 'point', 'dance'];
export const PORTALS = [
  { id: 'p1', x: -8, z: -10, level: 'backrooms' },
  { id: 'p2', x: 0, z: -10, level: 'backrooms' },
  { id: 'p3', x: 8, z: -10, level: 'backrooms' },
];

export function newPortals() {
  return PORTALS.map(p => ({ ...p, slots: Array(PORTAL_SLOTS).fill(null), endsAt: 0 }));
}

export function clampToLobby(x, z) {
  return {
    x: Math.min(LOBBY_BOUNDS.maxX, Math.max(LOBBY_BOUNDS.minX, x)),
    z: Math.min(LOBBY_BOUNDS.maxZ, Math.max(LOBBY_BOUNDS.minZ, z)),
  };
}

const onPad = (portal, p) => Math.hypot(p.x - portal.x, p.z - portal.z) <= PORTAL_RADIUS;

/**
 * Avança os portais um passo. `players` é um Map id → {x, z}; `parties` é um Map id → {leader,
 * members}. Quem está num grupo só entra junto com o grupo, puxado pelo líder: o líder pisa na
 * plataforma e todos os membros presentes ocupam vagas, se couberem. Sem espaço, ninguém entra.
 * Devolve os portais que dispararam ({portal, level, ids}) e avisos para jogadores ({id, text}).
 */
export function stepPortals(portals, players, parties, now) {
  const fired = [],
    notices = [],
    seated = new Set(portals.flatMap(p => p.slots.filter(Boolean)));
  const partyOf = id => [...parties.values()].find(g => g.members.includes(id));
  for (const portal of portals) {
    // Sai quem deixou a plataforma (no grupo, quem conta é o líder) ou saiu do lobby.
    for (let i = 0; i < portal.slots.length; i++) {
      const id = portal.slots[i];
      if (!id) continue;
      const party = partyOf(id),
        anchor = players.get(party ? party.leader : id);
      if (!players.has(id) || !anchor || !onPad(portal, anchor)) {
        portal.slots[i] = null;
        seated.delete(id);
      }
    }
    // Entra quem pisou na plataforma, na ordem em que estão no Map (ordem de chegada ao lobby).
    for (const [id, p] of players) {
      if (seated.has(id) || !onPad(portal, p)) continue;
      const party = partyOf(id);
      if (party && party.leader !== id) continue;
      const group = party ? party.members.filter(m => players.has(m) && !seated.has(m)) : [id],
        free = portal.slots.filter(s => !s).length;
      if (group.length > free) {
        notices.push({ id, text: 'Sem espaço para o grupo inteiro neste portal.' });
        continue;
      }
      for (const m of group) {
        portal.slots[portal.slots.indexOf(null)] = m;
        seated.add(m);
      }
    }
    const count = portal.slots.filter(Boolean).length;
    if (!count) portal.endsAt = 0;
    else {
      if (!portal.endsAt) portal.endsAt = now + PORTAL_COUNTDOWN_MS;
      if (count === PORTAL_SLOTS) portal.endsAt = Math.min(portal.endsAt, now + PORTAL_FULL_MS);
      if (now >= portal.endsAt) {
        fired.push({ portal: portal.id, level: portal.level, ids: portal.slots.filter(Boolean) });
        portal.slots.fill(null);
        portal.endsAt = 0;
      }
    }
  }
  return { fired, notices };
}

import { ApiError } from './http.js';

function adminName(name) {
  return name?.trim().toLowerCase() === 'lucca416453416453admin';
}
function nameOf(body) {
  let name = typeof body.name === 'string' ? body.name.trim().replace(/[\x00-\x1f\x7f]/g, '') : '';
  if (name.length < 1 || name.length > 32)
    throw new ApiError('Escreva um nome com até 32 caracteres.');
  return name;
}
const colors = ['#ddbc45', '#58b7c8', '#dc7958', '#a58ad5'];
function newPlayer(name, now, existing = []) {
  return {
    id: crypto.randomUUID(),
    token: crypto.randomUUID() + crypto.randomUUID(),
    name,
    color: colors.find(c => !existing.some(p => p.color === c)) || colors[0],
    x: 1.5,
    y: 1.5,
    a: 0,
    alive: true,
    seen: now,
    seq: 0,
  };
}
function authorize(room, body) {
  const p = room.players.find(p => p.id === body.id && p.token === body.token);
  if (!p) throw new ApiError('Sua sessão da sala expirou. Entre novamente.', 401);
  return p;
}

export { adminName, authorize, colors, nameOf, newPlayer };

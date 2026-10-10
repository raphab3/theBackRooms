// API do painel admin (/api/admin/*). Toda rota exige o JWT do Cloudflare Access.
import { ApiError } from './http.js';
import { ACTIVE_MS, TTL, validatedLevel } from './rooms.js';

const b64 = text =>
  Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const part = text => JSON.parse(new TextDecoder().decode(b64(text)));
let certs = { at: 0, keys: null };

// Chaves públicas do Access: ACCESS_JWKS (JSON, útil em testes/local) ou o endpoint do team domain.
async function accessKeys(env) {
  if (env.ACCESS_JWKS) return JSON.parse(env.ACCESS_JWKS).keys;
  if (certs.keys && Date.now() - certs.at < 600000) return certs.keys;
  const response = await fetch(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error('certs');
  certs = { at: Date.now(), keys: (await response.json()).keys };
  return certs.keys;
}

async function verifyAccess(request, env) {
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return false;
  const [head, body, signature, extra] = token.split('.');
  if (!signature || extra !== undefined) return false;
  const header = part(head),
    claims = part(body);
  if (header.alg !== 'RS256') return false;
  const jwk = (await accessKeys(env)).find(k => k.kid === header.kid && k.kty === 'RSA');
  if (!jwk) return false;
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64(signature),
    new TextEncoder().encode(head + '.' + body),
  );
  const now = Date.now() / 1000,
    aud = [].concat(claims.aud);
  return (
    valid &&
    claims.iss === `https://${env.ACCESS_TEAM_DOMAIN}` &&
    aud.includes(env.ACCESS_AUD) &&
    typeof claims.exp === 'number' &&
    claims.exp > now &&
    (claims.nbf === undefined || claims.nbf <= now)
  );
}

async function requireAccess(request, env) {
  const ok = await verifyAccess(request, env).catch(() => false);
  if (!ok) throw new ApiError('Acesso negado.', 403);
}

const profileOf = name => name.normalize('NFKC').toLocaleLowerCase('pt-BR');
const roomCode = body => {
  const code = typeof body.code === 'string' ? body.code.toUpperCase().trim() : '';
  if (!/^[A-Z2-9]{6}$/.test(code)) throw new ApiError('Código de sala inválido.');
  return code;
};

// `rooms.state(code)` lê a sala no Durable Object; `rooms.admin(code, action, body)` altera.
async function adminApi(db, action, body, rooms) {
  const now = Date.now();
  if (action === 'rooms') {
    const rows = await db
      .prepare('SELECT code FROM rooms WHERE updated_at>? ORDER BY updated_at DESC LIMIT 100')
      .bind(now - TTL)
      .all();
    const states = await Promise.all(
      rows.results.map(row => rooms.state(row.code).catch(() => null)),
    );
    return {
      rooms: states
        .filter(r => r?.players.some(p => now - p.seen < ACTIVE_MS))
        .map(r => ({
          code: r.code,
          level: r.level,
          status: r.status,
          mode: r.mode,
          adminUsed: !!r.adminUsed,
          players: r.players.map(p => p.name),
        })),
    };
  }
  if (action === 'level') {
    const level = body.level === 'lurking' ? 'lurking' : validatedLevel(body.level);
    return rooms.admin(roomCode(body), 'level', { level });
  }
  if (action === 'chat') {
    const global = await db
      .prepare('SELECT id,name,text,created FROM chat_messages ORDER BY id DESC LIMIT 50')
      .bind()
      .all();
    const room = body.code ? (await rooms.state(roomCode(body))).messages || [] : [];
    return { global: global.results, room };
  }
  if (action === 'chat-delete') {
    if (body.scope === 'room') await rooms.admin(roomCode(body), 'chat-delete', { id: body.id });
    else if (Number.isSafeInteger(body.id))
      await db.prepare('DELETE FROM chat_messages WHERE id=?').bind(body.id).run();
    else throw new ApiError('Mensagem inválida.');
    return {};
  }
  if (action === 'maps') {
    const rows = await db
      .prepare(
        "SELECT id,author,published_data IS NOT NULL AS published,json_extract(data,'$.title') AS title FROM custom_maps ORDER BY updated_at DESC LIMIT 100",
      )
      .bind()
      .all();
    return { maps: rows.results };
  }
  if (action === 'map-unpublish' || action === 'map-delete') {
    if (typeof body.id !== 'string') throw new ApiError('Mapa inválido.');
    const sql =
      action === 'map-delete'
        ? 'DELETE FROM custom_maps WHERE id=?'
        : 'UPDATE custom_maps SET published_data=NULL,updated_at=? WHERE id=?';
    const result = await db
      .prepare(sql)
      .bind(...(action === 'map-delete' ? [body.id] : [now, body.id]))
      .run();
    if (!result.meta.changes) throw new ApiError('Mapa não encontrado.', 404);
    return {};
  }
  if (action === 'coins') {
    if (typeof body.name !== 'string' || !body.name.trim()) throw new ApiError('Nome inválido.');
    if (!Number.isSafeInteger(body.coins) || body.coins < 0 || body.coins > 1000000000)
      throw new ApiError('Quantidade de moedas inválida.');
    await db
      .prepare(
        "INSERT INTO explorer_missions(profile,key,value) VALUES(?,'coins',?) ON CONFLICT(profile,key) DO UPDATE SET value=excluded.value",
      )
      .bind(profileOf(body.name.trim()), body.coins)
      .run();
    return { coins: body.coins };
  }
  throw new ApiError('Ação não encontrada.', 404);
}

export { adminApi, requireAccess };

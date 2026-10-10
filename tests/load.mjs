// Teste de carga da Fase 0: N salas × M bots WebSocket contra um ambiente de preview.
// Uso: node tests/load.mjs https://<preview>.workers.dev [--rooms 10] [--bots 4] [--minutes 10] [--hz 20]
// Sai com código 1 se o RTT p95 passar de 100 ms ou houver erros de socket.
const args = process.argv.slice(2);
const base = args.find(a => /^https?:\/\//.test(a));
const opt = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
if (!base) {
  console.error(
    'Uso: node tests/load.mjs <url-do-preview> [--rooms 10] [--bots 4] [--minutes 10] [--hz 20]',
  );
  process.exit(2);
}
const ROOMS = opt('rooms', 10),
  BOTS = opt('bots', 4),
  DURATION_MS = opt('minutes', 10) * 60000,
  INTERVAL_MS = Math.round(1000 / opt('hz', 20)),
  RTT_P95_LIMIT = 100;

const origin = new URL(base).origin;
const rtts = [];
let sent = 0,
  socketErrors = 0,
  unexpectedCloses = 0,
  apiErrors = 0,
  stopping = false;

async function post(action, body) {
  const r = await fetch(`${origin}/api/rooms/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`${action}: ${r.status} ${data.error}`);
  return data;
}

function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

function connect(session, label) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${origin.replace(/^http/, 'ws')}/api/rooms/${session.code}/ws`);
    const pending = new Map();
    let seq = 0,
      timer = null;
    ws.addEventListener('open', () => {
      resolve(ws);
      timer = setInterval(() => {
        const reqId = ++seq;
        pending.set(reqId, performance.now());
        sent++;
        ws.send(JSON.stringify({ action: 'sync', reqId, ...session }));
        pending.delete(reqId - 200); // não acumula pedidos sem resposta
      }, INTERVAL_MS);
    });
    ws.addEventListener('message', ev => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === 'error') apiErrors++;
      const t0 = pending.get(msg.reqId);
      if (t0 !== undefined && (msg.type === 'result' || msg.type === 'error')) {
        rtts.push(performance.now() - t0);
        pending.delete(msg.reqId);
      }
    });
    ws.addEventListener('error', () => {
      socketErrors++;
      reject(new Error(`socket ${label}`));
    });
    ws.addEventListener('close', () => {
      clearInterval(timer);
      if (!stopping) unexpectedCloses++;
    });
    session.close = () => {
      clearInterval(timer);
      ws.close(1000);
    };
  });
}

async function runRoom(n) {
  const host = await post('create', { name: `Bot${n}-0`, mode: 'normal' });
  const code = host.room.code,
    sessions = [{ code, id: host.id, token: host.token }];
  for (let i = 1; i < BOTS; i++) {
    const p = await post('join', { code, name: `Bot${n}-${i}` });
    sessions.push({ code, id: p.id, token: p.token });
  }
  await Promise.all(sessions.map((s, i) => connect(s, `${code}#${i}`)));
  return sessions;
}

console.log(
  `Carga: ${ROOMS} salas × ${BOTS} bots, ${DURATION_MS / 60000} min, ${INTERVAL_MS} ms/sync → ${origin}`,
);
const all = [];
try {
  for (const s of await Promise.all(Array.from({ length: ROOMS }, (_, n) => runRoom(n))))
    all.push(...s);
} catch (error) {
  console.error('Falha ao montar as salas:', error.message);
  process.exit(1);
}
const report = setInterval(() => {
  const s = [...rtts].sort((a, b) => a - b);
  console.log(
    `[parcial] msgs=${rtts.length}/${sent} p50=${percentile(s, 50).toFixed(1)}ms p95=${percentile(s, 95).toFixed(1)}ms erros=${socketErrors}`,
  );
}, 30000);
await new Promise(r => setTimeout(r, DURATION_MS));
stopping = true;
clearInterval(report);
all.forEach(s => s.close?.());

const sorted = rtts.sort((a, b) => a - b);
const p95 = percentile(sorted, 95);
const summary = {
  rooms: ROOMS,
  bots: ROOMS * BOTS,
  sent,
  received: sorted.length,
  lost: sent - sorted.length,
  rttMs: { p50: percentile(sorted, 50), p95, p99: percentile(sorted, 99), max: sorted.at(-1) },
  socketErrors,
  unexpectedCloses,
  apiErrors,
};
console.log(JSON.stringify(summary, null, 2));
const ok = p95 < RTT_P95_LIMIT && socketErrors === 0 && unexpectedCloses === 0;
console.log(
  ok ? 'PASS: RTT p95 < 100 ms e sem erros de socket.' : 'FAIL: portão de RTT/erros não atingido.',
);
console.log(
  'Obs.: o RTT medido aqui inclui a rede de quem roda o script; rode de uma rede doméstica no Brasil.',
);
process.exit(ok ? 0 : 1);

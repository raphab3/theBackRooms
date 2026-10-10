// Teste de carga do lobby 3D: N bots num lobby privado andando a 20 Hz e conversando, medindo a
// cadência dos snapshots (o servidor manda a 10 Hz) e erros. Uso:
//   node tests/lobby-load.mjs [url=http://localhost:8789] [bots=24] [segundos=60]
const [url = 'http://localhost:8789', botsArg = '24', secondsArg = '60'] = process.argv.slice(2);
const BOTS = Number(botsArg),
  SECONDS = Number(secondsArg),
  origin = new URL(url).origin,
  wsBase = origin.replace(/^http/, 'ws');

async function post(path, body) {
  const r = await fetch(origin + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw Error(`${path}: ${data.error}`);
  return data;
}

function bot(key, i) {
  return new Promise(resolve => {
    const stats = { i, snaps: 0, gaps: [], errors: 0, corrections: 0, lastSnap: 0, players: 0 },
      ws = new WebSocket(
        `${wsBase}/api/lobby/${key}/ws?name=Bot${i}&skin=${'abcdefghijklmnopqr'[i % 18]}`,
      );
    let x = 0,
      z = 9,
      heading = Math.random() * Math.PI * 2,
      timer = null;
    ws.onmessage = event => {
      const m = JSON.parse(event.data),
        now = performance.now();
      if (m.t === 'snap') {
        if (stats.lastSnap) stats.gaps.push(now - stats.lastSnap);
        stats.lastSnap = now;
        stats.snaps++;
        stats.players = m.players.length;
        const me = m.players.find(p => p.name === `Bot${i}`);
        if (me && !stats.placed) {
          ({ x, z } = me);
          stats.placed = true;
        }
      } else if (m.t === 'correct') {
        stats.corrections++;
        ({ x, z } = m);
      } else if (m.t === 'error') {
        stats.errors++;
        console.log(`Bot${i} erro: ${m.error}`);
      }
    };
    ws.onerror = event => {
      stats.errors++;
      console.log(`Bot${i} erro de socket: ${event.message || event.type}`);
    };
    ws.onopen = () => {
      // Anda em linha reta a 3,6 m/s virando um pouco; quica nas bordas do salão.
      let chatAt = 0;
      timer = setInterval(() => {
        // Só anda depois de saber onde nasceu (o primeiro snapshot traz a posição).
        if (!stats.placed) return;
        heading += (Math.random() - 0.5) * 0.4;
        x += Math.sin(heading) * 0.18;
        z += Math.cos(heading) * 0.18;
        if (Math.abs(x) > 16 || Math.abs(z) > 12) heading += Math.PI;
        x = Math.max(-16.5, Math.min(16.5, x));
        z = Math.max(-12.5, Math.min(12.5, z));
        ws.send(JSON.stringify({ t: 'move', x, z, yaw: heading, anim: 'walk' }));
        // Chat de vez em quando, respeitando o limite do servidor (uma mensagem a cada 0,8 s).
        if (performance.now() - chatAt > 5000 && Math.random() < 0.01) {
          chatAt = performance.now();
          ws.send(JSON.stringify({ t: 'chat', text: `oi do bot ${i}` }));
        }
      }, 50);
    };
    setTimeout(() => {
      clearInterval(timer);
      ws.close();
      resolve(stats);
    }, SECONDS * 1000);
  });
}

const { key, code } = await post('/api/lobby/private', { name: 'Carga' });
console.log(`lobby ${code}: ${BOTS} bots por ${SECONDS} s em ${origin}`);
const results = await Promise.all(Array.from({ length: BOTS }, (_, i) => bot(key, i)));
const gaps = results.flatMap(r => r.gaps).sort((a, b) => a - b),
  pct = p => gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))] ?? NaN,
  rate = results.reduce((a, r) => a + r.snaps, 0) / results.length / SECONDS;
console.log(
  [
    `snapshots por bot  ${rate.toFixed(1)}/s (esperado 10)`,
    `intervalo p50      ${pct(0.5).toFixed(0)} ms`,
    `intervalo p95      ${pct(0.95).toFixed(0)} ms`,
    `intervalo p99      ${pct(0.99).toFixed(0)} ms`,
    `maior intervalo    ${gaps.at(-1)?.toFixed(0)} ms`,
    `jogadores vistos   ${Math.min(...results.map(r => r.players))}–${Math.max(...results.map(r => r.players))}`,
    `correções          ${results.reduce((a, r) => a + r.corrections, 0)}`,
    `erros              ${results.reduce((a, r) => a + r.errors, 0)}`,
  ].join('\n'),
);
const ok = rate > 9 && pct(0.95) < 200 && results.every(r => r.errors === 0);
console.log(ok ? 'OK' : 'FALHOU');
process.exit(ok ? 0 : 1);

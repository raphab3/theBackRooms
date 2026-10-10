// Telemetria da Fase 0 (Workers Analytics Engine, binding TELEMETRY). Sem o binding, tudo vira no-op.
// Schema: index1 = código da sala; blob1 = evento; double1 = valor.
//   rtt       double1 = RTT em ms informado pelo cliente (blob2 = id do jogador)
//   tick      double1 = duração do tick do DO em ms
//   players   double1 = jogadores conectados na sala
//   socket_error  blob2 = motivo
const EVENTS = ['rtt', 'tick', 'players', 'socket_error'];
const MAX_RTT = 60000;

function track(env, event, code, value = 0, detail = '') {
  if (!EVENTS.includes(event)) return;
  try {
    env?.TELEMETRY?.writeDataPoint({
      indexes: [String(code || '-')],
      blobs: [event, String(detail).slice(0, 64)],
      doubles: [Number.isFinite(value) ? value : 0],
    });
  } catch {
    // telemetria nunca derruba o jogo
  }
}

// Valor vindo do cliente: só aceita número finito dentro de uma faixa plausível.
function recordRtt(env, code, playerId, rtt) {
  const ms = Number(rtt);
  if (Number.isFinite(ms) && ms >= 0 && ms <= MAX_RTT) track(env, 'rtt', code, ms, playerId);
}

// Mede a duração de fn (um tick do DO) e registra. Devolve o resultado de fn.
function timeTick(env, code, fn) {
  const start = performance.now();
  try {
    return fn();
  } finally {
    track(env, 'tick', code, performance.now() - start);
  }
}

const recordPlayers = (env, code, count) => track(env, 'players', code, count);
const recordSocketError = (env, code, reason) => track(env, 'socket_error', code, 1, reason);

export { EVENTS, recordPlayers, recordRtt, recordSocketError, timeTick, track };

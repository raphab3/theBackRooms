import assert from 'node:assert/strict';
import { PredictionHistory, SnapshotBuffer, reconnectDelay } from '../public/js/netsync.js';

assert.deepEqual([0, 1, 2, 3, 4, 9].map(reconnectDelay), [1000, 2000, 4000, 10000, 10000, 10000]);

// Interpolação ~100 ms no passado, entre dois snapshots de 50 ms.
const buffer = new SnapshotBuffer();
buffer.push(1000, [{ id: 'a', x: 1, y: 1, a: 0 }]);
buffer.push(1050, [{ id: 'a', x: 2, y: 1, a: 0 }]);
buffer.push(1100, [{ id: 'a', x: 3, y: 1, a: 0 }]);
assert.equal(buffer.sample('a', 1125).x, 1.5); // rende em 1025: metade do 1º segmento
assert.equal(buffer.sample('a', 1175).x, 2.5);
assert.equal(buffer.sample('a', 5000).x, 3); // sem snapshot novo: segura o último
assert.equal(buffer.sample('b', 1125), null);
// Sem saltos: passos de render pequenos geram passos pequenos.
let previous = buffer.sample('a', 1100).x;
for (let t = 1101; t <= 1200; t++) {
  const x = buffer.sample('a', t).x;
  assert.ok(Math.abs(x - previous) < 0.03, 'salto visível em ' + t);
  previous = x;
}
// Teleporte (> 2 células) não desliza pelo mapa.
const teleport = new SnapshotBuffer();
teleport.push(0, [{ id: 'a', x: 1, y: 1, a: 0 }]);
teleport.push(50, [{ id: 'a', x: 10, y: 1, a: 0 }]);
assert.equal(teleport.sample('a', 125).x, 1);
assert.equal(teleport.sample('a', 160).x, 10);
// Ângulo pelo caminho curto.
const turn = new SnapshotBuffer();
turn.push(0, [{ id: 'a', x: 1, y: 1, a: 3.0 }]);
turn.push(100, [{ id: 'a', x: 1, y: 1, a: -3.0 }]);
const mid = turn.sample('a', 150).a;
assert.ok(Math.abs(Math.abs(mid) - Math.PI) < 0.2);
// Buffer não cresce sem limite.
for (let t = 2000; t < 12000; t += 50) buffer.push(t, [{ id: 'a', x: 3, y: 1, a: 0 }]);
assert.ok(buffer.frames.length <= 25);

// Predição: só diverge se nenhuma posição recente do cliente chegar perto do servidor.
const history = new PredictionHistory();
assert.equal(history.diverged(9, 9), false);
for (let i = 0; i <= 10; i++) history.record(i * 33, 1 + i * 0.1, 1);
assert.equal(history.diverged(1.0, 1), false); // servidor atrasado, no começo do caminho
assert.equal(history.diverged(2.2, 1), false);
assert.equal(history.diverged(2.6, 1), true); // > 0,5 célula do ponto mais próximo
history.clear();
assert.equal(history.diverged(9, 9), false);

console.log(
  'PASS: backoff 1/2/4/10 s, interpolation without jumps, teleport and angle handling, prediction divergence threshold.',
);

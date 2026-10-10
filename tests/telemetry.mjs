import assert from 'node:assert/strict';
import {
  recordPlayers,
  recordRtt,
  recordSocketError,
  timeTick,
  track,
} from '../worker/telemetry.js';

const points = [];
const env = { TELEMETRY: { writeDataPoint: p => points.push(p) } };
recordRtt(env, 'ABC234', 'p1', 42);
recordRtt(env, 'ABC234', 'p1', -5);
recordRtt(env, 'ABC234', 'p1', 'x');
recordPlayers(env, 'ABC234', 3);
recordSocketError(env, 'ABC234', 'reset');
assert.equal(
  timeTick(env, 'ABC234', () => 7),
  7,
);
track(env, 'inválido', 'ABC234', 1);
assert.deepEqual(
  points.map(p => p.blobs[0]),
  ['rtt', 'players', 'socket_error', 'tick'],
);
assert.deepEqual(points[0], { indexes: ['ABC234'], blobs: ['rtt', 'p1'], doubles: [42] });
recordRtt({}, 'X', 'p', 1); // sem binding: no-op
assert.throws(
  () =>
    timeTick({}, 'X', () => {
      throw new Error('boom');
    }),
  /boom/,
);
console.log('PASS: telemetria grava eventos válidos, ignora RTT inválido e é no-op sem binding.');

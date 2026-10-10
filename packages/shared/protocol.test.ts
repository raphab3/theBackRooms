import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_CLIENT_MESSAGE,
  PROTOCOL_VERSION,
  decodeClientMessage,
  decodeServerMessage,
  encode,
  type ClientMessage,
  type ServerMessage,
} from './protocol.ts';

const raw = (o: unknown) => JSON.stringify(o);
const input = { t: 'input', seq: 3, dx: 0.5, dy: -1, a: 1.2, run: true, light: false };
const room = {
  code: 'ABC234',
  level: 'backrooms',
  mode: 'normal',
  campaign: true,
  campaignStarted: 0,
  adminUsed: false,
  seed: 123,
  host: 'p1',
  status: 'lobby',
  round: 0,
  started: 0,
  finished: 0,
  now: 1700000000000,
  fuses: [false, true],
  balance: 10,
  collectedCoins: [1, 4],
  enemy: { x: 10.5, y: 3.5 },
  smile: null,
  players: [
    { id: 'p1', name: 'Ana', color: '#ff0', x: 1.5, y: 1.5, a: 0, alive: true, respawns: 0 },
  ],
  messages: [{ id: 'm1', sender: 'p1', name: 'Ana', color: '#ff0', text: 'oi', at: 1 }],
  capacity: 4,
};
const snapshot = {
  t: 'snapshot',
  tick: 42,
  players: [{ id: 'p1', x: 2, y: 3, a: 1, anim: 'walk', alive: true }],
  enemy: { x: 5, y: 5 },
  smile: { x: 6, y: 6 },
  fuses: [true],
  coins: { balance: 3, collected: [0] },
};

function okClient(o: unknown) {
  const r = decodeClientMessage(raw(o));
  assert.ok(r.ok, r.ok ? '' : r.error);
  return r.msg;
}
function badClient(o: unknown, field: string, code = 'invalid') {
  const r = decodeClientMessage(typeof o === 'string' ? o : raw(o));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.code, code);
    assert.match(r.error, new RegExp(field.replace(/[[\]]/g, '\\$&')));
  }
}
function okServer(o: unknown) {
  const r = decodeServerMessage(raw(o));
  assert.ok(r.ok, r.ok ? '' : r.error);
  return r.msg;
}
function badServer(o: unknown, field: string) {
  const r = decodeServerMessage(raw(o));
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, new RegExp(field.replace(/[[\]]/g, '\\$&')));
}

test('cliente: mensagens válidas', () => {
  assert.deepEqual(okClient({ t: 'hello', v: PROTOCOL_VERSION, token: 'abc' }), {
    t: 'hello',
    v: PROTOCOL_VERSION,
    token: 'abc',
  });
  assert.deepEqual(okClient(input), input);
  for (const kind of ['start', 'revive', 'leave'])
    assert.deepEqual(okClient({ t: 'action', kind }), { t: 'action', kind });
  assert.deepEqual(okClient({ t: 'action', kind: 'level', level: 'poolrooms' }), {
    t: 'action',
    kind: 'level',
    level: 'poolrooms',
  });
  assert.deepEqual(okClient({ t: 'action', kind: 'mode', mode: 'hardcore' }), {
    t: 'action',
    kind: 'mode',
    mode: 'hardcore',
  });
  const chat = { t: 'action', kind: 'chat', text: 'socorro', messageId: 'abcd-1234' };
  assert.deepEqual(okClient(chat), chat);
});

test('cliente: campos extras são descartados', () => {
  assert.deepEqual(okClient({ ...input, admin: true }), input);
});

test('hello com versão diferente é recusado com mensagem clara', () => {
  const r = decodeClientMessage(raw({ t: 'hello', v: PROTOCOL_VERSION + 1, token: 'abc' }));
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.code, 'version');
    assert.match(r.error, /Versão do jogo incompatível/);
    assert.match(r.error, /Atualize a página/);
  }
  badClient({ t: 'hello', token: 'abc' }, 'v');
});

test('cliente: campos faltando', () => {
  badClient({ t: 'hello', v: PROTOCOL_VERSION }, 'token');
  for (const key of Object.keys(input).filter(k => k !== 't')) {
    const copy: Record<string, unknown> = { ...input };
    delete copy[key];
    badClient(copy, key);
  }
  badClient({ t: 'action' }, 'kind');
  badClient({ t: 'action', kind: 'level' }, 'level');
  badClient({ t: 'action', kind: 'mode' }, 'mode');
  badClient({ t: 'action', kind: 'chat', text: 'oi' }, 'messageId');
});

test('cliente: valores fora de faixa ou de tipo errado', () => {
  badClient({ ...input, dx: 1.01 }, 'dx');
  badClient({ ...input, dy: -2 }, 'dy');
  badClient({ ...input, seq: -1 }, 'seq');
  badClient({ ...input, seq: 1.5 }, 'seq');
  badClient({ ...input, a: 1e9 }, 'a');
  badClient({ ...input, run: 'sim' }, 'run');
  badClient({ ...input, light: 1 }, 'light');
  badClient('{"t":"input","seq":1,"dx":NaN}', 'mensagem');
  badClient({ t: 'hello', v: PROTOCOL_VERSION, token: '' }, 'token');
  badClient({ t: 'action', kind: 'fly' }, 'kind');
  badClient({ t: 'action', kind: 'mode', mode: 'easy' }, 'mode');
  badClient({ t: 'action', kind: 'level', level: '../etc' }, 'level');
  badClient({ t: 'action', kind: 'chat', text: '   ', messageId: 'abcd-1234' }, 'text');
  badClient({ t: 'action', kind: 'chat', text: 'x'.repeat(241), messageId: 'abcd-1234' }, 'text');
  badClient({ t: 'action', kind: 'chat', text: 'oi', messageId: 'curto' }, 'messageId');
});

test('cliente: envelope inválido', () => {
  badClient({ t: 'welcome' }, 't');
  badClient({}, 't');
  badClient('não é json', 'mensagem');
  badClient('[1,2]', 'mensagem');
  badClient('null', 'mensagem');
  badClient(raw({ ...input, pad: 'x'.repeat(MAX_CLIENT_MESSAGE) }), 'mensagem');
  const r = decodeClientMessage(42);
  assert.equal(r.ok, false);
});

test('servidor: mensagens válidas', () => {
  const welcome = { t: 'welcome', v: PROTOCOL_VERSION, id: 'p1', room };
  assert.deepEqual(okServer(welcome), welcome);
  assert.deepEqual(okServer(snapshot), snapshot);
  const events = [
    { t: 'event', kind: 'coin', playerId: 'p1', coinId: 7, balance: 11 },
    { t: 'event', kind: 'death', playerId: 'p1' },
    { t: 'event', kind: 'phase', level: 'backrooms', status: 'won' },
    { t: 'event', kind: 'chat', message: room.messages[0] },
  ];
  for (const e of events) assert.deepEqual(okServer(e), e);
  const error = { t: 'error', code: 'version', message: 'Atualize a página.' };
  assert.deepEqual(okServer(error), error);
});

test('servidor: mensagens inválidas', () => {
  badServer({ t: 'welcome', v: PROTOCOL_VERSION, id: 'p1' }, 'room');
  badServer({ t: 'welcome', v: 1, id: 'p1', room: { ...room, status: 'paused' } }, 'room.status');
  badServer({ t: 'welcome', v: 1, id: 'p1', room: { ...room, code: 'abc' } }, 'room.code');
  const fivePlayers = Array(5).fill(room.players[0]);
  badServer({ t: 'welcome', v: 1, id: 'p1', room: { ...room, players: fivePlayers } }, 'players');
  badServer({ ...snapshot, tick: -1 }, 'tick');
  badServer({ ...snapshot, enemy: { x: 1 } }, 'enemy.y');
  badServer({ ...snapshot, players: [{ ...snapshot.players[0], anim: 'fly' }] }, 'players[0].anim');
  badServer({ ...snapshot, fuses: [1] }, 'fuses[0]');
  badServer({ ...snapshot, coins: { balance: 1 } }, 'collected');
  badServer({ t: 'event', kind: 'coin', playerId: 'p1', coinId: -1, balance: 0 }, 'coinId');
  badServer({ t: 'event', kind: 'boom' }, 'kind');
  badServer({ t: 'error', code: 'nope', message: 'x' }, 'code');
  badServer({ t: 'input' }, 't');
});

test('encode valida e serializa só campos do protocolo', () => {
  const msg: ClientMessage = { t: 'action', kind: 'mode', mode: 'normal' };
  assert.deepEqual(decodeClientMessage(encode(msg)), { ok: true, msg });
  const snap = snapshot as ServerMessage;
  assert.deepEqual(decodeServerMessage(encode(snap)), { ok: true, msg: snapshot });
  assert.throws(() => encode({ ...input, dx: 5 } as ClientMessage), /dx/);
});

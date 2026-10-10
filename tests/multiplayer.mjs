import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { api } from '../worker/index.js';
import { createWorld, findRoute, PHASE_ORDER, phaseFuseCount } from '../public/world.js';
const sqlite = new DatabaseSync(':memory:');
for (const f of await readdir('drizzle'))
  if (f.endsWith('.sql')) sqlite.exec(await readFile('drizzle/' + f, 'utf8'));
const DB = {
  prepare(sql) {
    return {
      bind(...params) {
        return {
          async first() {
            return sqlite.prepare(sql).get(...params) || null;
          },
          async all() {
            return { results: sqlite.prepare(sql).all(...params) };
          },
          async run() {
            const result = sqlite.prepare(sql).run(...params);
            return { meta: { changes: Number(result.changes) } };
          },
        };
      },
    };
  },
};
async function call(action, body, expected = 200) {
  const r = await api(
    new Request('https://game.test/api/rooms/' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://game.test' },
      body: JSON.stringify(body),
    }),
    { DB },
  );
  const d = await r.json();
  assert.equal(r.status, expected, JSON.stringify(d));
  return d;
}
async function rankCall(action, body, expected = 200) {
  const r = await api(
    new Request('https://game.test/api/leaderboard/' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://game.test' },
      body: JSON.stringify(body),
    }),
    { DB },
  );
  const d = await r.json();
  assert.equal(r.status, expected, JSON.stringify(d));
  return d;
}
function payload(p, extra = {}) {
  return { code: p.room.code, id: p.id, token: p.token, ...extra };
}
function modifyRoom(code, fn) {
  const row = sqlite.prepare('SELECT state FROM rooms WHERE code=?').get(code);
  let room = JSON.parse(row.state);
  fn(room);
  sqlite.prepare('UPDATE rooms SET state=? WHERE code=?').run(JSON.stringify(room), code);
}
const complete = { completed: true, phases: PHASE_ORDER.length, level: PHASE_ORDER.at(-1) };
await rankCall('submit', { name: 'Incompleto', milliseconds: 20000, level: 'backrooms' }, 409);
await rankCall('submit', { ...complete, name: 'Rafael', milliseconds: 32840 });
await rankCall('submit', { ...complete, name: 'Ana', milliseconds: 18450 });
await rankCall('submit', { ...complete, name: 'rafael', milliseconds: 41000 });
let ranking = await rankCall('top', {});
assert.deepEqual(
  ranking.entries.map(e => e.name),
  ['Ana', 'Rafael'],
);
assert.equal(ranking.entries[1].milliseconds, 32840);
await rankCall('submit', { ...complete, name: 'Rafael', milliseconds: 15120 });
ranking = await rankCall('top', {});
assert.equal(ranking.entries[0].milliseconds, 15120);
await rankCall('submit', { ...complete, name: 'Ana', milliseconds: 500 }, 400);
console.log(
  'PASS: completed campaigns only, ascending total time, best record per explorer and partial completion rejected.',
);
await call('create', { name: '' }, 400);
const host = await call('create', { name: 'Rafael' });
const code = host.room.code;
assert.equal(code.length, 6);
assert.equal(host.room.players.length, 1);
assert.ok(host.token);
assert.ok(!JSON.stringify(host.room).includes(host.token));
const [p2, p3] = await Promise.all([
  call('join', { name: 'Lucca', code }),
  call('join', { name: 'Pedro', code }),
]);
const p4 = await call('join', { name: 'Amigo', code });
assert.equal(p4.room.players.length, 4);
assert.equal(new Set(p4.room.players.map(p => p.color)).size, 4);
await call('join', { name: 'Extra', code }, 409);
await call('join', { name: 'Extra', code: 'AAAAAA' }, 404);
await call('start', payload(p2), 403);
await call('sync', { code, id: host.id, token: 'wrong' }, 401);
let data = await call('start', payload(host));
assert.equal(data.room.status, 'playing');
const world = createWorld(data.room.seed);
assert.equal(world.fuses.length, 3);
for (const f of [...world.fuses, world.exit])
  assert.ok(findRoute(world.grid, 1, 1, Math.floor(f.x), Math.floor(f.y)).length);
let moveTarget = world.grid[1][2] === 0 ? { x: 1.7, y: 1.5 } : { x: 1.5, y: 1.7 };
data = await call('sync', payload(host, { round: 1, seq: 1, a: 0, ...moveTarget }));
assert.equal(data.positionAccepted, true);
const seen = await call('sync', payload(p2));
assert.equal(seen.room.players.find(p => p.id === host.id).x, moveTarget.x);
assert.equal(seen.room.seed, host.room.seed);
data = await call('sync', payload(host, { round: 1, seq: 2, a: 0, x: 19.5, y: 19.5 }));
assert.equal(data.positionAccepted, false);
// Two collectors submit together. CAS retries must preserve both collected fuses.
modifyRoom(code, r => {
  for (const [i, p] of [
    [0, host],
    [1, p2],
  ]) {
    Object.assign(
      r.players.find(v => v.id === p.id),
      world.fuses[i],
    );
  }
});
await Promise.all([
  call('sync', payload(host, { round: 1, seq: 3, a: 0, ...world.fuses[0] })),
  call('sync', payload(p2, { round: 1, seq: 1, a: 0, ...world.fuses[1] })),
]);
data = await call('sync', payload(p3));
assert.deepEqual(data.room.fuses, [true, true, false]);
modifyRoom(code, r =>
  Object.assign(
    r.players.find(v => v.id === p3.id),
    world.fuses[2],
  ),
);
data = await call('sync', payload(p3, { round: 1, seq: 1, a: 0, ...world.fuses[2] }));
assert.ok(data.room.fuses.every(Boolean));
modifyRoom(code, r =>
  Object.assign(
    r.players.find(v => v.id === host.id),
    world.exit,
  ),
);
data = await call('sync', payload(host, { round: 1, seq: 4, a: 0, ...world.exit }));
assert.equal(data.room.status, 'won');
assert.ok(data.room.finished >= data.room.started);
assert.equal((await call('sync', payload(p2))).room.status, 'won');
data = await call('start', payload(host));
assert.equal(data.room.round, 2);
assert.ok(data.room.fuses.every(v => !v));
assert.ok(data.room.players.every(v => v.alive));
modifyRoom(code, r => {
  r.started = Date.now() - 30000;
  r.lastTick = Date.now();
  r.enemy.x = 1.5;
  r.enemy.y = 1.5;
  r.enemy.path = [];
});
data = await call('sync', payload(host));
assert.equal(data.room.status, 'lost');
await call('leave', payload(host));
data = await call('sync', payload(p2));
assert.equal(data.room.host, p2.id);
assert.equal(data.room.players.length, 3);
const other = await call('create', { name: 'Outra sala' });
assert.notEqual(other.room.code, code);
assert.equal(other.room.players.length, 1);
const bad = await api(
  new Request('https://game.test/api/rooms/create', {
    method: 'POST',
    headers: { Origin: 'https://evil.test' },
    body: '{}',
  }),
  { DB },
);
assert.equal(bad.status, 403);
console.log(
  'PASS: real SQLite migrations, simultaneous joins, 4-player limit, identity isolation, host authorization, shared positions/map, collision rejection, concurrent fuse collection, team victory, restart, capture, host transfer, room isolation.',
);
// Run the actual front-end in two isolated page contexts connected to the API.
const { default: vm } = await import('node:vm');
const worldSource = (await readFile('public/world.js', 'utf8'))
  .replaceAll('export function', 'function')
  .replaceAll('export const', 'const');
// Junta os módulos de public/js na mesma ordem em que o navegador os avalia (pós-ordem dos
// imports a partir do main.js), sem import/export, para rodar como um único script na VM.
async function bundleClient(file = 'main.js', seen = new Set(), out = []) {
  if (seen.has(file)) return out;
  seen.add(file);
  const source = await readFile('public/js/' + file, 'utf8');
  for (const [, dep] of source.matchAll(/^import [^;]*? from '\.\/([\w-]+\.js)';$/gm))
    await bundleClient(dep, seen, out);
  out.push(
    source
      .replace(/^import [^;]*? from '[^']+';\n/gm, '')
      .replace(/^export \{[^}]*\};\n/gm, '')
      .replace(/^export (?=const|let|function|class)/gm, ''),
  );
  return out;
}
const gameSource = (await bundleClient()).join('\n');
const roomSockets = {};
async function serve(action, code, body) {
  const r = await api(
    new Request('https://game.test/api/rooms/' + action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://game.test' },
      body: JSON.stringify({ ...body, code }),
    }),
    { DB },
  );
  return { status: r.status, data: await r.json() };
}
function broadcast(code, room) {
  for (const ws of roomSockets[code] ?? []) ws.deliver({ type: 'room', room });
}
function client() {
  let elements = {};
  const sockets = [],
    pending = [];
  let painting = new Proxy(
    { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) },
    { get: (o, k) => o[k] || (() => {}) },
  );
  function element(id) {
    return (elements[id] ??= {
      hidden: false,
      value: '',
      textContent: '',
      tagName: 'DIV',
      style: {},
      classList: {
        add() {},
        remove() {},
        toggle() {},
        contains() {
          return false;
        },
      },
      children: [],
      setAttribute() {},
      getContext: () => painting,
      events: {},
      addEventListener(type, fn) {
        (this.events[type] ??= []).push(fn);
      },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 124, height: 124 }),
      setPointerCapture() {},
      focus() {},
      scrollIntoView() {},
      replaceChildren(...items) {
        this.children = items;
      },
      append(...items) {
        this.children.push(...items);
      },
    });
  }
  const sandbox = {
    console,
    Math,
    Map,
    Uint8Array,
    Float32Array,
    URLSearchParams,
    AbortController,
    performance: { now: () => 0 },
    requestAnimationFrame() {},
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
    setInterval() {
      return 1;
    },
    clearInterval() {},
    WebSocket: class {
      constructor(url) {
        this.url = url;
        this.code = url.split('/')[5];
        this.readyState = 1;
        this.sent = [];
        sockets.push(this);
        (roomSockets[this.code] ??= new Set()).add(this);
        // Como o RoomDO ao aceitar o upgrade: manda a sala inteira para quem acabou de conectar.
        pending.push(
          this.reply(() => serve('sync', this.code, who())).then(r => this.deliverRoom(r)),
        );
      }
      deliver(message) {
        if (this.readyState === 1) this.onmessage?.({ data: JSON.stringify(message) });
      }
      deliverRoom(reply) {
        if (reply.status === 200) this.deliver({ type: 'room', room: reply.data.room });
      }
      // O WebSocket entrega em ordem: as respostas do servidor falso também.
      reply(task) {
        return (this.chain = (this.chain ?? Promise.resolve()).then(task));
      }
      // Faz o papel do RoomDO: {action, reqId, ...corpo} roda a ação na sala; toda ação exceto `sync`
      // empurra a sala para todos os conectados e só então responde `result` ao autor.
      send(text) {
        const { action, reqId = null, ...body } = JSON.parse(text);
        this.sent.push({ action, reqId, ...body });
        pending.push(
          this.reply(async () => {
            const reply = await serve(action, this.code, body);
            if (reply.status !== 200)
              return this.deliver({
                type: 'error',
                reqId,
                error: reply.data.error,
                status: reply.status,
              });
            if (action !== 'sync') broadcast(this.code, reply.data.room);
            this.deliver({ type: 'result', reqId, ...reply.data });
          }),
        );
      }
      close() {
        this.readyState = 3;
        roomSockets[this.code]?.delete(this);
      }
    },
    matchMedia: () => ({ matches: true }),
    location: { origin: 'https://game.test', search: '', protocol: 'https:', host: 'game.test' },
    navigator: {},
    window: { addEventListener() {} },
    document: {
      getElementById: element,
      createElement: () => element(crypto.randomUUID()),
      querySelectorAll: () => [],
      addEventListener() {},
      body: element('body'),
    },
    // Entrar na sala é REST, mas o RoomDO empurra a sala nova para quem já está conectado.
    fetch: async (url, init) => {
      const response = await api(new Request('https://game.test' + url, init), { DB });
      if (url === '/api/rooms/join' && response.ok) {
        const { room } = await response.clone().json();
        broadcast(room.code, room);
      }
      return response;
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(worldSource + '\n' + gameSource, sandbox);
  // `with (game)` deixa os testes lerem e escreverem o estado compartilhado (state.js) pelo
  // nome direto, como `state='playing'`, igual a quando tudo era um arquivo só.
  // Quem `await`a uma chamada assíncrona do cliente também espera as respostas do servidor falso.
  function run(s) {
    const result = vm.runInContext(`with (game) {\n${s}\n}`, sandbox);
    return typeof result?.then === 'function'
      ? result.then(async value => (await Promise.all(pending.splice(0)), value))
      : result;
  }
  function who() {
    return run('({id:net.id,token:net.token,round:net.room.round})');
  }
  // Equivale a um tick do servidor: a sala atual chega por todos os sockets conectados.
  async function pull() {
    const ws = sockets.at(-1),
      reply = await serve('sync', ws.code, who());
    broadcast(ws.code, reply.data.room);
    await Promise.all(pending.splice(0));
  }
  return { sandbox, elements, sockets, run, pull };
}
const joystickClient = client();
joystickClient.run("state='playing'");
const stick = joystickClient.elements.moveJoystick;
const joyEvent = (type, x, y, id = 7) => {
  for (const fn of stick.events[type] || [])
    fn({ pointerId: id, pointerType: 'touch', clientX: x, clientY: y, preventDefault() {} });
};
joyEvent('pointerdown', 62, 22);
assert.equal(joystickClient.run('touchMove.y'), -1);
joyEvent('pointermove', 102, 22);
assert.ok(Math.abs(joystickClient.run('Math.hypot(touchMove.x,touchMove.y)') - 1) < 1e-8);
joyEvent('pointerup', 62, 62, 8);
assert.equal(joystickClient.run('touchMove.pointer'), 7);
joyEvent('pointermove', 62, 45);
assert.ok(joystickClient.run('-touchMove.y>0 && -touchMove.y<1'));
joyEvent('pointercancel', 62, 45);
assert.equal(joystickClient.run('touchMove.x||touchMove.y'), 0);
joyEvent('pointerdown', 62, 22);
joystickClient.run('pause()');
assert.equal(joystickClient.run('touchMove.pointer'), null);
joystickClient.run("state='playing'");
joyEvent('pointerdown', 62, 22);
joyEvent('lostpointercapture', 62, 22);
assert.equal(joystickClient.run('touchMove.y'), 0);
// Die while dragging, revive before another animation frame, then drag with a new finger.
joystickClient.run("state='playing';coinBalance=25");
joyEvent('pointerdown', 62, 22, 17);
joystickClient.run('finish(false)');
assert.equal(joystickClient.run('touchMove.pointer'), null);
await joystickClient.run('reviveAll()');
joyEvent('pointerdown', 62, 22, 18);
assert.equal(joystickClient.run('touchMove.y'), -1);
joystickClient.run('finish(false);start()');
joyEvent('pointerdown', 62, 22, 19);
assert.equal(joystickClient.run('touchMove.y'), -1);
// A browser may invalidate a pointer while death hides the controls.
stick.hasPointerCapture = () => true;
stick.releasePointerCapture = () => {
  throw new Error('Inactive pointer');
};
assert.doesNotThrow(() => joystickClient.run('finish(false)'));
assert.equal(joystickClient.run('touchMove.pointer'), null);
console.log(
  'PASS: joystick recovers after death, coin revival and retry; invalidated captures cannot stop the game loop.',
);
joystickClient.run("state='playing'");
stick.setPointerCapture = () => {
  throw new Error('Capture unavailable');
};
joyEvent('pointerdown', 62, 22, 25);
assert.equal(joystickClient.run('touchMove.y'), -1);
joyEvent('pointerup', 62, 22, 25);
assert.equal(joystickClient.run('touchMove.pointer'), null);
assert.equal(joystickClient.run('W'), 400);
assert.equal(joystickClient.run('H'), 240);
console.log(
  'PASS: mobile rendering budget and joystick fallback when pointer capture is unavailable.',
);
console.log(
  'PASS: mobile joystick analog speed, normalized diagonals, independent fingers, cancellation, pause and capture loss stop movement.',
);
const a = client(),
  b = client();
a.run("document.getElementById('nickname').value='Desktop'");
await a.run("connectRoom('create')");
const sharedCode = a.run('net.code');
assert.equal(a.run('state'), 'lobby');
b.run("document.getElementById('nickname').value='Mobile'");
b.sandbox.document.getElementById('roomCode').value = sharedCode;
await b.run("connectRoom('join')");
await a.pull();
assert.equal(a.run('net.room.players.length'), 2);
await a.run('launchRoom()');
await b.pull();
assert.equal(a.run('state'), 'playing');
assert.equal(b.run('state'), 'playing');
assert.equal(a.run('sceneRound'), b.run('sceneRound'));
assert.equal(b.run('remotePlayers[0].name'), 'Desktop');
a.run('render(100);update(.02);pause()');
assert.equal(a.run('state'), 'paused');
a.run('resumeOnline()');
assert.equal(a.run('state'), 'playing');
await a.run('leaveRoom()');
await b.pull();
assert.equal(b.run('net.room.host'), b.run('net.id'));
await b.run('leaveRoom()');
assert.equal(b.run('net'), null);
a.run("document.getElementById('nickname').value='Solo'");
a.run("document.getElementById('solo').onclick()");
assert.equal(a.run('state'), 'playing');
a.run('render(100);update(.02)');
console.log(
  'PASS: two isolated game pages create/join/start, remote characters, rendering, pause/resume, leave/host transfer, solo mode.',
);
const rankUi = client();
rankUi.sandbox.crypto = crypto;
rankUi.run(
  "document.getElementById('nickname').value='UI Ranking';soloCampaignElapsed=9.876;soloCompleted=PHASE_ORDER.length;activeLevel=PHASE_ORDER.at(-1)",
);
await rankUi.run('submitLeaderboardTime()');
await rankUi.run('openLeaderboard()');
assert.equal(rankUi.elements.leaderboardPanel.hidden, false);
assert.equal(rankUi.elements.leaderboardList.children[0].children[1].textContent, 'UI Ranking');
assert.equal(rankUi.elements.leaderboardList.children[0].children[2].textContent, '00:09,87');
rankUi.run('closeLeaderboard()');
assert.equal(rankUi.elements.homePanel.hidden, false);
console.log(
  'PASS: game menu submits a completed time, shows the combined cross-level leaderboard and closes back to the previous screen.',
);
// Shared coin collection and resurrection, including concurrent requests.
// Room chat authenticates the sender and never crosses room boundaries.
const chatA = await call('create', { name: 'Ana' }),
  chatB = await call('join', { code: chatA.room.code, name: 'Beto' }),
  chatOther = await call('create', { name: 'Outra' });
const chatId = crypto.randomUUID();
await call('chat', { ...payload(chatA), token: 'invalid', text: 'oi', messageId: chatId }, 401);
await call(
  'chat',
  { ...payload(chatOther), code: chatA.room.code, text: 'oi', messageId: chatId },
  401,
);
await call('chat', payload(chatA, { text: ' ', messageId: chatId }), 400);
await call('chat', payload(chatA, { text: 'a'.repeat(241), messageId: chatId }), 400);
await Promise.all([
  call('chat', payload(chatA, { text: 'Oi equipe!', messageId: chatId, name: 'Falso' })),
  call('chat', payload(chatB, { text: 'Vamos juntos!', messageId: crypto.randomUUID() })),
]);
let history = (await call('sync', payload(chatB))).room.messages;
assert.equal(history.length, 2);
assert.equal(history.find(m => m.sender === chatA.id).name, 'Ana');
await call('chat', payload(chatA, { text: 'Oi equipe!', messageId: chatId }));
assert.equal((await call('sync', payload(chatA))).room.messages.length, 2);
await call('chat', payload(chatA, { text: 'rápido', messageId: crypto.randomUUID() }), 429);
assert.equal((await call('sync', payload(chatOther))).room.messages.length, 0);
for (let i = 0; i < 52; i++) {
  modifyRoom(chatA.room.code, r => (r.players[0].lastChat = 0));
  await call('chat', payload(chatA, { text: 'Mensagem ' + i, messageId: crypto.randomUUID() }));
}
assert.equal((await call('sync', payload(chatB))).room.messages.length, 50);
await call('leave', payload(chatB));
await call('chat', payload(chatB, { text: 'saí', messageId: crypto.randomUUID() }), 401);
const chatClientA = client(),
  chatClientB = client();
chatClientA.sandbox.crypto = crypto;
chatClientB.sandbox.crypto = crypto;
chatClientA.run("$('nickname').value='A'");
await chatClientA.run("connectRoom('create')");
chatClientB.run("$('nickname').value='B'");
chatClientB.sandbox.document.getElementById('roomCode').value = chatClientA.run('net.code');
await chatClientB.run("connectRoom('join')");
await chatClientA.run('syncGlobalChat()');
await chatClientB.run('syncGlobalChat()');
chatClientA.run("openChat();$('chatInput').value='<b>Oi!</b>'");
await chatClientA.run('sendChat()');
await chatClientB.run('syncGlobalChat()');
assert.equal(chatClientB.run("$('chatUnread').textContent"), '(1)');
chatClientB.run('openChat()');
assert.equal(
  chatClientB.run("$('chatMessages').children[0].children[1].textContent"),
  '<b>Oi!</b>',
);
assert.equal(chatClientB.run("$('chatUnread').textContent"), '');
await chatClientA.run('launchRoom()');
chatClientA.run('closeChat(false);openChat()');
assert.equal(chatClientA.run('state'), 'paused');
chatClientA.run('closeChat()');
assert.equal(chatClientA.run('state'), 'playing');
await chatClientB.run('leaveRoom()');
assert.equal(chatClientB.run('chatOpen'), false);
assert.equal(chatClientB.run('globalMessages.length'), 1);
const soloChat = client();
soloChat.sandbox.crypto = crypto;
soloChat.run("$('nickname').value='Sem equipe'");
await soloChat.run('syncGlobalChat()');
assert.equal(soloChat.run('net'), null);
assert.equal(soloChat.run('globalMessages.length'), 1);
soloChat.run("$('chatInput').value='Olá de fora da sala!'");
await soloChat.run('sendChat()');
await chatClientA.run('syncGlobalChat()');
assert.equal(chatClientA.run('globalMessages.at(-1).text'), 'Olá de fora da sala!');
async function globalCall(action, body, status = 200) {
  const r = await api(
    new Request('https://game.test/api/global/' + action, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { DB },
  );
  assert.equal(r.status, status);
  return r.json();
}
const gs = await globalCall('session', { name: 'Global' }),
  mid = crypto.randomUUID();
await globalCall('send', { ...gs, token: 'invalid', text: 'não', messageId: mid }, 401);
await globalCall('send', { ...gs, text: ' ', messageId: mid }, 400);
await globalCall('send', { ...gs, text: 'x'.repeat(241), messageId: mid }, 400);
await Promise.all([
  globalCall('send', { ...gs, text: 'Teste', messageId: mid }),
  globalCall('send', { ...gs, text: 'Teste', messageId: mid }),
]);
let glob = await globalCall('poll', gs);
assert.equal(glob.messages.filter(m => m.sender === gs.id).length, 1);
assert.ok(glob.online >= 4);
assert.ok(!JSON.stringify(glob).includes(gs.token));
await globalCall('send', { ...gs, text: 'rápido', messageId: crypto.randomUUID() }, 429);
console.log(
  'PASS: global chat between solo and room players, authenticated sessions, concurrent retry deduplication, online count and message limits.',
);
console.log(
  'PASS: authenticated room chat, concurrent sends, idempotency, rate/size/history limits, isolation, two-client delivery, unread badge, literal text rendering, pause/resume and exit cleanup.',
);
// Smooth walking preserves speed limits, immediate release, and frame-rate independence.
const motionDistances = [];
for (const hz of [30, 60, 144]) {
  const c = client();
  c.run('grid=Array.from({length:21},()=>Array(21).fill(0));player={x:5,y:5,a:0};resetMotion()');
  c.run(`for(let i=0;i<${hz};i++)smoothWalk(1,0,1.85,1/${hz})`);
  motionDistances.push(c.run('player.x-5'));
  const stopped = c.run('player.x');
  c.run('smoothWalk(0,0,1.85,.016)');
  assert.equal(c.run('player.x'), stopped);
  c.run('resetMotion();player={x:5,y:5,a:0};smoothWalk(1,1,3.1,.1)');
  assert.ok(c.run('Math.hypot(player.x-5,player.y-5)') <= 0.31);
  c.run("state='playing';pause()");
  assert.equal(c.run('walkMotion.forward'), 0);
}
assert.ok(Math.max(...motionDistances) - Math.min(...motionDistances) < 1e-9);
assert.ok(motionDistances[0] > 1.7 && motionDistances[0] < 1.85);
console.log(
  'PASS: smooth acceleration at 30/60/144 Hz, normalized sprint, immediate release and pause reset.',
);
const ch = await call('create', { name: 'Moedas' }),
  cp = await call('join', { code: ch.room.code, name: 'Parceiro' });
let coinRoom = await call('start', payload(ch));
const cw = createWorld(coinRoom.room.seed);
assert.equal(cw.coins.length, 75);
assert.equal(new Set(cw.coins.map(c => c.x + ',' + c.y)).size, 75);
for (const c of cw.coins)
  assert.ok(findRoute(cw.grid, 1, 1, Math.floor(c.x), Math.floor(c.y)).length);
modifyRoom(ch.room.code, r => {
  for (const p of r.players) Object.assign(p, { x: cw.coins[0].x, y: cw.coins[0].y });
});
await Promise.all([
  call(
    'sync',
    payload(ch, { round: 1, seq: 1, a: 0, x: cw.coins[0].x, y: cw.coins[0].y, balance: 99999 }),
  ),
  call('sync', payload(cp, { round: 1, seq: 1, a: 0, x: cw.coins[0].x, y: cw.coins[0].y })),
]);
coinRoom = await call('sync', payload(ch));
assert.equal(coinRoom.room.balance, 1);
assert.deepEqual(coinRoom.room.collectedCoins, [0]);
modifyRoom(ch.room.code, r => {
  r.players.forEach(p => (p.alive = false));
  r.status = 'lost';
  r.balance = 24;
  r.fuses = [true, false, true];
});
await call('revive', payload(cp), 409);
coinRoom = await call('sync', payload(ch));
assert.equal(coinRoom.room.balance, 24);
assert.equal(coinRoom.room.status, 'lost');
modifyRoom(ch.room.code, r => {
  r.balance = 25;
});
coinRoom = await call('revive', payload(cp));
assert.equal(coinRoom.room.balance, 0);
assert.equal(coinRoom.revived, 2);
assert.equal(coinRoom.room.status, 'playing');
assert.deepEqual(coinRoom.room.fuses, [true, false, true]);
assert.deepEqual(coinRoom.room.collectedCoins, [0]);
assert.ok(
  coinRoom.room.players.every(p => p.alive && p.x === 1.5 && p.y === 1.5 && p.respawns === 1),
);
await call('revive', payload(ch), 409);
// Five-second grace avoids immediately being captured at spawn.
modifyRoom(ch.room.code, r => {
  r.started = Date.now() - 30000;
  r.lastTick = Date.now();
  r.enemy.x = 1.5;
  r.enemy.y = 1.5;
  r.enemy.path = [];
});
coinRoom = await call('sync', payload(ch, { round: 1, seq: 2, a: 0, x: 1.5, y: 1.5 }));
assert.ok(coinRoom.room.players.every(p => p.alive));
modifyRoom(ch.room.code, r => {
  r.players.forEach(p => {
    p.alive = false;
    p.protectedUntil = 0;
  });
  r.status = 'lost';
  r.balance = 50;
});
const concurrent = await Promise.all([
  api(
    new Request('https://game.test/api/rooms/revive', {
      method: 'POST',
      body: JSON.stringify(payload(ch)),
    }),
    { DB },
  ),
  api(
    new Request('https://game.test/api/rooms/revive', {
      method: 'POST',
      body: JSON.stringify(payload(cp)),
    }),
    { DB },
  ),
]);
assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409]);
coinRoom = await call('sync', payload(ch));
assert.equal(coinRoom.room.balance, 25);
await call('leave', payload(cp));
modifyRoom(ch.room.code, r => {
  r.status = 'lost';
  r.players[0].alive = false;
  r.players[0].protectedUntil = 0;
});
await call('start', payload(ch));
coinRoom = await call('sync', payload(ch));
assert.equal(coinRoom.room.balance, 0);
assert.deepEqual(coinRoom.room.collectedCoins, []);
// Previously created rooms gain coins without clearing their progress.
modifyRoom(ch.room.code, r => {
  delete r.world.coins;
  delete r.balance;
  delete r.collectedCoins;
  r.fuses = [true, false, false];
});
coinRoom = await call('sync', payload(ch));
assert.deepEqual(coinRoom.room.fuses, [true, false, false]);
assert.equal(coinRoom.room.balance, 0);
// Real client resurrection flow in two isolated game pages.
const ca = client(),
  cb = client();
ca.run("document.getElementById('nickname').value='A'");
await ca.run("connectRoom('create')");
cb.run("document.getElementById('nickname').value='B'");
cb.sandbox.document.getElementById('roomCode').value = ca.run('net.code');
await cb.run("connectRoom('join')");
await ca.pull();
await ca.run('launchRoom()');
await cb.pull();
modifyRoom(ca.run('net.code'), r => {
  r.balance = 25;
  r.collectedCoins = [0, 1, 2];
  r.fuses = [true, false, false];
  r.status = 'lost';
  r.players.forEach(p => (p.alive = false));
});
await ca.pull();
await cb.pull();
assert.equal(ca.run('state'), 'lost');
assert.equal(cb.run('state'), 'lost');
await ca.run('reviveAll()');
await cb.pull();
assert.equal(ca.run('state'), 'playing');
assert.equal(cb.run('state'), 'playing');
assert.equal(cb.run('coinBalance'), 0);
assert.equal(cb.run('fuses[0].taken'), true);
assert.equal(cb.run('coins[0].taken'), true);
assert.equal(cb.run('player.x'), 1.5);
await ca.run('leaveRoom()');
await cb.run('leaveRoom()');
// Solo mode spends once and preserves the level after death.
a.run('coinBalance=25;coins[0].taken=true;fuses[0].taken=true;finish(false)');
await a.run('reviveAll()');
assert.equal(a.run('state'), 'playing');
assert.equal(a.run('coinBalance'), 0);
assert.equal(a.run('fuses[0].taken'), true);
assert.equal(a.run('coins[0].taken'), true);
a.run('render(100)');
console.log(
  'PASS: 75 reachable coins, no double-credit, insufficient balance, 25-coin team revival, preserved progress, spawn protection, no double-spend, round reset, old-room compatibility, two-client resurrection and solo revival.',
);
// Simulated standard gamepad: analog movement, edge-triggered actions, pause and disconnect.
const controller = {
  index: 0,
  connected: true,
  mapping: 'standard',
  axes: [0, 0, 0, 0],
  buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
};
a.sandbox.navigator.getGamepads = () => [controller];
a.run("state='playing';player={x:1.5,y:1.5,a:0};keys={}");
const openEast = a.run('grid[1][2]===0');
controller.axes[openEast ? 1 : 0] = openEast ? -1 : 1;
a.run('pollController(1000)');
assert.equal(a.run('padActive'), true);
const before = a.run('JSON.stringify(player)');
a.run('update(.1)');
assert.notEqual(a.run('JSON.stringify(player)'), before);
controller.axes = [0, 0, 1, 0.5];
a.run('pollController(1100);update(.1)');
assert.ok(a.run('player.a') > 0);
assert.ok(a.run('viewPitch') < 0);
controller.axes = [0, 0, 0, 0];
const initialLight = a.run('light');
controller.buttons[2].pressed = true;
a.run('pollController(1200)');
assert.notEqual(a.run('light'), initialLight);
a.run('pollController(1210)');
assert.notEqual(a.run('light'), initialLight);
controller.buttons[2].pressed = false;
a.run('pollController(1220)');
controller.buttons[9].pressed = true;
a.run('pollController(1300)');
assert.equal(a.run('state'), 'paused');
controller.buttons[9].pressed = false;
a.run('pollController(1310)');
controller.buttons[9].pressed = true;
a.run('pollController(1400)');
assert.equal(a.run('state'), 'playing');
controller.buttons[9].pressed = false;
a.run('pollController(1410)');
a.run('coinBalance=25;finish(false)');
controller.buttons[3].pressed = true;
a.run('pollController(1500)');
assert.equal(a.run('state'), 'playing');
assert.equal(a.run('coinBalance'), 0);
controller.connected = false;
a.run('pollController(1600)');
assert.equal(a.run('state'), 'paused');
assert.equal(a.run('padInput.x'), 0);
assert.equal(a.run('padActive'), false);
const nickname = a.sandbox.document.getElementById('nickname');
nickname.id = 'nickname';
nickname.value = 'TESTE';
nickname.scrollIntoView = () => {};
const padKeys = a.sandbox.document.getElementById('padKeys');
padKeys.querySelector = () => null;
a.run("openPadKeyboard(document.getElementById('nickname'))");
a.run('erasePadChar();closePadKeyboard(false)');
assert.equal(nickname.value, 'TESTE');
nickname.focus = () => {};
nickname.scrollIntoView = () => {};
a.run("openPadKeyboard(document.getElementById('nickname'));erasePadChar();closePadKeyboard(true)");
assert.equal(nickname.value, 'TEST');
console.log(
  'PASS: gamepad analog movement/look, single-press flashlight, pause/resume, revival, disconnect safety and on-screen keyboard.',
);

assert.equal(a.run('stickVector(.08,.08).x'), 0);
assert.ok(a.run('Math.abs(Math.hypot(...Object.values(stickVector(1,1)))-1)<.0001'));
assert.ok(a.run('stickVector(.4,0,.19,1.7).x<axisValue(.4)'));
a.run('padSensitivity=1;cyclePadSensitivity()');
assert.equal(a.run('padSensitivity'), 1.4);
a.run('cyclePadSensitivity()');
assert.equal(a.run('padSensitivity'), 0.65);
a.run('cyclePadSensitivity()');
assert.equal(a.run('padSensitivity'), 1);
a.run(
  "state='playing';padInput={x:0,y:0,lookX:0,lookY:0,run:false};padLookSmooth={x:1,y:1};update(.016)",
);
assert.equal(a.run('padLookSmooth.x'), 0);
assert.equal(a.run('padLookSmooth.y'), 0);
console.log(
  'PASS: radial deadzone, normalized diagonals, precise look curve, sensitivity presets, immediate camera stop.',
);
// Every selected level keeps all goals reachable and the same game rules.
for (const level of [
  'backrooms',
  'poolrooms',
  'habitable',
  'electrical',
  'level974',
  'level241',
  'office',
  'woodrooms',
  'fun',
  'courtyard',
  'run',
]) {
  for (const seed of [93451, 7, 4913]) {
    const world = createWorld(seed, level);
    assert.equal(world.fuses.length, 3);
    assert.equal(world.coins.length, 75);
    for (const target of [...world.fuses, ...world.coins, world.exit, world.enemy])
      assert.ok(
        findRoute(world.grid, 1, 1, Math.floor(target.x), Math.floor(target.y)).length,
        level + ' unreachable',
      );
  }
  const leader = await call('create', { name: 'Host ' + level, level });
  assert.equal(leader.room.level, level);
  const guest = await call('join', { name: 'Visitante', code: leader.room.code });
  assert.equal(guest.room.level, level);
  await call('level', payload(guest, { level: 'poolrooms' }), 403);
  let started = await call('start', payload(leader));
  assert.equal(started.room.level, level);
  await call('level', payload(leader, { level: 'backrooms' }), 409);
  const world = createWorld(started.room.seed, level);
  modifyRoom(leader.room.code, r => {
    r.fuses = [true, true, true];
    Object.assign(r.players[0], { x: world.exit.x, y: world.exit.y });
  });
  const victory = await call(
    'sync',
    payload(leader, { round: started.room.round, seq: 1, x: world.exit.x, y: world.exit.y, a: 0 }),
  );
  assert.equal(victory.room.status, 'won');
  const next = level === 'poolrooms' ? 'electrical' : 'poolrooms';
  const changed = await call('level', payload(leader, { level: next }));
  assert.equal(changed.room.level, next);
  assert.equal(changed.room.status, 'lobby');
  assert.deepEqual(changed.room.fuses, [false, false, false]);
  assert.equal((await call('sync', payload(guest))).room.level, next);
}
await call('create', { name: 'Invalid', level: 'unknown' }, 400);
assert.notDeepEqual(createWorld(42, 'poolrooms').grid, createWorld(42, 'backrooms').grid);
assert.notDeepEqual(createWorld(42, 'electrical').grid, createWorld(42, 'habitable').grid);
const la = client(),
  lb = client();
la.run("document.getElementById('nickname').value='Sequência'");
lb.run("document.getElementById('nickname').value='Equipe'");
await la.run("connectRoom('create')");
lb.sandbox.document.getElementById('roomCode').value = la.run('net.code');
await lb.run("connectRoom('join')");
await la.run('launchRoom()');
await lb.pull();
assert.equal(la.run('activeLevel'), 'backrooms');
const phaseOrder = PHASE_ORDER;
const campaignNow = Date.now;
let campaignClock = campaignNow();
try {
  Date.now = () => campaignClock;
  for (let i = 0; i < phaseOrder.length; i++) {
    assert.equal(la.run('activeLevel'), phaseOrder[i]);
    assert.equal(lb.run('activeLevel'), phaseOrder[i]);
    await call(
      'level',
      la.run('({code:net.code,id:net.id,token:net.token,round:net.room.round})'),
      409,
    );
    modifyRoom(la.run('net.code'), r => {
      r.status = 'won';
      r.fuses = r.world.fuses.map(() => true);
      r.started = campaignClock - 14000;
      r.finished = campaignClock;
    });
    await la.pull();
    await lb.pull();
    assert.equal(la.run('state'), 'won');
    campaignClock += 3001;
    await la.pull();
    await lb.pull();
    if (i + 1 < phaseOrder.length) {
      assert.equal(la.run('activeLevel'), phaseOrder[i + 1]);
      assert.equal(lb.run('activeLevel'), phaseOrder[i + 1]);
      assert.equal(la.run('state'), 'playing');
      assert.equal(lb.run('state'), 'playing');
      assert.equal(la.run('fuses.some(f=>f.taken)'), false);
      assert.equal(la.run('net.room.players.every(p=>p.alive)'), true);
      assert.ok(la.run('elapsed') < 1);
    } else {
      assert.equal(la.run('state'), 'won');
      const score = await rankCall('submit', {
        ...la.run('({code:net.code,id:net.id,token:net.token,round:net.room.round})'),
        name: 'Fake',
        milliseconds: 1,
        level: 'run',
      });
      assert.equal(score.entry.name, 'Sequência');
      assert.equal(score.entry.milliseconds, la.run('net.room.finished-net.room.campaignStarted'));
    }
    campaignClock += 14000;
  }
  await la.run('launchRoom()');
  await lb.pull();
  assert.equal(la.run('activeLevel'), 'backrooms');
  assert.equal(lb.run('activeLevel'), 'backrooms');
} finally {
  Date.now = campaignNow;
}
await la.run('leaveRoom()');
await lb.run('leaveRoom()');
const soloSequence = client();
soloSequence.run(
  "document.getElementById('nickname').value='Sequência Solo';document.getElementById('solo').onclick()",
);
for (let i = 0; i < phaseOrder.length; i++) {
  assert.equal(soloSequence.run('activeLevel'), phaseOrder[i]);
  soloSequence.run(
    'elapsed=14;soloCampaignElapsed+=14;fuses.forEach(f=>f.taken=true);finish(true)',
  );
  assert.equal(soloSequence.run('state'), i === phaseOrder.length - 1 ? 'won' : 'playing');
}
assert.equal(soloSequence.run("missionValue('wins')"), PHASE_ORDER.length);
await soloSequence.run('submitLeaderboardTime()');
assert.equal(
  sqlite
    .prepare("SELECT milliseconds FROM campaign_leaderboard WHERE profile='sequência solo'")
    .get().milliseconds,
  PHASE_ORDER.length * 14000,
);
soloSequence.run('start()');
assert.equal(soloSequence.run('activeLevel'), 'backrooms');
soloSequence.run('elapsed=14;finish(true);finish(false);start()');
assert.equal(soloSequence.run('activeLevel'), 'poolrooms');
soloSequence.run("document.getElementById('solo').onclick()");
assert.equal(soloSequence.run('activeLevel'), 'backrooms');
const sequenceMarkup = await readFile('public/index.html', 'utf8');
assert.ok(!sequenceMarkup.includes('class="level-selector"'));
assert.ok(sequenceMarkup.includes('>PLAY <span>'));
console.log(
  'PASS: fourteen sequential solo and multiplayer phases, synchronized automatic team transition, fresh objectives and clocks, no manual scenario selection, death retries current phase, final completion and PLAY restarts at Backrooms.',
);
// Server-authoritative ten-second coin respawn, independent of client clocks.
const resp = await call('create', { name: 'Respawn' }),
  respGuest = await call('join', { name: 'Outro', code: resp.room.code });
await call('start', payload(resp));
const rw = createWorld(resp.room.seed);
modifyRoom(resp.room.code, r =>
  Object.assign(r.players[0], { x: rw.coins[0].x, y: rw.coins[0].y }),
);
await call('sync', payload(resp, { round: 1, seq: 1, x: rw.coins[0].x, y: rw.coins[0].y, a: 0 }));
let stamp;
modifyRoom(resp.room.code, r => {
  stamp = r.coinRespawns[0];
  r.players[0].x = 1.5;
  r.players[0].y = 1.5;
});
const originalNow = Date.now;
try {
  Date.now = () => stamp - 1;
  let beforeRespawn = await call('sync', payload(respGuest));
  assert.ok(beforeRespawn.room.collectedCoins.includes(0));
  Date.now = () => stamp;
  let afterRespawn = await call('sync', payload(respGuest));
  assert.ok(!afterRespawn.room.collectedCoins.includes(0));
  modifyRoom(resp.room.code, r =>
    Object.assign(r.players[0], { x: rw.coins[0].x, y: rw.coins[0].y }),
  );
  let collectedAgain = await call(
    'sync',
    payload(resp, { round: 1, seq: 2, x: rw.coins[0].x, y: rw.coins[0].y, a: 0 }),
  );
  assert.equal(collectedAgain.room.balance, 2);
  assert.ok(collectedAgain.room.collectedCoins.includes(0));
} finally {
  Date.now = originalNow;
}
for (const level of [
  'backrooms',
  'poolrooms',
  'habitable',
  'electrical',
  'level974',
  'level241',
  'office',
  'woodrooms',
  'fun',
  'courtyard',
  'run',
]) {
  const h = await call('create', { name: 'Hardcore', level, mode: 'hardcore' }),
    g = await call('join', { name: 'Equipe', code: h.room.code });
  assert.equal(g.room.mode, 'hardcore');
  assert.equal(h.room.smile.type, 'smile');
  assert.ok(Math.hypot(h.room.smile.x - h.room.enemy.x, h.room.smile.y - h.room.enemy.y) > 7);
  await call('mode', payload(g, { mode: 'normal' }), 403);
  await call('start', payload(h));
  await call('mode', payload(h, { mode: 'normal' }), 409);
  const w = createWorld(h.room.seed, level);
  assert.ok(findRoute(w.grid, 1, 1, Math.floor(w.smile.x), Math.floor(w.smile.y)).length);
  modifyRoom(h.room.code, r => Object.assign(r.players[0], { x: w.coins[0].x, y: w.coins[0].y }));
  let hc = await call(
    'sync',
    payload(h, { round: 1, seq: 1, x: w.coins[0].x, y: w.coins[0].y, a: 0 }),
  );
  assert.equal(hc.room.balance, 0);
  assert.deepEqual(hc.room.collectedCoins, []);
  await call('revive', payload(h), 409);
  // The Smile alone can capture, while the original monster stays far away.
  modifyRoom(h.room.code, r => {
    r.started = Date.now() - 30000;
    r.lastTick = Date.now();
    r.enemy = { ...r.world.enemy, path: [] };
    r.players.forEach(p => {
      p.x = 1.5;
      p.y = 1.5;
    });
    r.smile = { x: 1.5, y: 1.5, type: 'smile', path: [] };
  });
  hc = await call('sync', payload(h));
  assert.equal(hc.room.status, 'lost');
  assert.ok(hc.room.players.every(p => !p.alive));
  await call('revive', payload(g), 409);
  hc = await call('mode', payload(h, { mode: 'normal' }));
  assert.equal(hc.room.mode, 'normal');
  assert.equal(hc.room.smile, null);
  assert.equal(hc.room.status, 'lobby');
}
await call('create', { name: 'Bad mode', mode: 'invalid' }, 400);
const hcPage = client();
hcPage.run("document.getElementById('nickname').value='Hardcore'");
await hcPage.run("selectMode('hardcore')");
assert.equal(hcPage.run('activeMode'), 'hardcore');
assert.equal(hcPage.run('coins.length'), 0);
hcPage.run(
  "document.getElementById('solo').onclick();elapsed=23;render(100);coinBalance=25;finish(false)",
);
await hcPage.run('reviveAll()');
assert.equal(hcPage.run('state'), 'lost');
assert.equal(hcPage.run('coinBalance'), 25);
assert.equal(hcPage.sandbox.document.getElementById('reviveMenu').disabled, true);
await hcPage.run('leaveRoom()');
await hcPage.run(
  "selectMode('normal');document.getElementById('solo').onclick();player.x=coins[0].x;player.y=coins[0].y;update(.01);player={x:1.5,y:1.5,a:0}",
);
assert.equal(hcPage.run('coins[0].taken'), true);
hcPage.run('elapsed=coins[0].respawnAt-.001;update(0)');
assert.equal(hcPage.run('coins[0].taken'), true);
hcPage.run('elapsed=coins[0].respawnAt;update(0)');
assert.equal(hcPage.run('coins[0].taken'), false);
const hca = client(),
  hcb = client();
hca.run("document.getElementById('nickname').value='Host'");
hcb.run("document.getElementById('nickname').value='Guest'");
await hca.run("connectRoom('create')");
hcb.sandbox.document.getElementById('roomCode').value = hca.run('net.code');
await hcb.run("connectRoom('join')");
await hca.run("selectMode('hardcore','lobby')");
await hcb.pull();
assert.equal(hcb.run('activeMode'), 'hardcore');
assert.equal(hcb.run('coins.length'), 0);
await hca.run('launchRoom()');
await hcb.pull();
assert.ok(hcb.run("smile.type==='smile'"));
hcb.run('elapsed=23;render(100)');
console.log(
  'PASS: exact ten-second shared and solo respawn, repeated collection, Hardcore on all eleven maps, no coins, no reviving, Smile capture, host-only mode selection and synchronized two-monster clients.',
);
// Regression: a legal turn around a wall was rejected as a straight-line teleport.
const walker = await call('create', { name: 'Esquinas' });
await call('start', payload(walker));
const wg = createWorld(walker.room.seed).grid;
let turn;
outer: for (let sy = 1; sy < 20; sy++)
  for (let sx = 1; sx < 20; sx++) {
    if (wg[sy][sx]) continue;
    for (let ey = Math.max(1, sy - 4); ey < Math.min(20, sy + 5); ey++)
      for (let ex = Math.max(1, sx - 4); ex < Math.min(20, sx + 5); ex++) {
        if (wg[ey][ex]) continue;
        const path = findRoute(wg, sx, sy, ex, ey);
        if (path.length < 4 || path.length > 6) continue;
        let blocked = false;
        for (let i = 1; i <= 60; i++) {
          if (
            wg[Math.floor(sy + 0.5 + ((ey - sy) * i) / 60)][
              Math.floor(sx + 0.5 + ((ex - sx) * i) / 60)
            ]
          )
            blocked = true;
        }
        if (blocked) {
          turn = { sx, sy, ex, ey, path };
          break outer;
        }
      }
  }
assert.ok(turn);
modifyRoom(walker.room.code, r => {
  Object.assign(r.players[0], {
    x: turn.sx + 0.5,
    y: turn.sy + 0.5,
    moveCredit: 6,
    moveClock: Date.now(),
  });
});
let straight = await call(
  'sync',
  payload(walker, { round: 1, seq: 1, x: turn.ex + 0.5, y: turn.ey + 0.5, a: 0 }),
);
assert.equal(straight.positionAccepted, false);
assert.equal(straight.movementReason, 'wall');
const trail = turn.path.slice(1).map(([x, y], i) => [i + 1, x + 0.5, y + 0.5]);
let legal = await call(
  'sync',
  payload(walker, {
    round: 1,
    seq: 2,
    x: turn.ex + 0.5,
    y: turn.ey + 0.5,
    a: 0,
    trail,
    respawns: 0,
  }),
);
assert.equal(legal.positionAccepted, true);
assert.equal(legal.ackMovement, trail.length);
let duplicate = await call(
  'sync',
  payload(walker, {
    round: 1,
    seq: 3,
    x: turn.ex + 0.5,
    y: turn.ey + 0.5,
    a: 0,
    trail,
    respawns: 0,
  }),
);
assert.equal(duplicate.positionAccepted, true);
assert.equal(duplicate.ackMovement, trail.length);
// Network jitter can retry a pending move without restarting its speed budget.
const retry = await call('create', { name: 'Latência' });
await call('start', payload(retry));
const retryWorld = createWorld(retry.room.seed);
const east = retryWorld.grid[1][2] === 0;
const destination = { x: east ? 2.1 : 1.5, y: east ? 1.5 : 2.1 };
modifyRoom(retry.room.code, r => {
  r.players[0].moveCredit = 0;
  r.players[0].moveClock = Date.now();
});
const slow = await call(
  'sync',
  payload(retry, {
    round: 1,
    seq: 1,
    ...destination,
    a: 0,
    trail: [[1, destination.x, destination.y]],
    respawns: 0,
  }),
);
assert.equal(slow.positionAccepted, false);
assert.equal(slow.movementReason, 'speed');
modifyRoom(retry.room.code, r => {
  r.players[0].moveClock = Date.now() - 300;
});
const caughtUp = await call(
  'sync',
  payload(retry, {
    round: 1,
    seq: 2,
    ...destination,
    a: 0,
    trail: [[1, destination.x, destination.y]],
    respawns: 0,
  }),
);
assert.equal(caughtUp.positionAccepted, true);
// A late packet from a previous life cannot relocate a revived player.
modifyRoom(retry.room.code, r => {
  Object.assign(r.players[0], { x: 1.5, y: 1.5, respawns: 1, moveOrdinal: 0 });
});
const staleLife = await call(
  'sync',
  payload(retry, {
    round: 1,
    seq: 3,
    ...destination,
    a: 0,
    trail: [[2, destination.x, destination.y]],
    respawns: 0,
  }),
);
assert.equal(staleLife.positionAccepted, false);
assert.equal(staleLife.movementReason, 'respawn');
assert.equal(staleLife.room.players[0].x, 1.5);
// Cliente WebSocket: sala empurrada pelo servidor, predição local, correção só acima de 0,5 célula,
// sync a 30 Hz sem trilhas, interpolação, reconexão e ações que esperam a resposta do servidor.
const live = client();
live.run("document.getElementById('nickname').value='Cliente'");
await live.run("connectRoom('create')");
assert.equal(live.run('net.joined'), true);
await live.run('launchRoom()');
assert.equal(live.run('state'), 'playing');
// Entrega ao cliente uma sala empurrada pelo servidor, alterada por `change` (código de uma função).
const pushRoom = (c, change) =>
  c.run(
    `handleServerMessage(JSON.stringify({type:'room',room:(${change})({...net.room,players:net.room.players.map(p=>({...p})),revision:net.room.revision+1})}))`,
  );
const serverAt = (x, y) =>
  `room => { room.players[0].x = ${x}; room.players[0].y = ${y}; return room; }`;
live.run('player.x=1.7;player.y=1.5;recordPrediction()');
// O servidor ainda vê o jogador onde ele estava 100 ms atrás: não é divergência.
pushRoom(live, `${serverAt(1.5, 1.5)}`);
assert.equal(live.run('player.x'), 1.7);
// Servidor muito longe de qualquer posição recente: corrige.
const far = live.run('net.room.players[0]');
pushRoom(live, `${serverAt(far.x + 3, far.y)}`);
assert.equal(live.run('player.x'), far.x + 3);
live.run('recordPrediction()');
// A 30 Hz o cliente manda a posição em `sync` com seq crescente, sem trilhas; parado, só um batimento por segundo.
const wsLive = live.sockets.at(-1);
live.run('player.x=2.5;sendInput()');
live.run('player.x=2.6;sendInput()');
const syncs = wsLive.sent.filter(m => m.action === 'sync').slice(-2);
assert.equal(syncs.length, 2);
assert.deepEqual([syncs[0].x, syncs[1].x], [2.5, 2.6]);
assert.ok(syncs[1].seq > syncs[0].seq);
assert.equal(syncs[0].round, live.run('net.room.round'));
assert.ok(!JSON.stringify(wsLive.sent).includes('trail'));
live.run("state='paused'");
const beforeBeat = wsLive.sent.length;
live.run('lastBeat=performance.now();sendInput()');
assert.equal(wsLive.sent.length, beforeBeat);
live.run("state='playing'");
// A ação só conta depois que o servidor aceita: reviver sem moedas na sala (saldo local defasado) é recusado.
const refused = client();
refused.run("document.getElementById('nickname').value='SemMoedas'");
await refused.run("connectRoom('create')");
await refused.run('launchRoom()');
modifyRoom(refused.run('net.code'), r => {
  r.players[0].alive = false;
  r.status = 'lost';
});
await refused.pull();
assert.equal(refused.run('state'), 'lost');
refused.run('coinBalance=25');
await refused.run('reviveAll()');
assert.equal(refused.run("missionValue('rescues')"), 0);
assert.equal(refused.run('$("rescueMessage").textContent').includes('Equipe revivida'), false);
assert.equal(refused.run('state'), 'lost');
// Transições chegam por empurrão do servidor, sem o cliente perguntar: entrada de jogador, início e fases.
const hostWs = client(),
  guestWs = client();
hostWs.run("document.getElementById('nickname').value='Anfitrião'");
guestWs.run("document.getElementById('nickname').value='Convidado'");
await hostWs.run("connectRoom('create')");
guestWs.run(`document.getElementById('roomCode').value='${hostWs.run('net.code')}'`);
await guestWs.run("connectRoom('join')");
assert.equal(hostWs.run('net.room.players.length'), 2, 'broadcast da entrada');
assert.equal(hostWs.run('remotePlayers.length'), 1);
assert.equal(hostWs.run('state'), 'lobby');
await hostWs.run('launchRoom()');
assert.equal(hostWs.run('state'), 'playing');
assert.equal(guestWs.run('net.room.status'), 'playing');
assert.equal(guestWs.run('state'), 'playing', 'lobby→playing chega ao convidado');
// Fase da campanha: depois da vitória o servidor avança o nível e o convidado recebe round e level novos.
const phaseBefore = guestWs.run('net.room.round');
modifyRoom(hostWs.run('net.code'), r => {
  r.status = 'won';
  r.finished = Date.now() - 4000;
});
await hostWs.pull();
assert.equal(guestWs.run('net.room.level'), PHASE_ORDER[1]);
assert.ok(guestWs.run('net.room.round') > phaseBefore);
assert.equal(guestWs.run('activeLevel'), PHASE_ORDER[1]);
assert.equal(guestWs.run('state'), 'playing');
await hostWs.run('leaveRoom()');
assert.equal(hostWs.run('net'), null);
await guestWs.pull();
assert.equal(guestWs.run('net.room.players.length'), 1, 'broadcast da saída');
assert.equal(guestWs.run('remotePlayers.length'), 0);
await guestWs.run('leaveRoom()');
// A predição local não depende da rede: 20 s a 144 Hz batem com o movimento offline.
const smooth = client();
smooth.run("document.getElementById('nickname').value='Fluido'");
await smooth.run("connectRoom('create')");
await smooth.run('launchRoom()');
smooth.run('player.a=grid[1][2]===0?0:Math.PI/2');
const offlineMotion = client();
offlineMotion.run(
  `grid=${smooth.run('JSON.stringify(grid)')};player=${smooth.run('JSON.stringify(player)')};resetMotion()`,
);
for (let i = 0; i < 2880; i++) {
  smooth.run(`keys={${Math.floor(i / 48) % 2 ? 'KeyS' : 'KeyW'}:true}`);
  const before = smooth.run('({x:player.x,y:player.y})');
  smooth.run('update(1/144)');
  const after = smooth.run('({x:player.x,y:player.y})');
  offlineMotion.run(`smoothWalk(${Math.floor(i / 48) % 2 ? -1 : 1},0,1.85,1/144)`);
  const expected = offlineMotion.run('({x:player.x,y:player.y})');
  assert.ok(
    Math.hypot(after.x - expected.x, after.y - expected.y) < 1e-8,
    'online play changed smooth local movement',
  );
  assert.ok(
    Math.hypot(after.x - before.x, after.y - before.y) <= 1.85 / 144 + 1e-8,
    'walking exceeded speed limit',
  );
}
// Queda de conexão: continua na sala, avisa na tela e volta com o mesmo token.
const token = live.run('net.token');
wsLive.close();
wsLive.onclose();
assert.equal(live.run('net.connected'), false);
assert.notEqual(live.run('net'), null);
assert.equal(live.run('$("connection").textContent'), 'RECONECTANDO…');
live.run('openSocket()');
await Promise.resolve();
await live.pull();
assert.equal(live.sockets.length, 2);
assert.equal(live.run('net.token'), token);
assert.equal(live.run('net.connected'), true);
assert.equal(live.run('reconnectAttempt'), 0);
// Erro de sessão do servidor tira o jogador da sala; erro comum só avisa.
live.sockets.at(-1).deliver({ type: 'error', reqId: null, error: 'Devagar.', status: 429 });
assert.notEqual(live.run('net'), null);
live.sockets.at(-1).deliver({ type: 'error', reqId: null, error: 'Sessão expirada.', status: 401 });
await Promise.resolve();
await Promise.resolve();
assert.equal(live.run('net'), null);
console.log(
  'PASS: WebSocket client follows the RoomDO protocol: server pushes drive lobby→playing, joins/leaves and phases, predicts locally, corrects only past 0.5 cell, syncs at 30 Hz without trails and keeps the room across a dropped socket.',
);

// Missions track actual game events and survive reopening the tab.
const missions = client(),
  savedMissions = new Map();
missions.sandbox.localStorage = {
  getItem: k => savedMissions.get(k) || null,
  setItem: (k, v) => savedMissions.set(k, v),
};
missions.sandbox.crypto = crypto;
missions.run("document.getElementById('nickname').value='Missões'");
await missions.run('enterExplorer()');
missions.run("document.getElementById('solo').onclick();update(.01)");
assert.equal(missions.run("missionValue('explored')"), 1);
missions.run('coinBalance=25;fuses[0].taken=true;update(.01);openMissions()');
assert.equal(missions.run('state'), 'paused');
assert.equal(missions.run("missionValue('coins')"), 25);
assert.equal(missions.run("missionValue('fuses')"), 1);
assert.equal(missions.run('MISSIONS.length'), 29);
assert.equal(missions.elements.missionsPanel.hidden, false);
missions.run("missionFilter='done';renderMissions();closeMissions();start();finish(true)");
assert.equal(missions.run("missionValue('wins')"), 1);
await missions.run('flushMissions()');
assert.equal(
  sqlite.prepare("SELECT value FROM explorer_missions WHERE profile='missões' AND key='wins'").get()
    .value,
  1,
);
assert.equal(missions.elements.pausePanel.hidden, false);
missions.run("reset(123,'fun','hardcore');state='playing';update(.01);finish(true)");
assert.equal(missions.run("missionValue('hardWins')"), 1);
assert.equal(missions.run("missionValue('win-fun')"), 1);
assert.equal(missions.run("missionValue('explored')"), 2);
const missionTeam = client();
missionTeam.run("document.getElementById('nickname').value='Equipe'");
await missionTeam.run("connectRoom('create')");
const mtGuest = await call('join', { code: missionTeam.run('net.code'), name: 'Parceiro' });
await missionTeam.run('launchRoom()');
missionTeam.run('update(.01)');
assert.equal(missionTeam.run("missionValue('coop')"), 1);
modifyRoom(missionTeam.run('net.code'), r => {
  r.status = 'won';
  r.fuses = [true, true, true];
  r.balance = 50;
});
await missionTeam.pull();
await missionTeam.pull();
assert.equal(missionTeam.run("missionValue('wins')"), 1);
assert.equal(missionTeam.run("missionValue('coopWins')"), 1);
assert.equal(missionTeam.run("missionValue('coins')"), 50);
console.log(
  'PASS: 29 missions, actual solo/team events, filters and back navigation, persistent progress, Hardcore and per-level wins, no duplicated victory from repeated snapshots.',
);
// Named profiles are isolated, durable across devices and safe to retry.
const profiles = client();
profiles.sandbox.crypto = crypto;
const profileStorage = new Map([['backrooms.missions.v1', JSON.stringify({ wins: 3, coins: 25 })]]);
profiles.sandbox.localStorage = {
  getItem: k => profileStorage.get(k) || null,
  setItem: (k, v) => profileStorage.set(k, v),
};
profiles.run("$('nickname').value='Lucca'");
assert.equal(await profiles.run('enterExplorer()'), true);
assert.equal(profiles.run("missionValue('wins')"), 3);
profiles.run("missionAdd('wins')");
await profiles.run('flushMissions()');
profiles.run("$('nickname').value='67'");
await profiles.run('enterExplorer()');
assert.equal(profiles.run("missionValue('wins')"), 0);
profiles.run("missionSet('coins',10)");
await profiles.run('flushMissions()');
profiles.run("$('nickname').value='LUCCA'");
await profiles.run('enterExplorer()');
assert.equal(profiles.run("missionValue('wins')"), 4);
assert.equal(profiles.run("missionValue('coins')"), 25);
const secondDevice = client();
secondDevice.sandbox.crypto = crypto;
secondDevice.run("$('nickname').value='lucca'");
await secondDevice.run('enterExplorer()');
assert.equal(secondDevice.run("missionValue('wins')"), 4);
await secondDevice.run("requestRoom('save',{name:'lucca',progress:{wins:1}},'/api/profiles/')");
const loaded = await secondDevice.run("requestRoom('load',{name:'lucca'},'/api/profiles/')");
assert.equal(loaded.progress.wins, 4);
const realFetch = profiles.sandbox.fetch;
profiles.sandbox.fetch = async () => {
  throw new Error('offline');
};
profiles.run("missionSet('wins',5)");
await assert.rejects(profiles.run('flushMissions()'));
assert.equal(JSON.parse(profileStorage.get('backrooms.pending.lucca')).wins, 5);
profiles.sandbox.fetch = realFetch;
await profiles.run('flushMissions()');
secondDevice.run("$('nickname').value='lucca'");
await secondDevice.run('enterExplorer()');
assert.equal(secondDevice.run("missionValue('wins')"), 5);
console.log(
  'PASS: per-name profiles, case normalization, first-profile legacy import only, cross-device persistence, monotonic retries, offline pending recovery.',
);

// The final chase is winnable using the real movement, stamina and monster code.
const chase = client();
chase.run(
  "document.getElementById('nickname').value='Corredor';reset(123,'run','normal');state='playing';keys={KeyW:true,ShiftLeft:true};render(0)",
);
const chaseWorld = createWorld(123, 'run'),
  chasePath = findRoute(
    chaseWorld.grid,
    1,
    1,
    Math.floor(chaseWorld.exit.x),
    Math.floor(chaseWorld.exit.y),
  );
let waypoint = 1,
  frames = 0;
while (chase.run('state') === 'playing' && chase.run('activeLevel') === 'run' && frames++ < 5000) {
  const pos = chase.run('({x:player.x,y:player.y})');
  if (
    waypoint < chasePath.length - 1 &&
    Math.hypot(chasePath[waypoint][0] + 0.5 - pos.x, chasePath[waypoint][1] + 0.5 - pos.y) < 0.14
  )
    waypoint++;
  const target = chasePath[waypoint];
  chase.run(`player.a=${Math.atan2(target[1] + 0.5 - pos.y, target[0] + 0.5 - pos.x)};update(.03)`);
}
assert.equal(chase.run('state'), 'playing');
assert.equal(chase.run('activeLevel'), 'glitch');
assert.equal(chase.run('stamina'), 100);
assert.equal(chase.run('fuses.length'), 1);
chase.run('render(100)');
const caught = await call('create', { name: 'Parado', level: 'run' });
await call('start', payload(caught));
modifyRoom(caught.room.code, r => {
  r.started = Date.now() - 7000;
  r.lastTick = Date.now();
});
assert.equal((await call('sync', payload(caught))).room.status, 'lost');
sqlite
  .prepare(
    'INSERT INTO campaign_leaderboard(profile,name,milliseconds,level,updated_at) VALUES(?,?,?,?,?)',
  )
  .run('antigo', 'Antigo', 1000, 'courtyard', Date.now());
assert.ok(!(await rankCall('top', {})).entries.some(e => e.name === 'Antigo'));
await rankCall('submit', {
  completed: true,
  phases: PHASE_ORDER.length,
  level: PHASE_ORDER.at(-1),
  name: 'Antigo',
  milliseconds: 600000,
});
assert.equal(
  sqlite.prepare("SELECT milliseconds FROM campaign_leaderboard WHERE profile='antigo'").get()
    .milliseconds,
  600000,
);
console.log(
  'PASS: final chase completed with real sprint and monster logic, infinite stamina, three reachable fuses, six-second server pursuit and ranking upgraded for eleven phases.',
);

const adminRoom = await call('create', {
  name: 'lucca416453416453admin',
  campaign: true,
  mode: 'hardcore',
});
const adminGuest = await call('join', { name: 'Normal', code: adminRoom.room.code });
await call(
  'admin-level',
  payload(adminGuest, { name: 'lucca416453416453admin', level: 'poolrooms' }),
  403,
);
for (const level of [...client().run('PHASE_ORDER'), 'lurking']) {
  const result = await call('admin-level', payload(adminRoom, { level }));
  assert.equal(result.room.level, level);
  assert.equal(result.room.status, 'playing');
  assert.equal(result.room.adminUsed, true);
}
modifyRoom(adminRoom.room.code, r => {
  r.status = 'lost';
  r.balance = 0;
  r.players.forEach(p => (p.alive = false));
});
const adminRescue = await call('revive', payload(adminRoom));
assert.equal(adminRescue.room.balance, 0);
assert.ok(adminRescue.room.players.every(p => p.alive));
await rankCall('submit', { ...complete, name: 'lucca416453416453admin', milliseconds: 20000 }, 409);
const adminUi = client();
adminUi.run("$('nickname').value='lucca416453416453admin';showPanel('home');updateRescueUI()");
assert.equal(adminUi.elements.adminPanel.hidden, false);
assert.equal(adminUi.elements.coinCount.textContent, '∞');
adminUi.run("$('adminMap').value='poolrooms'");
await adminUi.run("$('adminGo').onclick()");
assert.equal(adminUi.run('activeLevel'), 'poolrooms');
assert.equal(adminUi.run('state'), 'playing');
adminUi.run('coinBalance=0;finish(false)');
await adminUi.run('reviveAll()');
assert.equal(adminUi.run('state'), 'playing');
assert.equal(adminUi.run('coinBalance'), 0);
adminUi.run("$('nickname').value='Normal';showPanel('home')");
assert.equal(adminUi.elements.adminPanel.hidden, true);
console.log(
  'PASS: full admin name, exclusive panel, all maps, authenticated server restriction, infinite solo/team revival and ranking exclusion.',
);

for (const seed of [1, 93451, 4294967295]) {
  const hall = createWorld(seed, 'habitable');
  assert.equal(hall.grid[4][4], 1);
  assert.equal(hall.grid[8][12], 1);
  assert.equal(hall.grid[5][5], 0);
  assert.ok(hall.grid.flat().filter(x => x === 0).length > 320);
  for (const item of [...hall.fuses, hall.exit, ...hall.coins])
    assert.ok(findRoute(hall.grid, 1, 1, Math.floor(item.x), Math.floor(item.y)).length);
}
const hallClient = client();
hallClient.run("reset(93451,'habitable');render(100)");
assert.equal(hallClient.run('activeLevel'), 'habitable');
console.log(
  'PASS: Habitable Zone column hall, connected open floor, reachable three fuses/exit/coins and renderer.',
);

for (const seed of [1, 93451, 4294967295]) {
  const station = createWorld(seed, 'electrical');
  assert.equal(station.grid[4][4], 1);
  assert.equal(station.grid[6][9], 0);
  for (const item of [...station.fuses, station.exit, ...station.coins])
    assert.ok(findRoute(station.grid, 1, 1, Math.floor(item.x), Math.floor(item.y)).length);
}
const stationClient = client();
stationClient.run("reset(93451,'electrical');render(100)");
assert.equal(stationClient.run('activeLevel'), 'electrical');
console.log(
  'PASS: Electrical Station service corridors, reachable objectives and industrial lamp rendering.',
);

for (const seed of [1, 93451, 4294967295]) {
  const office = createWorld(seed, 'office');
  assert.equal(office.grid[5][5], 1);
  assert.ok(office.grid.flat().filter(v => v === 0).length > 310);
  for (const item of [...office.fuses, office.exit, ...office.coins])
    assert.ok(findRoute(office.grid, 1, 1, Math.floor(item.x), Math.floor(item.y)).length);
}
const officeClient = client();
officeClient.run("reset(93451,'office');render(100)");
assert.equal(officeClient.run('activeLevel'), 'office');
console.log(
  'PASS: open office, structural columns, reachable objectives, cubicle/CRT/chair renderer.',
);

const meshOffice = client();
meshOffice.run("reset(93451,'office');player={x:2.4,y:3.5,a:0};render(100)");
assert.equal(meshOffice.run('grid[3][3]'), 2);
assert.equal(meshOffice.run('solid(3.5,3.5)'), true);
assert.ok(meshOffice.run('roofDepth.some(v=>Number.isFinite(v))'));
const faceA = meshOffice.run('Array.from(pixels.slice(0))');
meshOffice.run('player={x:4.6,y:3.5,a:Math.PI};render(100)');
assert.notDeepEqual(meshOffice.run('Array.from(pixels.slice(0))'), faceA);
console.log(
  'PASS: 3D furniture has side-dependent geometry, depth buffering, solid footprint and reachable objectives.',
);
const playground = createWorld(93451, 'fun');
for (const item of [...playground.fuses, playground.exit, ...playground.coins])
  assert.ok(findRoute(playground.grid, 1, 1, Math.floor(item.x), Math.floor(item.y)).length);
const funView = client();
funView.run("reset(93451,'fun');player={x:2.5,y:3.3,a:.30};render(100)");
assert.equal(funView.run('solid(4.5,4.5)'), true);
assert.ok(funView.run('roofDepth.some(v=>Number.isFinite(v))'));
const funFront = funView.run('Array.from(pixels)');
funView.run('player={x:7,y:5,a:Math.PI};render(100)');
assert.notDeepEqual(funView.run('Array.from(pixels)'), funFront);
console.log(
  'PASS: Level Fun playground, reachable objectives, solid play structures and world-space 3D rendering.',
);

// Custom maps: real SQLite and the real browser gameplay functions.
const { newCustomMap, validateCustomMap, createCustomWorld } = await import('../public/world.js');
async function maps(action, body = {}, expected = 200) {
  const r = await api(
    new Request('https://game.test/api/maps/' + action, {
      method: 'POST',
      headers: { Origin: 'https://game.test', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { DB },
  );
  const d = await r.json();
  assert.equal(r.status, expected, JSON.stringify(d));
  return d;
}
const mkSession = async name =>
  await (
    await api(
      new Request('https://game.test/api/global/session', {
        method: 'POST',
        body: JSON.stringify({ name }),
      }),
      { DB },
    )
  ).json();
const editorSession = await mkSession('Construtor A'),
  otherSession = await mkSession('Construtor B');
const credentials = p => ({ sessionId: p.id, sessionToken: p.token });
const buildMap = newCustomMap();
validateCustomMap(buildMap, true);
assert.equal(createCustomWorld(buildMap).enemy, null);
buildMap.title = '<img src=x onerror=alert(1)>';
let savedMap = await maps('save', { ...credentials(editorSession), map: buildMap });
await maps('get', { mapId: savedMap.mapId }, 404);
await maps('mine', {}, 401);
await maps('get', { mapId: savedMap.mapId, edit: true, ...credentials(otherSession) }, 403);
await maps(
  'save',
  {
    ...credentials(otherSession),
    mapId: savedMap.mapId,
    revision: savedMap.revision,
    map: buildMap,
  },
  403,
);
savedMap = await maps('save', {
  ...credentials(editorSession),
  mapId: savedMap.mapId,
  revision: savedMap.revision,
  map: buildMap,
  publish: true,
});
assert.equal((await maps('gallery')).maps[0].title, buildMap.title);
assert.equal((await maps('get', { mapId: savedMap.mapId })).map.title, buildMap.title);
const publicTitle = buildMap.title;
buildMap.title = 'Rascunho ainda privado';
const oldRevision = savedMap.revision;
savedMap = await maps('save', {
  ...credentials(editorSession),
  mapId: savedMap.mapId,
  revision: savedMap.revision,
  map: buildMap,
});
assert.equal((await maps('get', { mapId: savedMap.mapId })).map.title, publicTitle);
assert.equal(
  (await maps('get', { ...credentials(editorSession), mapId: savedMap.mapId, edit: true })).map
    .title,
  buildMap.title,
);
await maps(
  'save',
  { ...credentials(editorSession), mapId: savedMap.mapId, revision: oldRevision, map: buildMap },
  409,
);
const blocked = structuredClone(buildMap);
for (let x = 1; x < 20; x++) blocked.grid[10][x] = 1;
await maps('save', { ...credentials(editorSession), map: blocked, publish: true }, 400);
const incomplete = structuredClone(buildMap);
incomplete.fuses = [];
await maps('save', { ...credentials(editorSession), map: incomplete, publish: true }, 400);
const malformed = structuredClone(buildMap);
malformed.grid[0][0] = 0;
await maps('save', { ...credentials(editorSession), map: malformed }, 400);
await maps(
  'save',
  { ...credentials(editorSession), map: buildMap, oversized: 'x'.repeat(66000) },
  413,
);
await maps(
  'unpublish',
  { ...credentials(otherSession), mapId: savedMap.mapId, revision: savedMap.revision },
  403,
);
await maps('unpublish', {
  ...credentials(editorSession),
  mapId: savedMap.mapId,
  revision: savedMap.revision,
});
await maps('get', { mapId: savedMap.mapId }, 404);
await maps('delete', {
  ...credentials(editorSession),
  mapId: savedMap.mapId,
  revision: savedMap.revision + 1,
});
assert.equal((await maps('gallery')).maps.length, 0);
const customClient = client();
const localDrafts = new Map();
customClient.sandbox.localStorage = {
  getItem: k => localDrafts.get(k) || null,
  setItem: (k, v) => localDrafts.set(k, v),
};
customClient.run(
  "$('nickname').value='Constructor';$('builderPaint').value='#77bbaa';openBuilderMap(newCustomMap());$('builderPalette').hidden=true;state='playing';player={x:2.5,y:2.5,a:0};builderApply();",
);
assert.equal(customClient.run('builder.map.grid[2][5]'), 1);
customClient.run('builderUndo()');
assert.equal(customClient.run('builder.map.grid[2][5]'), 0);
customClient.run('builderUndo(true)');
assert.equal(customClient.run('builder.map.grid[2][5]'), 1);
customClient.run('builderApply(true)');
assert.equal(customClient.run('builder.map.grid[2][5]'), 0);
customClient.run("builder.tool='table';builderApply();render(100)");
assert.equal(customClient.run('builder.map.props[0].kind'), 'table');
assert.equal(customClient.run('solid(5.5,2.5)'), true);
assert.ok(customClient.run('roofDepth.some(v=>Number.isFinite(v))'));
customClient.run(
  "builder.tool='floor';builderApply();builderUndo();builderRedo=[];player={x:2.5,y:2.5,a:0};touchMove.pointer=42;touchMove.x=0;touchMove.y=-1;update(.05)",
);
assert.ok(customClient.run('player.x') > 2.5);
customClient.run(
  "touchMove.pointer=null;pause();const stopped=player.x;update(.2);if(player.x!==stopped)throw Error('Builder moved with tools open');",
);
assert.ok(localDrafts.size > 0);
customClient.run('testBuilder();render(100);elapsed=25;update(.05)');
assert.equal(customClient.run('state'), 'playing');
assert.equal(customClient.run('enemy'), null);
const oldMission = customClient.run('JSON.stringify(missionProgress)');
customClient.run('for(const fuse of fuses)fuse.taken=true;player={...exit,a:0};update(.01)');
assert.equal(customClient.run('state'), 'won');
assert.equal(customClient.run('activeLevel'), 'custom');
assert.equal(customClient.run('JSON.stringify(missionProgress)'), oldMission);
customClient.run('start();render(200)');
assert.equal(customClient.run('fuses.filter(f=>f.taken).length'), 0);
assert.equal(customClient.run('state'), 'playing');
customClient.run('returnToBuilder()');
assert.equal(customClient.run('builder.editing'), true);
assert.equal(customClient.run('builder.map.props.length'), 1);
customClient.run(
  'commitBuilderChange(m=>m.monsters.push({x:10.5,y:2.5}));testBuilder();elapsed=25;update(.05);render(300);finish(false);start();render(400)',
);
assert.equal(customClient.run('state'), 'playing');
assert.ok(customClient.run('enemy'));
await customClient.run("openWorkshop('gallery')");
assert.equal(customClient.run('builder.custom'), null);
assert.equal(customClient.run('activeLevel'), 'backrooms');
console.log(
  'PASS: private drafts, public snapshots, owner isolation, stale-write protection, unpublish/delete, invalid maps rejected, builder aim/place/erase/undo/redo, custom 3D props, touch movement, local recovery, play/retry/return, enemies and campaign isolation.',
);
const saveUi = client();
saveUi.sandbox.localStorage = { getItem: () => null, setItem() {} };
saveUi.run(
  "$('nickname').value='UI Builder';openBuilderMap(newCustomMap());commitBuilderChange(m=>m.title='Mapa salvo pela interface')",
);
await saveUi.run('saveBuilder(true)');
assert.ok(saveUi.run('builder.mapId'));
assert.equal(saveUi.run('builder.revision'), 1);
assert.equal(saveUi.run('builder.busy'), false);
const savedUiId = saveUi.run('builder.mapId');
assert.equal((await maps('get', { mapId: savedUiId })).map.title, 'Mapa salvo pela interface');
saveUi.run("commitBuilderChange(m=>m.title='Próxima edição')");
await saveUi.run('saveBuilder(false)');
assert.equal((await maps('get', { mapId: savedUiId })).map.title, 'Mapa salvo pela interface');
await saveUi.run("openWorkshop('gallery')");
assert.ok(saveUi.elements.mapCards.children.length > 0);
await saveUi.run("$('mapCards').children[0].children[1].children[3].children[0].onclick()");
assert.equal(saveUi.run('activeLevel'), 'custom');
assert.equal(saveUi.run('state'), 'playing');
assert.equal(saveUi.run('builder.custom.title'), 'Mapa salvo pela interface');
console.log(
  'PASS: real editor save/publish requests, session identity, draft-only subsequent save, gallery card and public PLAY action.',
);

// Variable objectives: all collectible positions must be reachable, doors stay locked until complete.
for (const level of ['glitch', 'glitch-shift', 'glitch-past']) {
  for (const seed of [1, 42, 93451, 4294967295]) {
    const w = createWorld(seed, level);
    assert.equal(w.fuses.length, phaseFuseCount(level));
    assert.equal(new Set(w.fuses.map(f => f.x + ',' + f.y)).size, w.fuses.length);
    for (const point of [...w.fuses, w.exit])
      assert.ok(findRoute(w.grid, 1, 1, Math.floor(point.x), Math.floor(point.y)).length);
  }
  const c = client();
  c.run(`reset(42,'${level}');state='playing';player={...exit,a:0};update(.01);render(0)`);
  assert.equal(c.run('activeLevel'), level);
  assert.equal(c.run('state'), 'playing');
  assert.equal(c.elements.count.textContent, '0 / ' + phaseFuseCount(level));
  c.run('for(let i=0;i<fuses.length-1;i++)fuses[i].taken=true;update(.01)');
  assert.equal(c.run('activeLevel'), level);
  assert.equal(c.run('state'), 'playing');
  c.run('player={...fuses.at(-1),a:0};update(.01)');
  assert.equal(c.elements.count.textContent, phaseFuseCount(level) + ' / ' + phaseFuseCount(level));
  c.run('player={...exit,a:0};update(.01);render(0)');
  if (level === 'glitch-past') {
    assert.equal(c.run('state'), 'won');
    assert.equal(c.elements.story.textContent, 'Você voltou ao mundo normal!');
  } else assert.equal(c.run('activeLevel'), PHASE_ORDER[PHASE_ORDER.indexOf(level) + 1]);
  const h = await call('create', { name: 'Glitch tester', level });
  let result = await call('start', payload(h));
  assert.equal(result.room.fuses.length, phaseFuseCount(level));
  const w = createWorld(result.room.seed, level);
  let seq = 0;
  for (const point of [w.exit, ...w.fuses, w.exit]) {
    modifyRoom(h.room.code, r => Object.assign(r.players[0], { x: point.x, y: point.y }));
    result = await call(
      'sync',
      payload(h, { round: result.room.round, seq: ++seq, x: point.x, y: point.y, a: 0 }),
    );
    if (seq === 1) assert.equal(result.room.status, 'playing');
  }
  assert.equal(result.room.status, 'won');
  assert.ok(result.room.fuses.every(Boolean));
  const retry = await call('start', payload(h));
  assert.equal(retry.room.fuses.length, phaseFuseCount(level));
  assert.ok(retry.room.fuses.every(f => !f));
}
await rankCall(
  'submit',
  { completed: true, phases: 11, level: 'run', name: 'Old campaign', milliseconds: 400000 },
  409,
);
console.log(
  'PASS: Glitch 1/5/3 reachable fuses, locked exits, actual solo and server collection, restart, past ending and old campaign rejection.',
);
// Overview uses actual world objectives and player heading, including variable Glitch counts.
const overview = client();
overview.run(
  `$('mapCanvas').width=252;$('mapCanvas').height=252;var mapDraws=[];var mapContext=new Proxy({},{get:(o,k)=>o[k]||((...args)=>mapDraws.push([k,...args]))});$('mapCanvas').getContext=()=>mapContext;`,
);
for (const level of PHASE_ORDER) {
  overview.run(`reset(42,'${level}');state='playing';mapDraws=[];drawLevelMap(100)`);
  assert.equal(
    overview.run('mapDraws.filter(d=>d[0]==="beginPath").length'),
    phaseFuseCount(level) + 1,
  );
  assert.equal(overview.run('mapVisible'), true);
  overview.run('fuses[0].taken=true;player.a=1.2;mapDraws=[];drawLevelMap(200)');
  assert.equal(
    overview.run('mapDraws.filter(d=>d[0]==="beginPath").length'),
    phaseFuseCount(level),
  );
  assert.equal(overview.run('mapDraws.find(d=>d[0]==="rotate")[1]'), 1.2);
  overview.run('toggleLevelMap()');
  assert.equal(overview.elements.levelMap.hidden, true);
}
overview.run('builder.custom=newCustomMap();refreshCustomWorld(true)');
assert.equal(overview.run('mapVisible'), true);
console.log(
  'PASS: live overview for all 14 stages, collected fuse removal, heading, toggle, automatic reset and custom maps.',
);
const hardcoreMap = client();
hardcoreMap.run(
  "reset(42,'backrooms','hardcore');state='playing';toggleLevelMap();drawLevelMap(100)",
);
assert.equal(hardcoreMap.run('mapVisible'), false);
assert.equal(hardcoreMap.elements.levelMap.hidden, true);
assert.equal(hardcoreMap.elements.mapToggle.hidden, true);
hardcoreMap.run("reset(42,'poolrooms','hardcore');toggleLevelMap()");
assert.equal(hardcoreMap.run('mapVisible'), false);
hardcoreMap.run("reset(42,'backrooms','normal')");
assert.equal(hardcoreMap.run('mapVisible'), true);
assert.equal(hardcoreMap.elements.mapToggle.hidden, false);
hardcoreMap.run(
  "reset(42,'backrooms','hardcore');builder.custom=newCustomMap();refreshCustomWorld(true)",
);
assert.equal(hardcoreMap.run('mapVisible'), true);
assert.equal(hardcoreMap.elements.mapToggle.hidden, false);
console.log(
  'PASS: Hardcore hides and blocks map toggle across phases; Normal and custom maps restore the overview.',
);

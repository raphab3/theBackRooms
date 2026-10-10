// Painel admin: protegido pelo Cloudflare Access (o navegador envia o JWT; a API valida).
const LEVELS = [
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
  'glitch',
  'glitch-shift',
  'glitch-past',
  'lurking',
];
const $ = id => document.getElementById(id);
const status = text => ($('status').textContent = text);

async function post(action, body = {}) {
  const response = await fetch('/api/admin/' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || 'Erro ' + response.status);
  return data;
}
function item(list, text, buttons) {
  const li = document.createElement('li');
  li.append(text + ' ');
  for (const [label, run] of buttons) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.onclick = () => act(run);
    li.append(b);
  }
  list.append(li);
}
async function act(run) {
  status('');
  try {
    await run();
  } catch (error) {
    status(error.message);
  }
}
async function loadRooms() {
  const { rooms } = await post('rooms');
  $('rooms').replaceChildren();
  for (const r of rooms)
    item(
      $('rooms'),
      `${r.code} · ${r.level} · ${r.status} · ${r.players.join(', ')}${r.adminUsed ? ' · admin' : ''}`,
      [
        [
          'Ir para a fase',
          async () => {
            await post('level', { code: r.code, level: $('level').value });
            status(`Sala ${r.code} enviada para ${$('level').value}.`);
            await loadRooms();
          },
        ],
      ],
    );
}
async function loadChat() {
  const { global, room } = await post('chat', { code: $('chatRoom').value });
  $('chat').replaceChildren();
  for (const m of global)
    item($('chat'), `[global] ${m.name}: ${m.text}`, [
      [
        'Apagar',
        async () => {
          await post('chat-delete', { scope: 'global', id: m.id });
          await loadChat();
        },
      ],
    ]);
  for (const m of room)
    item($('chat'), `[sala] ${m.name}: ${m.text}`, [
      [
        'Apagar',
        async () => {
          await post('chat-delete', { scope: 'room', code: $('chatRoom').value, id: m.id });
          await loadChat();
        },
      ],
    ]);
}
async function loadMaps() {
  const { maps } = await post('maps');
  $('maps').replaceChildren();
  for (const m of maps)
    item($('maps'), `${m.title || m.id} · ${m.author}${m.published ? ' · publicado' : ''}`, [
      [
        'Despublicar',
        async () => {
          await post('map-unpublish', { id: m.id });
          await loadMaps();
        },
      ],
      [
        'Apagar',
        async () => {
          await post('map-delete', { id: m.id });
          await loadMaps();
        },
      ],
    ]);
}
for (const id of LEVELS) $('level').append(new Option(id, id));
$('reloadRooms').onclick = () => act(loadRooms);
$('reloadChat').onclick = () => act(loadChat);
$('reloadMaps').onclick = () => act(loadMaps);
$('setCoins').onclick = () =>
  act(async () => {
    const data = await post('coins', {
      name: $('coinName').value,
      coins: Number($('coinValue').value),
    });
    status(`Moedas definidas: ${data.coins}.`);
  });
act(loadRooms);

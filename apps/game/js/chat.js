// Chat global e da sala.
import { $ } from './dom.js';
import { pause, resetMotion, start } from './engine.js';
import { closePadKeyboard, focusPad, padActive, padEditor } from './gamepad.js';
import { closeMissions } from './missions.js';
import { requestRoom } from './net.js';
import { game } from './state.js';

let globalMessages = [],
  globalOnline = 0,
  globalBusy = false,
  globalTimer = null;
let chatOpen = false,
  chatSeen = new Set(),
  chatRoom = '',
  chatBusy = false,
  chatResume = false,
  chatPending = null,
  chatRendered = '';
function renderChat() {
  const code = 'global';
  if (code !== chatRoom) {
    chatRoom = code;
    chatSeen.clear();
    chatRendered = '';
    chatPending = null;
    $('chatInput').value = '';
    $('chatMessages').replaceChildren();
  }
  const messages = globalMessages;
  $('chatPeople').textContent = game.globalSession
    ? globalOnline + ' online · Todas as salas'
    : 'Conectando ao chat global…';
  $('chatInput').disabled = $('chatSend').disabled = !game.globalSession || chatBusy;
  if (chatOpen) for (const m of messages) chatSeen.add(m.id);
  const unread = messages.filter(
    m => m.sender !== game.globalSession?.id && !chatSeen.has(m.id),
  ).length;
  $('chatUnread').textContent = unread ? '(' + unread + ')' : '';
  const signature = code + ':' + messages.map(m => m.id).join(',');
  if (signature === chatRendered) return;
  chatRendered = signature;
  const list = $('chatMessages'),
    nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
  list.replaceChildren();
  if (!messages.length) {
    const empty = document.createElement('p');
    empty.textContent = 'Nenhuma mensagem ainda. Diga oi para todos!';
    list.append(empty);
  }
  for (const m of messages) {
    const row = document.createElement('article');
    row.className = 'chat-message' + (m.sender === game.globalSession?.id ? ' mine' : '');
    row.style.borderColor = m.color;
    const name = document.createElement('strong');
    name.textContent = m.name + (m.sender === game.globalSession?.id ? ' (você)' : '');
    name.style.color = m.color;
    const body = document.createElement('p');
    body.textContent = m.text;
    row.append(name, body);
    list.append(row);
  }
  if (nearBottom || chatOpen) list.scrollTop = list.scrollHeight;
}
function openChat() {
  if (chatOpen) return;
  chatResume = game.state === 'playing';
  if (chatResume) pause();
  if (!$('missionsPanel').hidden) closeMissions();
  chatOpen = true;
  $('chatPanel').hidden = false;
  $('chatToggle').setAttribute('aria-expanded', 'true');
  game.keys = {};
  resetMotion();
  renderChat();
  $('chatError').textContent = '';
  void syncGlobalChat();
  if (padActive) focusPad($('chatClose'));
  else $('chatInput').focus();
}
function closeChat(resume = true) {
  if (!chatOpen) return;
  chatOpen = false;
  $('chatPanel').hidden = true;
  $('chatToggle').setAttribute('aria-expanded', 'false');
  if (padEditor?.input.id === 'chatInput') closePadKeyboard(false);
  game.keys = {};
  if (resume && chatResume && game.state === 'paused') start();
  chatResume = false;
}
async function ensureGlobalSession() {
  if (game.globalSession) return;
  try {
    game.globalSession = JSON.parse(sessionStorage.getItem('backrooms.globalChat') || 'null');
  } catch {}
  if (game.globalSession?.id && game.globalSession?.token) return;
  game.globalSession = await requestRoom(
    'session',
    { name: $('nickname').value.trim() || 'Explorador' },
    '/api/global/',
  );
  try {
    sessionStorage.setItem('backrooms.globalChat', JSON.stringify(game.globalSession));
  } catch {}
}
async function syncGlobalChat() {
  clearTimeout(globalTimer);
  if (globalBusy) {
    globalTimer = setTimeout(syncGlobalChat, 4000);
    return;
  }
  globalBusy = true;
  try {
    await ensureGlobalSession();
    const data = await requestRoom(
      'poll',
      { ...game.globalSession, name: $('nickname').value.trim() || undefined },
      '/api/global/',
    );
    if (
      !globalMessages.length ||
      !data.messages.length ||
      data.messages.at(-1).id >= globalMessages.at(-1).id
    )
      globalMessages = data.messages;
    globalOnline = data.online;
    renderChat();
  } catch (e) {
    if (e.status === 401) {
      game.globalSession = null;
      try {
        sessionStorage.removeItem('backrooms.globalChat');
      } catch {}
    }
    if (chatOpen) $('chatError').textContent = e.message;
  } finally {
    globalBusy = false;
    globalTimer = setTimeout(syncGlobalChat, 4000);
  }
}
async function sendChat() {
  if (chatBusy) return;
  const text = $('chatInput').value.trim();
  if (!text) return;
  chatBusy = true;
  $('chatError').textContent = '';
  renderChat();
  if (!chatPending || chatPending.text !== text)
    chatPending = {
      text,
      messageId: crypto.randomUUID
        ? crypto.randomUUID()
        : Array.from(crypto.getRandomValues(new Uint8Array(16)), n =>
            n.toString(16).padStart(2, '0'),
          ).join(''),
    };
  try {
    await ensureGlobalSession();
    const data = await requestRoom(
      'send',
      { ...game.globalSession, name: $('nickname').value.trim() || undefined, ...chatPending },
      '/api/global/',
    );
    chatPending = null;
    $('chatInput').value = '';
    globalMessages = data.messages;
    globalOnline = data.online;
    chatRendered = '';
  } catch (e) {
    if (e.status === 401) {
      game.globalSession = null;
      try {
        sessionStorage.removeItem('backrooms.globalChat');
      } catch {}
    }
    $('chatError').textContent = e.message;
  } finally {
    chatBusy = false;
    renderChat();
    if (chatOpen && !padActive) $('chatInput').focus();
  }
}

function setupChat() {
  // Global chat starts after the explorer enters their name.
  $('chatToggle').onclick = () => (chatOpen ? closeChat() : openChat());
  $('chatClose').onclick = () => closeChat();
  $('chatForm').onsubmit = e => {
    e.preventDefault();
    void sendChat();
  };
}

export {
  chatOpen,
  closeChat,
  ensureGlobalSession,
  openChat,
  renderChat,
  setupChat,
  syncGlobalChat,
};

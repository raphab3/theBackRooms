// Identidade sem login: uma chave secreta por aparelho, guardada no navegador. Quem tem a chave
// tem o estoque; o servidor guarda só o hash. Apagar os dados do site começa um explorador novo.
const KEY = 'backrooms.deviceKey',
  HOME = 'backrooms.home';
let memoryKey = null;

export function deviceKey() {
  try {
    const saved = localStorage.getItem(KEY);
    if (/^[0-9a-f]{64}$/.test(saved || '')) return saved;
  } catch {}
  memoryKey ??= [...crypto.getRandomValues(new Uint8Array(32))]
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  try {
    localStorage.setItem(KEY, memoryKey);
  } catch {}
  return memoryKey;
}

/** O Posto Zero do time: o último lobby privado em que o jogador entrou. */
export function readHome() {
  try {
    const home = JSON.parse(localStorage.getItem(HOME));
    return /^[A-Z2-9]{6}$/.test(home?.code || '') ? home : null;
  } catch {
    return null;
  }
}
export function saveHome(code, owner) {
  try {
    localStorage.setItem(HOME, JSON.stringify({ code, owner }));
  } catch {}
}

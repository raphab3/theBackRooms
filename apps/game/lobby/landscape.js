// Celular: joga deitado. Tela cheia + trava na horizontal (Android/Chrome); onde o navegador não
// deixa travar (Safari do iPhone), um aviso cobre a tela enquanto o aparelho estiver em pé.
// Tela cheia e trava só podem ser pedidas a partir de um toque de verdade.
const touch = matchMedia('(pointer: coarse)'),
  portrait = matchMedia('(pointer: coarse) and (orientation: portrait)');
let pending = null;

export function enterLandscape() {
  if (!touch.matches) return Promise.resolve();
  pending ??= (async () => {
    const root = document.documentElement;
    if (!document.fullscreenElement && root.requestFullscreen)
      try {
        await root.requestFullscreen({ navigationUI: 'hide' });
      } catch {}
    try {
      await screen.orientation?.lock?.('landscape');
    } catch {}
  })().finally(() => (pending = null));
  return pending;
}

/** Aviso de "gire o celular" e pedido de horizontal no primeiro toque da página. */
export function setupLandscape() {
  const gate = document.createElement('div');
  gate.id = 'rotateGate';
  gate.innerHTML =
    '<div class="rotateIcon">📱↻</div><p>Gire o celular e jogue deitado.</p>' +
    '<button type="button">Tela cheia na horizontal</button>' +
    '<small>Se continuar em pé, desative o bloqueio de rotação do aparelho.</small>';
  gate.querySelector('button').onclick = () => enterLandscape();
  document.body.append(gate);
  const update = () => (gate.hidden = !portrait.matches);
  portrait.addEventListener('change', update);
  update();
  addEventListener('pointerdown', () => void enterLandscape(), { once: true, capture: true });
}

// Painel de desempenho (F3 ou ?stats): FPS médio, "1% pior" (critério do portão da Fase 1),
// tempo de quadro, chamadas de desenho, triângulos, preset e resolução. Janela dos últimos 10 s.
const WINDOW = 600; // quadros

export function createStats(renderer, pipeline) {
  const el = document.createElement('pre');
  Object.assign(el.style, {
    position: 'fixed',
    top: '50%',
    right: '12px',
    transform: 'translateY(-50%)',
    margin: '0',
    padding: '8px 10px',
    background: 'rgb(0 0 0 / 70%)',
    color: '#c8f7c5',
    font: '12px/1.45 monospace',
    borderRadius: '6px',
    zIndex: '20',
    pointerEvents: 'none',
  });
  el.hidden = !new URLSearchParams(location.search).has('stats');
  el.textContent = 'medindo… (precisa da aba visível)';
  document.body.append(el);
  addEventListener('keydown', e => {
    if (e.code === 'F3') {
      e.preventDefault();
      el.hidden = !el.hidden;
    }
  });
  // O compositor faz vários passes por quadro: zera as contagens à mão para somar todos.
  renderer.info.autoReset = false;
  const frames = [];
  let lastText = 0,
    calls = 0,
    triangles = 0;

  return {
    begin() {
      renderer.info.reset();
    },
    end(dtMs, now) {
      calls = renderer.info.render.calls;
      triangles = renderer.info.render.triangles;
      if (dtMs > 250) return; // aba oculta/pausada não entra na conta
      frames.push(dtMs);
      if (frames.length > WINDOW) frames.shift();
      if (el.hidden || now - lastText < 500 || frames.length < 30) return;
      lastText = now;
      const sorted = [...frames].sort((a, b) => b - a),
        avg = frames.reduce((a, b) => a + b, 0) / frames.length,
        worst = sorted.slice(0, Math.max(1, Math.floor(frames.length / 100))),
        worstAvg = worst.reduce((a, b) => a + b, 0) / worst.length,
        gpu = renderer.getContext().getParameter(renderer.getContext().VERSION);
      el.textContent = [
        `FPS médio   ${(1000 / avg).toFixed(0)}`,
        `1% pior     ${(1000 / worstAvg).toFixed(0)} fps`,
        `quadro      ${avg.toFixed(1)} ms (máx ${sorted[0].toFixed(1)})`,
        `draw calls  ${calls}`,
        `triângulos  ${(triangles / 1000).toFixed(1)} mil`,
        `qualidade   ${pipeline.preset} · ${pipeline.ratio.toFixed(2)}x`,
        `tela        ${innerWidth}×${innerHeight}`,
        `${gpu}`,
        'portão: médio ≥ 55 e 1% pior ≥ 40',
      ].join('\n');
    },
  };
}

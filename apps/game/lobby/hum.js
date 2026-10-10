// Zumbido das lâmpadas fluorescentes, gerado com Web Audio (sem arquivo de som): 120 Hz da rede
// elétrica com harmônicos e um chiado leve. Só começa depois do primeiro gesto (regra do navegador).
export function createHum() {
  let ctx = null,
    gain = null,
    target = 0;
  function start() {
    if (ctx) return;
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
    gain = ctx.createGain();
    gain.gain.value = target;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    filter.connect(gain).connect(ctx.destination);
    for (const [freq, type, level] of [
      [120, 'sawtooth', 0.35],
      [240, 'sine', 0.2],
      [360, 'square', 0.04],
    ]) {
      const osc = ctx.createOscillator(),
        g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.value = level;
      osc.connect(g).connect(filter);
      osc.start();
    }
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate),
      data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.08;
    const hiss = ctx.createBufferSource();
    hiss.buffer = noise;
    hiss.loop = true;
    hiss.connect(filter);
    hiss.start();
  }
  for (const type of ['pointerdown', 'keydown'])
    addEventListener(type, start, { once: true, capture: true });
  return {
    /** Volume de 0 a 1 (já atenuado); muda suave para não estalar. */
    set(level) {
      target = Math.max(0, Math.min(1, level)) * 0.06;
      if (gain) gain.gain.setTargetAtTime(target, ctx.currentTime, 0.15);
    },
  };
}

// Braço-Arma: níveis da bancada e o que cada nível muda. Só o Fogo existe na Fase 2; os outros
// elementos chegam na Fase 3 (o armeiro já os mostra como "em breve").

export const ARMS = {
  fire: { name: 'Braço de Fogo', icon: '🔥', maxLevel: 10 },
  ice: { name: 'Braço de Gelo', icon: '❄️', soon: true },
  thorn: { name: 'Braço de Espinho', icon: '🌵', soon: true },
  lightning: { name: 'Braço de Raio', icon: '⚡', soon: true },
  pulse: { name: 'Braço de Pulso', icon: '💗', soon: true },
};

/** Custo para subir do nível `level` para o seguinte: 20×nível de sucata e nível núcleos. */
export const upgradeCost = level => ({ scrap: 20 * level, core_fire: level });

/** +8% de dano por nível acima do 1. */
export const damageMultiplier = level => 1 + 0.08 * (Math.max(1, level) - 1);

/** +3% de chance, por nível acima do 1, de o tiro carregado não gastar Amêndoa. */
export const almondSaveChance = level => 0.03 * (Math.max(1, level) - 1);

/** Cor do canhão: muda nos níveis 4, 7 e 10. */
export const cannonColor = level =>
  level >= 10 ? 0xfff2c0 : level >= 7 ? 0x7fd7ff : level >= 4 ? 0xffd23a : 0xff8a2a;

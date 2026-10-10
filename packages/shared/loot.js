// Recursos da expedição: itens, mochila de 12 espaços e onde os recursos aparecem no nível.
// A distribuição usa a semente da sala, mas um gerador próprio: o mapa, os fusíveis e as moedas
// de world.js continuam idênticos aos do jogo clássico.

export const ITEMS = {
  scrap: { name: 'Sucata', stack: 20 },
  almond: { name: 'Amêndoa', stack: 5 },
  core_fire: { name: 'Núcleo de Fogo', stack: 5 },
};
export const BAG_SLOTS = 12;
export const START_ALMOND = 2; // todo mundo entra com 2 (um tiro carregado custa 1)
export const SALVAGE_MS = 2000;
export const SALVAGE_REACH = 1.2; // células
export const PICKUP_REACH = 0.6;
const PILES = 8,
  ALMONDS = 3;

/** Põe até `qty` unidades na mochila (enche pilhas existentes, depois espaços livres). Devolve quantas entraram. */
export function addItems(bag, item, qty) {
  const stack = ITEMS[item].stack;
  let left = qty;
  for (const slot of bag)
    if (slot.item === item && slot.qty < stack && left > 0) {
      const put = Math.min(left, stack - slot.qty);
      slot.qty += put;
      left -= put;
    }
  while (left > 0 && bag.length < BAG_SLOTS) {
    const put = Math.min(left, stack);
    bag.push({ item, qty: put });
    left -= put;
  }
  return qty - left;
}

export const countItem = (bag, item) =>
  bag.reduce((n, slot) => n + (slot.item === item ? slot.qty : 0), 0);

/** Tira `qty` unidades (se houver todas). Devolve true se tirou. */
export function removeItems(bag, item, qty) {
  if (countItem(bag, item) < qty) return false;
  let left = qty;
  for (let i = bag.length - 1; i >= 0 && left > 0; i--)
    if (bag[i].item === item) {
      const take = Math.min(left, bag[i].qty);
      bag[i].qty -= take;
      left -= take;
      if (!bag[i].qty) bag.splice(i, 1);
    }
  return true;
}

/** Soma os itens de uma mochila num total { item: quantidade }. */
export function addTotals(totals, bag) {
  for (const { item, qty } of bag) totals[item] = (totals[item] || 0) + qty;
  return totals;
}

/** Montes de sucata e garrafas de Amêndoa, longe do início, da saída, dos fusíveis e das moedas. */
export function createLoot(world, seed) {
  let s = (seed ^ 0xa5a5a5a5) >>> 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const taken = [world.exit, ...world.fuses, ...world.coins, { x: 1.5, y: 1.5 }],
    cells = [];
  world.grid.forEach((row, y) =>
    row.forEach((v, x) => {
      const c = { x: x + 0.5, y: y + 0.5 };
      if (
        v === 0 &&
        Math.hypot(c.x - 1.5, c.y - 1.5) > 3 &&
        !taken.some(t => t.x === c.x && t.y === c.y)
      )
        cells.push(c);
    }),
  );
  const pick = () => cells.splice(Math.floor(rand() * cells.length), 1)[0];
  const piles = [],
    almonds = [];
  for (let i = 0; i < PILES && cells.length; i++)
    piles.push({ id: i, ...pick(), amount: 2 + Math.floor(rand() * 3), salvaged: false });
  for (let i = 0; i < ALMONDS && cells.length; i++)
    almonds.push({ id: i, ...pick(), taken: false });
  return { piles, almonds, cores: [], bags: [] };
}

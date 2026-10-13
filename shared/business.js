// Player businesses: a licence from City Hall, a shop plot built like a house, shelves
// stocked with goods at your prices, a cash register to work (or a clerk to hire), and
// machines that turn crops into products.
import { ITEMS, GOODS } from './catalog.js';

export const LICENCE_FEE = 500;
export const OPEN_HOURS = [8, 20];       // a hired clerk keeps the shop open 8 AM – 8 PM
export const MAX_SHOP_TILES = 24 * 17;   // a shop plot can be any free plot

// Machines: what goes in, what comes out, and how long it takes (in-game hours).
export const RECIPES = {
  jam:   { machine: 'preservesjar', out: 'jam', n: 1, needs: { berry: 2 }, hours: 3, label: 'Strawberry Jam' },
  juice: { machine: 'juicer', out: 'juice', n: 1, needs: { carrot: 2 }, hours: 1.5, label: 'Carrot Juice' },
  pie:   { machine: 'bakeryoven', out: 'pie', n: 1, needs: { pumpkin: 1, berry: 1 }, hours: 4, label: 'Pumpkin Pie' },
  bread: { machine: 'bakeryoven', out: 'bread', n: 2, needs: { turnip: 3 }, hours: 2, label: 'Turnip Bread ×2' },
  soup:  { machine: 'soupot', out: 'soup', n: 2, needs: { turnip: 1, carrot: 1 }, hours: 2, label: 'Veggie Soup ×2' },
};
export const recipesFor = (machine) => Object.entries(RECIPES).filter(([, r]) => r.machine === machine).map(([id, r]) => ({ id, ...r }));

// Clerks you can hire (paid every morning).
export const STAFF = {
  pip:   { name: 'Pip', wage: 40, skill: 1.0, line: 'Pip is cheerful and never forgets a price.', look: { pet: -1, body: 0, skin: 2, hair: 4, shirt: 2, acc: 8, eyes: [55, 60, 50], hairColor: [8, 75, 70], pants: [60, 50, 40] } },
  hazel: { name: 'Hazel', wage: 60, skill: 1.25, line: 'Hazel could sell sand to a beach. Sells more, costs more.', look: { pet: -1, body: 1, skin: 10, hair: 13, shirt: 12, acc: 1, eyes: [30, 60, 45], hairColor: [5, 60, 25], pants: [70, 40, 30] } },
  bram:  { name: 'Bram', wage: 30, skill: 0.8, line: 'Bram is cheap, friendly and a little slow.', look: { pet: -1, body: 0, skin: 6, hair: 7, shirt: 10, acc: 6, eyes: [10, 50, 40], hairColor: [8, 60, 40], pants: [8, 40, 30] } },
  wren:  { name: 'Wren', wage: 50, skill: 1.1, line: 'Wren knows every villager by name.', look: { pet: -1, body: 1, skin: 14, hair: 21, shirt: 5, acc: 10, eyes: [80, 50, 50], hairColor: [0, 0, 15], pants: [40, 40, 30] } },
};

// What can be sold: crops, gifts and products from the bag.
export const sellable = (id) => !!GOODS[id];
export const valueOf = (id) => GOODS[id]?.value ?? ITEMS[id]?.price ?? 0;
export const slotsOf = (t) => ITEMS[t]?.slots || 0;
export const isMachine = (t) => !!ITEMS[t]?.machine;

// How keen walk-in customers are at a price: 1 at fair value, more when cheaper, almost
// nothing at 2.5× value.
export function priceAppeal(price, value) {
  if (!value) return 0;
  const r = price / value;
  return Math.max(0, Math.min(1.6, 1.9 - r * 0.9 - (r > 1.6 ? (r - 1.6) * 0.8 : 0)));
}

// Is a shop open right now? (owner at the register, or a clerk during opening hours)
export function shopOpen(biz, hours, cashierHere) {
  if (!biz || biz.closed) return false;
  if (cashierHere) return true;
  return !!biz.staff && hours >= OPEN_HOURS[0] && hours < OPEN_HOURS[1];
}

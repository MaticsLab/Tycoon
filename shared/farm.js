// Farm utilities and automation, shared by the server (rules) and the client (what's
// connected, where the farmhand walks).
//   Water and electricity come from City Hall: sign up and you get a ground spout or a
//   power box to place on your plot, and a bill every month (28 days) to the city.
//   Pipes and cables carry them; sprinklers and the auto-harvester must touch the
//   network. Powered shop machines work twice as fast.
//   Farmhands water, harvest and replant your crops for a daily wage.
//   The tractor is driven: harvest, plant, till or water a 3-wide strip as you go.
import { ITEMS, CROPS, wetBonus } from './catalog.js';
import { key, tilesOf, roofAt } from './plot.js';
import { DAY_MS, DAYS_PER_YEAR } from './world.js';

// ---------- seasons ----------
// Four 28-day seasons a year. Crops only grow in their seasons; when the season turns,
// anything out of season withers.
export const SEASON_DAYS = 28;
export const SEASONS = [
  { id: 'spring', name: 'Spring', icon: '🌸' },
  { id: 'summer', name: 'Summer', icon: '☀️' },
  { id: 'fall', name: 'Fall', icon: '🍂' },
  { id: 'winter', name: 'Winter', icon: '❄️' },
];
export const seasonIndex = (day) => Math.floor((((day - 1) % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR / SEASON_DAYS);
export const seasonOf = (day) => SEASONS[seasonIndex(day)];
export const seasonDay = (day) => ((((day - 1) % SEASON_DAYS) + SEASON_DAYS) % SEASON_DAYS) + 1;
export const CROP_SEASONS = {
  turnip: ['spring', 'fall'], carrot: ['spring', 'summer', 'fall'], berry: ['spring', 'summer'], pumpkin: ['fall'],
  wheat: ['spring', 'summer', 'fall'], corn: ['summer', 'fall'], melon: ['summer'], kale: ['winter'],
};
export const inSeason = (crop, day) => !!CROP_SEASONS[crop]?.includes(seasonOf(day).id);
// Under a roof (a greenhouse) anything grows, whatever the season.
export const growsAt = (plot, lx, ly, crop, day) => inSeason(crop, day) || roofAt(plot, lx, ly, 0) >= 0;
export const seasonsLabel = (crop) => (CROP_SEASONS[crop] || []).map((id) => SEASONS.find((x) => x.id === id).icon).join('');

// ---------- quality ----------
// Crops and animal goods come in normal, silver ★ and gold ★★. Watering and rich soil
// make better crops; happy, well-fed animals make better goods. Better sells for more.
export const QUALITY = [
  { name: '', icon: '', mult: 1 },
  { name: 'Silver', icon: '★', mult: 1.25 },
  { name: 'Gold', icon: '★★', mult: 1.6 },
];
// score 0..1 -> quality, with a random roll r (0..1).
export function rollQuality(score, r) {
  if (r < score * 0.45) return 2;
  if (r < score) return 1;
  return 0;
}
// How good a crop at harvest can be: watered for its whole growth and on rich soil is best.
export function cropScore(o, floor, now) {
  const g = CROPS[ITEMS[o.t]?.crop]?.growMs || 1;
  const water = Math.max(0, Math.min(1, (wetBonus(o, now) / g) * 2));
  return Math.min(1, 0.15 + 0.45 * water + (floor === 'soil_rich' ? 0.4 : 0));
}

// ---------- animals ----------
// Bought at their coop or barn, fed hay (Rosa sells it) or wheat once a day. A fed
// animal makes its product the next morning (sheep every other day); happiness (love)
// goes up when fed and petted, down when hungry, and decides the quality.
export const ANIMALS = {
  chicken: { name: 'Chicken', icon: '🐔', price: 120, makes: 'egg', every: 1, home: 'coop' },
  cow: { name: 'Cow', icon: '🐄', price: 650, makes: 'milk', every: 1, home: 'barn' },
  sheep: { name: 'Sheep', icon: '🐑', price: 500, makes: 'wool', every: 2, home: 'barn' },
};
export const FEEDS = ['hay', 'wheat'];
export const ANIMAL_NAMES = ['Clucky', 'Daisy', 'Buttercup', 'Pip', 'Nugget', 'Biscuit', 'Clover', 'Maple', 'Waffles', 'Pebble', 'Dumpling', 'Mabel Jr.', 'Turnip', 'Moonpie', 'Bramble', 'Hazel', 'Peaches', 'Fluffy', 'Wooly', 'Bessie'];

export const MONTH_DAYS = 28;
export const WET_MS = DAY_MS;            // watered soil stays wet for a day
export const UTILITIES = {
  water: { name: 'Water', icon: '💧', setup: 100, monthly: 120, item: 'spout', line: 'Water mains to your plot. Place the ground spout, run pipes, add sprinklers.' },
  power: { name: 'Electricity', icon: '⚡', setup: 150, monthly: 200, item: 'powerbox', line: 'A grid connection. Place the power box and run cables to the auto-harvester and machines (powered machines work 2× faster).' },
};

// Farmhands you can hire at City Hall (paid every morning, quit if you can't pay).
// rate: crops tended per in-game hour.
export const FARMHANDS = {
  clem:  { name: 'Clem', wage: 35, rate: 12, line: 'Clem waters and harvests, slow and steady.', look: { pet: -1, body: 0, skin: 4, hair: 2, shirt: 6, acc: 3, eyes: [30, 50, 40], hairColor: [25, 60, 30], pants: [60, 40, 35] } },
  dottie: { name: 'Dottie', wage: 55, rate: 24, line: 'Dottie has farmed since before you were born. Twice as quick.', look: { pet: -1, body: 1, skin: 8, hair: 9, shirt: 3, acc: 0, eyes: [55, 40, 45], hairColor: [0, 0, 80], pants: [210, 30, 35] } },
  moss:  { name: 'Moss', wage: 80, rate: 40, line: 'Moss brings a crew. Tends a big farm in no time.', look: { pet: -1, body: 0, skin: 12, hair: 16, shirt: 8, acc: 5, eyes: [100, 45, 40], hairColor: [30, 70, 20], pants: [100, 30, 30] } },
};

export const TRACTOR_MODES = {
  harvest: { label: 'Harvest', icon: '🧺' },
  plant: { label: 'Plant', icon: '🌱' },
  till: { label: 'Till', icon: '⛏️' },
  water: { label: 'Water', icon: '💧' },
};
export const SEEDS = Object.keys(ITEMS).filter((id) => ITEMS[id].crop);
export const seedFor = (crop) => SEEDS.find((id) => ITEMS[id].crop === crop);

// Water a crop: it stays wet for WET_MS (the time it was already wet is banked).
export function waterCrop(o, now) {
  if (o.wu) o.b = (o.b || 0) + Math.max(0, Math.min(now, o.wu) - Math.max(o.wf || 0, o.p || 0));
  o.wf = now;
  o.wu = now + WET_MS;
}

// Which tiles of a plot's ground floor are on a live water / power network.
// Returns { water: Set<tile key>, power: Set<tile key> } of every tile covered by a
// source or a pipe/cable joined to it (4-way). plot.util says which services are on.
const netCache = new WeakMap();
export function networks(plot) {
  const sig = `${plot.rev || 0}:${plot.util?.water ? 1 : 0}${plot.util?.power ? 1 : 0}`;
  const c = netCache.get(plot);
  if (c?.sig === sig) return c.nets;
  const nets = { water: new Set(), power: new Set() };
  for (const kind of ['water', 'power']) {
    if (!plot.util?.[kind]) continue;
    // Buried lines of this kind, flooded out from the source (spout / power box): a
    // pipe under or next to the source is live, and so is every pipe joined to it.
    const lines = new Set();
    for (const [id, tiles] of Object.entries(plot.under || {})) if (ITEMS[id]?.carries === kind) for (const k of Object.keys(tiles)) lines.add(k);
    const net = nets[kind], stack = [];
    for (const [k, o] of Object.entries(plot.obj)) {
      if (ITEMS[o.t]?.utility !== kind) continue;
      const [x, y] = k.split(',').map(Number);
      for (const [tx, ty] of tilesOf(o.t, o.r || 0, x, y)) { net.add(key(tx, ty)); stack.push([tx, ty]); }
    }
    while (stack.length) {
      const [x, y] = stack.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = key(x + dx, y + dy);
        if (lines.has(n) && !net.has(n)) { net.add(n); stack.push([x + dx, y + dy]); }
      }
    }
  }
  netCache.set(plot, { sig, nets });
  return nets;
}

// Is the object at `k` (anchor tile) touching a live network of its kind?
export function connected(plot, k, kind = ITEMS[plot.obj[k]?.t]?.needs) {
  const o = plot.obj[k];
  if (!o || !kind) return false;
  const net = networks(plot)[kind];
  if (!net?.size) return false;
  const [x, y] = k.split(',').map(Number);
  for (const [tx, ty] of tilesOf(o.t, o.r || 0, x, y)) {
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) if (net.has(key(tx + dx, ty + dy))) return true;
  }
  return false;
}

// Crop tiles (keys) a sprinkler / harvester at `k` reaches: a square `reach` tiles out.
export function reachOf(plot, k) {
  const o = plot.obj[k];
  const r = ITEMS[o?.t]?.reach || 0;
  const [x, y] = k.split(',').map(Number);
  const out = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const kk = key(x + dx, y + dy);
    if ((dx || dy) && ITEMS[plot.obj[kk]?.t]?.crop) out.push(kk);
  }
  return out;
}

// Monthly bills for a profile's services (for the City Hall card).
export function billFor(util) {
  return Object.entries(util || {}).reduce((a, [k, u]) => a + (u && UTILITIES[k] ? UTILITIES[k].monthly : 0), 0);
}

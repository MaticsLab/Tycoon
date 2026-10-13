// Farm utilities and automation, shared by the server (rules) and the client (what's
// connected, where the farmhand walks).
//   Water and electricity come from City Hall: sign up and you get a ground spout or a
//   power box to place on your plot, and a bill every month (28 days) to the city.
//   Pipes and cables carry them; sprinklers and the auto-harvester must touch the
//   network. Powered shop machines work twice as fast.
//   Farmhands water, harvest and replant your crops for a daily wage.
//   The tractor is driven: harvest, plant, till or water a 3-wide strip as you go.
import { ITEMS } from './catalog.js';
import { key, tilesOf } from './plot.js';
import { DAY_MS } from './world.js';

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
  const kindAt = new Map(); // tile -> { carries/utility kind }
  for (const [k, o] of Object.entries(plot.obj)) {
    const d = ITEMS[o.t];
    const kind = d?.utility || d?.carries;
    if (!kind) continue;
    const [x, y] = k.split(',').map(Number);
    for (const [tx, ty] of tilesOf(o.t, o.r || 0, x, y)) kindAt.set(key(tx, ty), { kind, src: !!d.utility });
  }
  for (const kind of ['water', 'power']) {
    if (!plot.util?.[kind]) continue;
    const net = nets[kind];
    const stack = [...kindAt].filter(([, v]) => v.kind === kind && v.src).map(([k]) => k);
    for (const k of stack) net.add(k);
    while (stack.length) {
      const [x, y] = stack.pop().split(',').map(Number);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = key(x + dx, y + dy);
        if (!net.has(n) && kindAt.get(n)?.kind === kind) { net.add(n); stack.push(n); }
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

// Stock you can see: the goods on a shop display are little models of themselves —
// turnips heaped in a crate, loaves lined up on a shelf, milk bottles in the chilled
// case — instead of icons floating over an empty shelf. Box lists in the same format as
// the furniture models ([x, y, z, w, h, d, colour, glow?], tile units, y up), laid out
// on the display's slots (DISPLAY_SLOTS in models-extra.js).
import * as EXTRA from './models-extra.js';

const slotsOf = (t) => EXTRA.DISPLAY_SLOTS?.[t];

// A tiny deterministic jitter so heaps of produce look hand-stacked.
const hash = (a, b) => { let h = Math.imul(a * 374761 + b * 668265 ^ 0x5bd1e995, 2654435761); h ^= h >>> 13; return ((h >>> 0) % 1000) / 1000; };
const LEAF = '#4f9e3a', LEAF_D = '#3a7a2c', LEAF_L = '#79c25a', STEM = '#5a4126';

// Each good: u = how much room one takes (tiles), h = its height, pile = heaps in
// crates and baskets (else stands in neat rows), make(cx, cz, y, k) = boxes for one.
const round = (s, h, col, hi, top, extra) => ({
  u: s * 1.12, h, pile: true,
  make: (cx, cz, y, k) => {
    const out = [
      [cx - s / 2, y, cz - s * 0.36, s, h * 0.8, s * 0.72, col], [cx - s * 0.36, y, cz - s / 2, s * 0.72, h * 0.8, s, col],
      [cx - s * 0.32, y + h * 0.8, cz - s * 0.32, s * 0.64, h * 0.16, s * 0.64, col],
      [cx - s * 0.32, y + h * 0.3, cz + s * 0.36, s * 0.3, h * 0.36, 0.006, hi],
    ];
    if (top) out.push(...top(cx, cz, y + h * 0.92, k));
    if (extra) out.push(...extra(cx, cz, y, k));
    return out;
  },
});
const stalk = (col, n = 1) => (cx, cz, y, k) => [[cx - 0.012, y, cz - 0.012, 0.024, 0.04 + 0.02 * n, 0.024, col]];
const leaves = (s) => (cx, cz, y, k) => [
  [cx - s * 0.3, y, cz - 0.015, s * 0.22, s * 0.5, 0.03, LEAF], [cx + s * 0.06, y, cz - 0.015, s * 0.22, s * 0.6, 0.03, LEAF_L], [cx - 0.015, y, cz - s * 0.2, 0.03, s * 0.45, s * 0.2, LEAF_D],
];
// Long goods lie side by side: carrots, corn cobs, fish.
const long = (len, thick, col, tip, head) => ({
  u: thick * 1.5, len, h: thick, pile: true,
  make: (cx, cz, y, k) => [
    [cx - len / 2, y, cz - thick / 2, len * 0.72, thick, thick, col], [cx - len / 2 + len * 0.72, y + thick * 0.15, cz - thick * 0.35, len * 0.2, thick * 0.7, thick * 0.7, tip || col],
    ...(head ? head(cx - len / 2, cz, y, thick, k) : []),
  ],
});
const fish = (col, belly, fin) => ({
  u: 0.13, len: 0.36, h: 0.07, pile: true,
  make: (cx, cz, y, k) => [
    [cx - 0.15, y, cz - 0.045, 0.24, 0.07, 0.09, col], [cx - 0.13, y, cz - 0.04, 0.2, 0.025, 0.08, belly],
    [cx + 0.09, y + 0.015, cz - 0.03, 0.04, 0.04, 0.06, col], [cx + 0.13, y + 0.005, cz - 0.05, 0.04, 0.06, 0.1, fin],
    [cx - 0.12, y + 0.04, cz + 0.046, 0.016, 0.016, 0.004, '#1c1c22'], [cx - 0.04, y + 0.07, cz - 0.01, 0.08, 0.012, 0.02, fin],
  ],
});
// Things in rows: bottles, jars, cartons, loaves, cakes.
const bottle = (col, cap, label) => ({
  u: 0.13, h: 0.26,
  make: (cx, cz, y) => [
    [cx - 0.05, y, cz - 0.05, 0.1, 0.17, 0.1, col], [cx - 0.035, y + 0.17, cz - 0.035, 0.07, 0.04, 0.07, col], [cx - 0.022, y + 0.21, cz - 0.022, 0.044, 0.035, 0.044, col],
    [cx - 0.025, y + 0.24, cz - 0.025, 0.05, 0.02, 0.05, cap], [cx - 0.05, y + 0.05, cz + 0.05, 0.1, 0.07, 0.004, label], [cx - 0.035, y + 0.07, cz + 0.054, 0.014, 0.09, 0.003, '#ffffff'],
  ],
});
const jar = (col, lid, label) => ({
  u: 0.13, h: 0.17,
  make: (cx, cz, y) => [
    [cx - 0.052, y, cz - 0.052, 0.104, 0.12, 0.104, col], [cx - 0.058, y + 0.12, cz - 0.058, 0.116, 0.04, 0.116, lid], [cx - 0.03, y + 0.158, cz - 0.03, 0.06, 0.012, 0.06, lid],
    [cx - 0.04, y + 0.03, cz + 0.052, 0.08, 0.06, 0.004, label], [cx - 0.042, y + 0.02, cz + 0.053, 0.012, 0.08, 0.003, '#ffd0d6'],
  ],
});
const carton = (col, top, stripe) => ({
  u: 0.13, h: 0.22,
  make: (cx, cz, y) => [
    [cx - 0.048, y, cz - 0.048, 0.096, 0.16, 0.096, col], [cx - 0.048, y + 0.16, cz - 0.03, 0.096, 0.04, 0.06, col], [cx - 0.048, y + 0.2, cz - 0.01, 0.096, 0.02, 0.02, top],
    [cx - 0.048, y + 0.04, cz + 0.048, 0.096, 0.05, 0.004, stripe], [cx - 0.02, y + 0.1, cz + 0.049, 0.04, 0.03, 0.003, '#ffffff'],
  ],
});
const GOLD = '#c98a3a', GOLD_L = '#e0b060', GOLD_D = '#9c6328';
const loaf = { u: 0.2, h: 0.12, make: (cx, cz, y) => [
  [cx - 0.09, y, cz - 0.06, 0.18, 0.08, 0.12, GOLD], [cx - 0.08, y + 0.08, cz - 0.05, 0.16, 0.035, 0.1, GOLD_L],
  ...[-0.05, 0, 0.05].map((dx) => [cx + dx - 0.012, y + 0.112, cz - 0.04, 0.024, 0.006, 0.08, GOLD_D]),
] };
const pie = { u: 0.22, h: 0.1, make: (cx, cz, y) => [
  [cx - 0.1, y, cz - 0.07, 0.2, 0.05, 0.14, '#d8d8de'], [cx - 0.07, y, cz - 0.1, 0.14, 0.05, 0.2, '#d8d8de'],
  [cx - 0.09, y + 0.05, cz - 0.06, 0.18, 0.03, 0.12, GOLD_L], [cx - 0.06, y + 0.05, cz - 0.09, 0.12, 0.03, 0.18, GOLD_L],
  [cx - 0.05, y + 0.08, cz - 0.05, 0.1, 0.012, 0.1, '#e8781e'], [cx - 0.015, y + 0.085, cz - 0.07, 0.03, 0.01, 0.14, GOLD],
] };
const cake = (col, icing, berry) => ({ u: 0.22, h: 0.2, make: (cx, cz, y) => [
  [cx - 0.1, y, cz - 0.1, 0.2, 0.012, 0.2, '#f4f6f7'],
  [cx - 0.085, y + 0.012, cz - 0.065, 0.17, 0.12, 0.13, col], [cx - 0.065, y + 0.012, cz - 0.085, 0.13, 0.12, 0.17, col],
  [cx - 0.085, y + 0.06, cz + 0.065, 0.17, 0.014, 0.004, icing], [cx - 0.08, y + 0.132, cz - 0.06, 0.16, 0.025, 0.12, icing], [cx - 0.06, y + 0.132, cz - 0.08, 0.12, 0.025, 0.16, icing],
  ...(berry ? [[cx - 0.02, y + 0.157, cz - 0.02, 0.04, 0.035, 0.04, berry], [cx - 0.008, y + 0.19, cz - 0.008, 0.016, 0.012, 0.016, LEAF]] : []),
] });
const cheese = { u: 0.2, h: 0.1, make: (cx, cz, y) => [
  [cx - 0.09, y, cz - 0.06, 0.18, 0.09, 0.12, '#f2c94c'], [cx - 0.06, y, cz - 0.09, 0.12, 0.09, 0.18, '#f2c94c'],
  [cx - 0.09, y + 0.09, cz - 0.06, 0.18, 0.006, 0.12, '#e8b73a'], [cx + 0.02, y, cz + 0.02, 0.07, 0.096, 0.07, '#ffe58a'],
  [cx - 0.05, y + 0.04, cz + 0.088, 0.02, 0.02, 0.004, '#d9a630'], [cx - 0.01, y + 0.06, cz + 0.088, 0.015, 0.015, 0.004, '#d9a630'],
] };
const pot = (col, rim, soup) => ({ u: 0.17, h: 0.13, make: (cx, cz, y) => [
  [cx - 0.07, y, cz - 0.07, 0.14, 0.1, 0.14, col], [cx - 0.075, y + 0.1, cz - 0.075, 0.15, 0.02, 0.15, rim],
  [cx - 0.06, y + 0.104, cz - 0.06, 0.12, 0.012, 0.12, soup], [cx - 0.09, y + 0.07, cz - 0.015, 0.02, 0.02, 0.03, rim], [cx + 0.07, y + 0.07, cz - 0.015, 0.02, 0.02, 0.03, rim],
] });
const box = (col, band, h = 0.12, s = 0.15) => ({ u: s + 0.02, h, make: (cx, cz, y) => [
  [cx - s / 2, y, cz - s / 2, s, h, s, col], [cx - s / 2, y + h * 0.4, cz + s / 2, s, h * 0.2, 0.004, band], [cx - s / 2 - 0.002, y + h - 0.01, cz - s / 2 - 0.002, s + 0.004, 0.012, s + 0.004, band],
] });
const egg = { u: 0.075, h: 0.08, pile: true, make: (cx, cz, y, k) => [
  [cx - 0.03, y, cz - 0.025, 0.06, 0.06, 0.05, k % 3 ? '#f4ecd8' : '#e8c9a0'], [cx - 0.022, y + 0.06, cz - 0.02, 0.044, 0.02, 0.04, k % 3 ? '#f4ecd8' : '#e8c9a0'],
] };
const sack = (col, tie, spill) => ({ u: 0.18, h: 0.2, make: (cx, cz, y) => [
  [cx - 0.08, y, cz - 0.07, 0.16, 0.14, 0.14, col], [cx - 0.065, y + 0.14, cz - 0.055, 0.13, 0.03, 0.11, col], [cx - 0.03, y + 0.17, cz - 0.03, 0.06, 0.03, 0.06, tie],
  [cx - 0.045, y + 0.05, cz + 0.07, 0.09, 0.05, 0.004, spill],
] });
const bundle = (col, tie) => ({ u: 0.16, h: 0.22, make: (cx, cz, y, k) => [
  ...[-0.04, 0, 0.04].flatMap((dx, i) => [[cx + dx - 0.015, y, cz - 0.02 + (i % 2) * 0.02, 0.03, 0.2 + (i % 2) * 0.02, 0.03, col]]),
  [cx - 0.06, y + 0.17, cz - 0.03, 0.12, 0.06, 0.06, '#e9c46a'], [cx - 0.065, y + 0.06, cz - 0.035, 0.13, 0.03, 0.07, tie],
] });
const flowers = { u: 0.17, h: 0.26, make: (cx, cz, y, k) => {
  const C = ['#e9668a', '#f5c542', '#ffffff', '#b07ad8', '#ff8a5c'];
  const out = [[cx - 0.025, y, cz - 0.025, 0.05, 0.14, 0.05, LEAF_D], [cx - 0.05, y + 0.1, cz - 0.04, 0.1, 0.03, 0.08, '#f4ecd8']];
  [[-0.04, -0.02], [0.03, -0.03], [0, 0.03], [-0.03, 0.04], [0.04, 0.02]].forEach(([dx, dz], i) => out.push([cx + dx - 0.025, y + 0.15 + (i % 2) * 0.03, cz + dz - 0.025, 0.05, 0.05, 0.05, C[(i + k) % C.length]]));
  return out;
} };
const book = { u: 0.12, h: 0.22, make: (cx, cz, y, k) => {
  const C = ['#d9534f', '#4a90d9', '#5cb85c', '#9b59b6'];
  return [[cx - 0.035, y, cz - 0.07, 0.07, 0.2, 0.14, C[k % 4]], [cx - 0.03, y + 0.005, cz - 0.068, 0.062, 0.19, 0.136, '#f4ecd8'], [cx - 0.036, y + 0.06, cz + 0.071, 0.072, 0.03, 0.003, '#f5c542']];
} };
const skein = (col, hi) => ({ u: 0.13, h: 0.11, pile: true, make: (cx, cz, y) => [
  [cx - 0.055, y, cz - 0.045, 0.11, 0.09, 0.09, col], [cx - 0.045, y + 0.02, cz - 0.055, 0.09, 0.07, 0.11, col], [cx - 0.04, y + 0.09, cz - 0.035, 0.08, 0.02, 0.07, col],
  [cx - 0.055, y + 0.04, cz + 0.046, 0.11, 0.012, 0.004, hi], [cx - 0.02, y, cz + 0.046, 0.012, 0.09, 0.004, hi],
] });
const bolt = (col, hi) => ({ u: 0.24, h: 0.08, make: (cx, cz, y) => [
  [cx - 0.11, y, cz - 0.07, 0.22, 0.07, 0.14, col], [cx - 0.11, y + 0.035, cz + 0.07, 0.22, 0.012, 0.004, hi], [cx - 0.11, y + 0.07, cz - 0.07, 0.22, 0.006, 0.14, hi],
] });
const log = { u: 0.12, len: 0.32, h: 0.1, pile: true, make: (cx, cz, y) => [
  [cx - 0.16, y, cz - 0.05, 0.32, 0.1, 0.1, '#8a5a32'], [cx + 0.16, y + 0.01, cz - 0.04, 0.004, 0.08, 0.08, '#d9b27a'], [cx - 0.164, y + 0.01, cz - 0.04, 0.004, 0.08, 0.08, '#d9b27a'],
  [cx - 0.1, y + 0.1, cz - 0.02, 0.14, 0.006, 0.04, '#6b4424'],
] };
const rock = { u: 0.14, h: 0.1, pile: true, make: (cx, cz, y, k) => [
  [cx - 0.06, y, cz - 0.05, 0.12, 0.08, 0.1, k % 2 ? '#9a9384' : '#8a8478'], [cx - 0.04, y + 0.08, cz - 0.035, 0.08, 0.02, 0.07, '#b6af9f'],
] };
const tool = (head, handle) => ({ u: 0.12, len: 0.4, h: 0.06, make: (cx, cz, y) => [
  [cx - 0.18, y, cz - 0.015, 0.3, 0.03, 0.03, handle], [cx + 0.1, y, cz - 0.05, 0.08, 0.04, 0.1, head], [cx + 0.1, y + 0.04, cz - 0.04, 0.06, 0.01, 0.08, '#c9d2d8'],
] });
const hay = { u: 0.22, h: 0.14, make: (cx, cz, y) => [
  [cx - 0.1, y, cz - 0.07, 0.2, 0.13, 0.14, '#d9c069'], [cx - 0.1, y + 0.13, cz - 0.06, 0.2, 0.012, 0.12, '#e8d488'],
  [cx - 0.05, y, cz + 0.071, 0.012, 0.13, 0.004, '#8a6a32'], [cx + 0.04, y, cz + 0.071, 0.012, 0.13, 0.004, '#8a6a32'],
] };
const tin = (col, band) => ({ u: 0.12, h: 0.12, make: (cx, cz, y) => [
  [cx - 0.045, y, cz - 0.045, 0.09, 0.11, 0.09, col], [cx - 0.05, y + 0.1, cz - 0.05, 0.1, 0.02, 0.1, band], [cx - 0.045, y + 0.035, cz + 0.045, 0.09, 0.04, 0.004, band],
] });

export const LOOK = {
  turnip: round(0.13, 0.11, '#efe4f0', '#ffffff', leaves(0.13), (cx, cz, y) => [[cx - 0.05, y + 0.06, cz - 0.05, 0.1, 0.04, 0.1, '#a855a8']]),
  carrot: long(0.26, 0.06, '#e8781e', '#d9661a', (x, cz, y, t) => [[x - 0.05, y + 0.01, cz - 0.02, 0.05, 0.04, 0.04, LEAF], [x - 0.08, y + 0.02, cz - 0.03, 0.04, 0.02, 0.06, LEAF_L]]),
  berry: round(0.06, 0.06, '#d93a3a', '#ff8a8a', (cx, cz, y) => [[cx - 0.02, y, cz - 0.02, 0.04, 0.012, 0.04, LEAF]]),
  apple: round(0.1, 0.1, '#c8302a', '#ff8a7a', stalk(STEM)),
  pumpkin: round(0.26, 0.18, '#e8781e', '#ffa64a', (cx, cz, y) => [[cx - 0.02, y, cz - 0.02, 0.04, 0.05, 0.04, STEM]], (cx, cz, y) => [[cx - 0.004, y + 0.01, cz + 0.11, 0.008, 0.13, 0.03, '#c95f14'], [cx - 0.08, y + 0.01, cz + 0.08, 0.008, 0.12, 0.02, '#c95f14']]),
  melon: round(0.22, 0.16, '#6faa3a', '#a8d86a', stalk(STEM), (cx, cz, y) => [[cx - 0.06, y + 0.01, cz + 0.096, 0.02, 0.12, 0.004, '#3f7a24'], [cx + 0.03, y + 0.01, cz + 0.096, 0.02, 0.12, 0.004, '#3f7a24']]),
  corn: long(0.28, 0.07, '#f5c542', '#e0ad2a', (x, cz, y, t) => [[x, y, cz - t / 2 - 0.006, 0.12, t * 0.9, t + 0.012, '#79a83a'], [x - 0.04, y + 0.01, cz - 0.02, 0.05, 0.04, 0.04, LEAF_L]]),
  kale: { ...round(0.15, 0.12, '#3f7a2c', '#5aa842', leaves(0.16)), pile: true },
  wheat: bundle('#d9b85c', '#a8703f'),
  egg, milk: bottle('#f4f6f7', '#3a86c8', '#cfe8f2'), juice: carton('#f39a1e', '#f4f6f7', '#3f8a35'),
  tea: tin('#3f8a35', '#c9a24c'), jam: jar('#b51f3c', '#e2574c', '#f4ecd8'),
  bread: loaf, pie, cake: cake('#f4ecd8', '#f7c6d4', '#d93a3a'), honeycake: cake('#e0a526', '#fff3c4', null),
  cheese, soup: pot('#c8463a', '#de6a58', '#e8a23a'), fishstew: pot('#3a6ea8', '#5a8ec8', '#d9b07a'),
  flour: sack('#efe6d6', '#a8703f', '#ffffff'), bouquet: flowers, bookgift: book,
  wool: skein('#f4f1ea', '#d9d2c4'), cloth: bolt('#b07ad8', '#d6b3f0'), hay,
  smokedfish: fish('#8a5a32', '#b8834a', '#6b4424'), sunfish: fish('#f0b03a', '#ffe08a', '#e07a2a'), carp: fish('#a89a5a', '#d8cc8a', '#7f7240'),
  bass: fish('#5a7a3a', '#c8d8a0', '#3f5a28'), trout: fish('#8aa0b0', '#f0b8b8', '#5f7480'), catfish: fish('#6a6458', '#a8a294', '#4a463e'),
  pike: fish('#6f8a4a', '#d8e0b0', '#4a6030'), koi: fish('#f4f1ea', '#ff8a4a', '#e8501e'), whiskers: fish('#4a5058', '#8a929a', '#2f3542'),
  wood: log, stone: rock, axe: tool('#8a929a', '#a8703f'), pickaxe: tool('#6f7780', '#8a5a32'), scythe: tool('#c9d2d8', '#6b4424'),
  rod: tool('#c9a24c', '#a8703f'), wateringcan: tin('#3fa86f', '#2f7a50'), bigcan: tin('#3a86c8', '#2f68a8'),
};
const fallback = box('#c99363', '#6b4424');

// The goods on display t holding `stock` ([{ item, n }]), as boxes in the display's
// unrotated footprint. More stock, fuller shelves: a slot shows about one good per unit
// up to what fits, and heaps of produce get a second layer when there's plenty.
export function goodsBoxes(t, stock) {
  const slots = slotsOf(t);
  if (!slots || !stock?.length) return [];
  const out = [];
  stock.forEach((sl, si) => {
    const rect = slots[si];
    if (!rect || !(sl.n > 0)) return;
    const [x, y, z, w, d] = rect;
    const g = LOOK[sl.item] || fallback;
    // Long goods lie across the slot's long side.
    const along = g.len ? Math.max(1, Math.floor(w / (g.len + 0.02))) : Math.max(1, Math.floor(w / g.u));
    const step = g.len ? w / along : w / along;
    const rows = Math.max(1, Math.floor(d / g.u));
    const cells = [];
    for (let row = rows - 1; row >= 0; row--) for (let c = 0; c < along; c++) cells.push([c, row, 0]);
    if (g.pile && sl.n > cells.length) for (let row = rows - 2; row >= 0; row--) for (let c = 0; c < along - (g.len ? 0 : 1); c++) cells.push([c + (g.len ? 0 : 0.5), row + 0.5, 1]);
    // Front row first, so a half-sold display still looks stocked from the aisle.
    const show = Math.min(cells.length, Math.max(1, Math.ceil(sl.n * (cells.length / 9) * 1.3)));
    for (let i = 0; i < show; i++) {
      const [c, row, layer] = cells[i];
      const j = g.pile ? (hash(si * 31 + i, c * 7 + row) - 0.5) * 0.3 : 0;
      const cx = x + (c + 0.5) * step + j * step * 0.4;
      const cz = z + (row + 0.5) * (d / rows) + (g.pile ? (hash(i, si) - 0.5) * 0.25 * (d / rows) : 0);
      const cy = y + layer * g.h * 0.7;
      out.push(...g.make(cx, cz, cy, i + si));
    }
  });
  return out;
}

// Where a slot's price tag goes: the front edge of each slot (footprint tiles).
export const slotFronts = (t) => (slotsOf(t) || []).map(([x, y, z, w, d]) => [x + w / 2, y, z + d]);

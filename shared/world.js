// World layout, tile types and clock. Shared by server and client so both sides
// agree on the map without sending it over the wire.
//
// The map has four rows of residential land ("zones") along the roads, with the town
// square in the middle row. Plots are rectangles of that land, owned and reshaped by
// players at runtime (see shared/plot.js); they are not baked into the map.

export const WORLD_VERSION = 3;
export const TILE = 16;
export const MAP_W = 120;
export const MAP_H = 88;
export const PLOT_W = 24; // default plot size
export const PLOT_H = 18;
export const PLAYER_SPEED = 76; // world px per second

export const T = {
  GRASS: 0, PATH: 1, WATER: 2, TREE: 3, LAWN: 4, FENCE: 5, GATE: 6,
  FLOWERS: 7, SAND: 8, PLAZA: 9, FOUNTAIN: 10, ROCK: 11, TALLGRASS: 12, SHOP: 13,
};
export const SOLID_TILES = new Set([T.WATER, T.TREE, T.FENCE, T.FOUNTAIN, T.ROCK, T.SHOP]);

// Residential land. Every zone's south edge runs along a road, where plot gates go.
export const ZONES = [
  { x: 5, y: 4, w: 53, h: 18 }, { x: 62, y: 4, w: 53, h: 18 },
  { x: 5, y: 24, w: 53, h: 18 }, { x: 62, y: 24, w: 53, h: 18 },
  { x: 5, y: 44, w: 37, h: 18 }, { x: 78, y: 44, w: 37, h: 18 },
  { x: 5, y: 64, w: 53, h: 18 }, { x: 62, y: 64, w: 53, h: 18 },
];
// Plots that exist when a world is first created (the rest of each zone is open land).
export const STARTER_PLOTS = [
  [5, 4], [34, 4], [62, 4], [91, 4],
  [5, 24], [34, 24], [62, 24], [91, 24],
  [5, 44], [91, 44],
  [5, 64], [34, 64], [62, 64], [91, 64],
].map(([x, y]) => ({ x, y, w: PLOT_W, h: PLOT_H }));

export const SQUARE = { x: 44, y: 44, w: 32, h: 18 };
export const FOUNTAIN = { x: 58, y: 51, cx: 60, cz: 53 }; // 4x4 tiles
export const PLAZA_LAMPS = [[57.5, 50.5], [62.5, 50.5], [57.5, 55.5], [62.5, 55.5]];

// Shop buildings on the north side of the plaza. The keeper stands at the door.
export const SHOPS = [
  { id: 'rosa', name: "Rosa's Market", x: 53, y: 44, w: 5, h: 3, roof: '#c0392b', awning: ['#e74c3c', '#fdf2e0'] },
  { id: 'otto', name: "Otto's Furniture", x: 63, y: 44, w: 5, h: 3, roof: '#2c5d8a', awning: ['#3d7cb8', '#fdf2e0'] },
];

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function tileHash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export const zoneAt = (tx, ty) => ZONES.find((z) => tx >= z.x && ty >= z.y && tx < z.x + z.w && ty < z.y + z.h) || null;

export function generateWorld(seed = 20261012) {
  const rand = mulberry32(seed);
  const tiles = new Uint8Array(MAP_W * MAP_H);
  const inb = (x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;
  const set = (x, y, t) => { if (inb(x, y)) tiles[y * MAP_W + x] = t; };
  const get = (x, y) => (inb(x, y) ? tiles[y * MAP_W + x] : T.TREE);
  const fill = (x0, y0, w, h, t) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, t); };

  // Forest border.
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    if (x < 3 || y < 3 || x >= MAP_W - 3 || y >= MAP_H - 3) set(x, y, T.TREE);
  }

  // Roads: one under each row of land, a ring road, and a north-south avenue.
  for (const ry of [22, 42, 62, 82]) fill(3, ry, MAP_W - 6, 2, T.PATH);
  fill(3, 22, 2, 62, T.PATH);
  fill(MAP_W - 5, 22, 2, 62, T.PATH);
  fill(59, 22, 2, 22, T.PATH);
  fill(59, 62, 2, 22, T.PATH);

  // Town square: pond on the left, fountain plaza in the middle, garden on the right.
  const S = SQUARE;
  fill(S.x, S.y, S.w, S.h, T.PLAZA);
  const pond = { cx: 48.5, cy: 54, rx: 4.4, ry: 5.6 };
  for (let y = S.y; y < S.y + S.h; y++) for (let x = S.x; x < S.x + 10; x++) {
    const d = ((x + 0.5 - pond.cx) / pond.rx) ** 2 + ((y + 0.5 - pond.cy) / pond.ry) ** 2;
    if (d < 0.75) set(x, y, T.WATER);
    else if (d < 1.25) set(x, y, T.SAND);
    else set(x, y, T.GRASS);
  }
  fill(FOUNTAIN.x, FOUNTAIN.y, 4, 4, T.FOUNTAIN);
  for (let y = S.y; y < S.y + S.h; y++) for (let x = 69; x < S.x + S.w; x++) set(x, y, (x + y) % 3 === 0 ? T.FLOWERS : T.GRASS);
  for (const [x, y] of [[70, 45], [74, 45], [70, 60], [74, 60], [72, 52]]) set(x, y, T.TREE);
  for (const sh of SHOPS) fill(sh.x, sh.y, sh.w, sh.h, T.SHOP);

  // Scatter decoration on open grass (no rocks on buildable land).
  for (let y = 3; y < MAP_H - 3; y++) for (let x = 3; x < MAP_W - 3; x++) {
    if (get(x, y) !== T.GRASS) continue;
    let nearPath = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (get(x + dx, y + dy) === T.PATH) nearPath = true;
    const r = rand();
    if (r < 0.04) set(x, y, T.FLOWERS);
    else if (r < 0.1) set(x, y, T.TALLGRASS);
    else if (r < 0.112 && !nearPath && !zoneAt(x, y)) set(x, y, T.ROCK);
  }

  const spawn = { x: 60 * TILE, y: 59.5 * TILE };
  // plotAt is filled at runtime from the live plots (see indexPlots in plot.js).
  return { tiles, plotAt: new Int32Array(MAP_W * MAP_H).fill(-1), shops: SHOPS, zones: ZONES, spawn, w: MAP_W, h: MAP_H };
}

export function plotIdAtPixel(world, x, y) {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return -1;
  return world.plotAt[ty * MAP_W + tx];
}

// One in-game day lasts 24 real minutes (1 game hour per real minute).
export const DAY_MS = 24 * 60 * 1000;
// epoch = when the world was founded; day 1 starts at 6:00 AM.
export function worldClock(ms, epoch = 0) {
  const d = (ms - epoch + DAY_MS / 4) / DAY_MS;
  const day = Math.floor(d) + 1;
  const hours = (d - Math.floor(d)) * 24;
  return { day, hours };
}

// 0 = full daylight, ~0.65 = darkest night.
export function darkness(hours) {
  if (hours >= 7 && hours < 18) return 0;
  if (hours >= 18 && hours < 21) return ((hours - 18) / 3) * 0.62;
  if (hours >= 5 && hours < 7) return (1 - (hours - 5) / 2) * 0.62;
  return 0.62;
}

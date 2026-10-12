// World layout, tile types, collision and clock. Shared by server and client so
// both sides agree on the map without sending it over the wire.
import { ITEMS } from './catalog.js';

export const WORLD_VERSION = 1;
export const TILE = 16;
export const MAP_W = 84;
export const MAP_H = 70;
export const PLOT_W = 16;
export const PLOT_H = 12;
export const PLAYER_SPEED = 76; // world px per second

export const T = {
  GRASS: 0, PATH: 1, WATER: 2, TREE: 3, LAWN: 4, FENCE: 5, GATE: 6,
  FLOWERS: 7, SAND: 8, PLAZA: 9, FOUNTAIN: 10, ROCK: 11, TALLGRASS: 12,
};
const SOLID_TILES = new Set([T.WATER, T.TREE, T.FENCE, T.FOUNTAIN, T.ROCK]);

const COL_X = [4, 24, 44, 64];
const ROW_Y = [4, 20, 36, 52];
// Middle row, middle two columns is the town square instead of plots.
const SQUARE = { x: 24, y: 20, w: 36, h: 12 };

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

export function generateWorld(seed = 20261012) {
  const rand = mulberry32(seed);
  const tiles = new Uint8Array(MAP_W * MAP_H);
  const plotAt = new Int16Array(MAP_W * MAP_H).fill(-1);
  const inb = (x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;
  const set = (x, y, t) => { if (inb(x, y)) tiles[y * MAP_W + x] = t; };
  const get = (x, y) => (inb(x, y) ? tiles[y * MAP_W + x] : T.TREE);
  const fill = (x0, y0, w, h, t) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, t);
  };

  // Forest border.
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    if (x < 2 || y < 2 || x >= MAP_W - 2 || y >= MAP_H - 2) set(x, y, T.TREE);
  }

  // Paths: a horizontal road under each plot row, vertical roads between columns.
  for (const ry of ROW_Y) fill(2, ry + PLOT_H + 1, MAP_W - 4, 2, T.PATH);
  for (let c = 0; c < COL_X.length - 1; c++) fill(COL_X[c] + PLOT_W + 1, ROW_Y[0] + PLOT_H + 1, 2, MAP_H - 4 - (ROW_Y[0] + PLOT_H + 1), T.PATH);
  fill(2, ROW_Y[0] + PLOT_H + 1, 2, MAP_H - 4 - (ROW_Y[0] + PLOT_H + 1), T.PATH);
  fill(MAP_W - 4, ROW_Y[0] + PLOT_H + 1, 2, MAP_H - 4 - (ROW_Y[0] + PLOT_H + 1), T.PATH);

  // Town square: pond on the left, fountain plaza in the middle, garden on the right.
  fill(SQUARE.x, SQUARE.y, SQUARE.w, SQUARE.h, T.PLAZA);
  const pond = { cx: 28.5, cy: 25.5, rx: 4.6, ry: 5.2 };
  for (let y = SQUARE.y; y < SQUARE.y + SQUARE.h; y++) for (let x = SQUARE.x; x < SQUARE.x + 9; x++) {
    const d = ((x + 0.5 - pond.cx) / pond.rx) ** 2 + ((y + 0.5 - pond.cy) / pond.ry) ** 2;
    if (d < 0.75) set(x, y, T.WATER);
    else if (d < 1.25) set(x, y, T.SAND);
    else set(x, y, T.GRASS);
  }
  fill(40, 24, 4, 4, T.FOUNTAIN);
  for (let y = SQUARE.y; y < SQUARE.y + SQUARE.h; y++) for (let x = 52; x < SQUARE.x + SQUARE.w; x++) {
    set(x, y, (x + y) % 3 === 0 ? T.FLOWERS : T.GRASS);
  }
  for (const [x, y] of [[53, 21], [58, 21], [53, 30], [58, 30], [55, 25]]) set(x, y, T.TREE);

  // Plots.
  const plots = [];
  for (let r = 0; r < ROW_Y.length; r++) for (let c = 0; c < COL_X.length; c++) {
    if (r === 1 && (c === 1 || c === 2)) continue;
    const x = COL_X[c], y = ROW_Y[r];
    const id = plots.length;
    const gate = [x + 7, x + 8];
    plots.push({ id, x, y, w: PLOT_W, h: PLOT_H, gateY: y + PLOT_H - 1, gate });
    for (let ty = y; ty < y + PLOT_H; ty++) for (let tx = x; tx < x + PLOT_W; tx++) {
      const border = tx === x || ty === y || tx === x + PLOT_W - 1 || ty === y + PLOT_H - 1;
      set(tx, ty, border ? T.FENCE : T.LAWN);
      plotAt[ty * MAP_W + tx] = id;
    }
    for (const gx of gate) set(gx, y + PLOT_H - 1, T.GATE);
    // Little path from the gate to the road.
    for (let ty = y + PLOT_H; ty < y + PLOT_H + 1; ty++) for (const gx of gate) set(gx, ty, T.PATH);
  }

  // Scatter decoration on open grass.
  for (let y = 2; y < MAP_H - 2; y++) for (let x = 2; x < MAP_W - 2; x++) {
    if (get(x, y) !== T.GRASS) continue;
    let nearPath = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const n = get(x + dx, y + dy);
      if (n === T.PATH || n === T.GATE || n === T.FENCE) nearPath = true;
    }
    const r = rand();
    if (r < 0.05) set(x, y, T.FLOWERS);
    else if (r < 0.12) set(x, y, T.TALLGRASS);
    else if (r < 0.13 && !nearPath) set(x, y, T.ROCK);
  }

  const spawn = { x: 41.5 * TILE, y: 30 * TILE };
  return { tiles, plotAt, plots, spawn, w: MAP_W, h: MAP_H };
}

export const key = (lx, ly) => `${lx},${ly}`;

// Interior (buildable) local coordinates exclude the fence ring.
export const inInterior = (lx, ly) => lx >= 1 && ly >= 1 && lx <= PLOT_W - 2 && ly <= PLOT_H - 2;

// plotStates: array indexed by plot id of { obj: { "x,y": {t} } }.
export function tileSolid(world, plotStates, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return true;
  const i = ty * MAP_W + tx;
  if (SOLID_TILES.has(world.tiles[i])) return true;
  const pi = world.plotAt[i];
  if (pi >= 0) {
    const ps = plotStates[pi];
    const p = world.plots[pi];
    const o = ps && ps.obj[key(tx - p.x, ty - p.y)];
    if (o && ITEMS[o.t] && ITEMS[o.t].solid) return true;
  }
  return false;
}

// (x, y) is the centre of the player's feet in world pixels.
export function canStand(world, plotStates, x, y) {
  const pts = [[x - 5, y - 5], [x + 5, y - 5], [x - 5, y - 0.5], [x + 5, y - 0.5]];
  for (const [px, py] of pts) {
    if (tileSolid(world, plotStates, Math.floor(px / TILE), Math.floor(py / TILE))) return false;
  }
  return true;
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

// Plot rules shared by server and client: footprints, rotation, placement and collision.
// A plot stores each object once, at its anchor (top-left) tile: obj["x,y"] = { t, r }.
import { ITEMS } from './catalog.js';
import { TILE, MAP_W, MAP_H, PLOT_W, PLOT_H, SOLID_TILES } from './world.js';

export const key = (lx, ly) => `${lx},${ly}`;

// Interior (buildable) local coordinates exclude the fence ring.
export const inInterior = (lx, ly) => lx >= 1 && ly >= 1 && lx <= PLOT_W - 2 && ly <= PLOT_H - 2;

// Rotation r: 0 faces down, 1 faces left, 2 faces up, 3 faces right.
export function footprint(itemId, r = 0) {
  const [w, h] = ITEMS[itemId]?.size || [1, 1];
  return r % 2 ? [h, w] : [w, h];
}

export function tilesOf(itemId, r, lx, ly) {
  const [w, h] = footprint(itemId, r);
  const out = [];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out.push([lx + i, ly + j]);
  return out;
}

export const canRotate = (itemId) => !!ITEMS[itemId]?.rot && ITEMS[itemId].rot !== 'none';

// Tile -> anchor key, cached per plot object. Call occChanged() after mutating plot.obj.
const occCache = new WeakMap();
export function occupancy(plot) {
  let m = occCache.get(plot);
  if (!m) {
    m = new Map();
    for (const [k, o] of Object.entries(plot.obj)) {
      const [x, y] = k.split(',').map(Number);
      for (const [tx, ty] of tilesOf(o.t, o.r || 0, x, y)) m.set(key(tx, ty), k);
    }
    occCache.set(plot, m);
  }
  return m;
}
export const occChanged = (plot) => occCache.delete(plot);

export function objAt(plot, lx, ly) {
  const k = occupancy(plot).get(key(lx, ly));
  return k ? { key: k, obj: plot.obj[k] } : null;
}

// Returns null when OK, or a short reason string.
export function placementError(plot, lx, ly, itemId, r = 0) {
  const item = ITEMS[itemId];
  if (!item) return 'Unknown item';
  if (item.layer === 'floor') {
    if (!inInterior(lx, ly)) return 'Outside your plot';
    const k = key(lx, ly);
    if (plot.floor[k] === itemId) return 'Already there';
    const here = objAt(plot, lx, ly);
    if (here && ITEMS[here.obj.t]?.crop) return 'Harvest the crop first';
    if (plot.floor[k] === 'soil' && here) return 'Clear it first';
    return null;
  }
  if (!canRotate(itemId) && r) return 'That item can’t be rotated';
  for (const [tx, ty] of tilesOf(itemId, r, lx, ly)) {
    if (!inInterior(tx, ty)) return 'Doesn’t fit there';
    if (objAt(plot, tx, ty)) return 'Tile is occupied';
  }
  if (item.crop && plot.floor[key(lx, ly)] !== 'soil') return 'Seeds need tilled soil';
  return null;
}

// plotStates: array indexed by plot id.
export function tileSolid(world, plotStates, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return true;
  const i = ty * MAP_W + tx;
  if (SOLID_TILES.has(world.tiles[i])) return true;
  const pi = world.plotAt[i];
  if (pi >= 0) {
    const ps = plotStates[pi];
    const p = world.plots[pi];
    const hit = ps && objAt(ps, tx - p.x, ty - p.y);
    if (hit && ITEMS[hit.obj.t]?.solid) return true;
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

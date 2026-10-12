// Plot rules shared by server and client: footprints, rotation, walls, levels,
// placement and collision.
//
// A plot is built Sims-style:
//   floor / obj     level 0 (ground) floor tiles and objects, keyed "x,y"
//   l1.floor/l1.obj level 1 (upstairs)
//   walls           wall segments on tile *edges*, keyed "level:d:x:y" -> { m, f }
//                   d = 'h' is the top edge of tile (x, y), 'v' its left edge.
//                   m = wall material item, f = door/window feature item (optional)
//   roofs           [{ x, y, w, h, l, m }] gable roofs over a rectangle at level l
// Objects are stored once at their anchor (top-left) tile: obj["x,y"] = { t, r }.
import { ITEMS } from './catalog.js';
import { TILE, MAP_W, MAP_H, PLOT_W, PLOT_H, SOLID_TILES } from './world.js';

export const LEVELS = 2;
export const key = (lx, ly) => `${lx},${ly}`;

// Interior (buildable) tile coordinates exclude the fence ring.
export const IN_MIN = 1, IN_MAX_X = PLOT_W - 2, IN_MAX_Y = PLOT_H - 2;
export const inInterior = (lx, ly) => lx >= IN_MIN && ly >= IN_MIN && lx <= IN_MAX_X && ly <= IN_MAX_Y;

// ---------- levels ----------
export function levelView(plot, level) {
  if (!level) return plot;
  plot.l1 ||= { floor: {}, obj: {} };
  return plot.l1;
}

// ---------- footprints ----------
// Rotation r: 0 faces down (south), 1 faces left, 2 faces up, 3 faces right.
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

// Tile -> anchor key, cached per level view. Call occChanged() after mutating obj.
const occCache = new WeakMap();
export function occupancy(view) {
  let m = occCache.get(view);
  if (!m) {
    m = new Map();
    for (const [k, o] of Object.entries(view.obj)) {
      const [x, y] = k.split(',').map(Number);
      for (const [tx, ty] of tilesOf(o.t, o.r || 0, x, y)) m.set(key(tx, ty), k);
    }
    occCache.set(view, m);
  }
  return m;
}
export const occChanged = (plot) => { occCache.delete(plot); if (plot.l1) occCache.delete(plot.l1); };

export function objAt(view, lx, ly) {
  const k = occupancy(view).get(key(lx, ly));
  return k ? { key: k, obj: view.obj[k] } : null;
}

// ---------- walls ----------
export const edgeKey = (level, d, x, y) => `${level}:${d}:${x}:${y}`;
export function parseEdge(k) {
  const [l, d, x, y] = k.split(':');
  return { l: +l, d, x: +x, y: +y };
}

// Edges that lie inside or on the border of the buildable interior.
export function edgeValid(d, x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
  if (d === 'h') return x >= IN_MIN && x <= IN_MAX_X && y >= IN_MIN && y <= IN_MAX_Y + 1;
  if (d === 'v') return x >= IN_MIN && x <= IN_MAX_X + 1 && y >= IN_MIN && y <= IN_MAX_Y;
  return false;
}

export const wallAt = (plot, level, d, x, y) => plot.walls?.[edgeKey(level, d, x, y)] || null;

// The edge between two orthogonally adjacent tiles.
export function edgeBetween(ax, ay, bx, by) {
  if (bx === ax + 1 && by === ay) return ['v', bx, ay];
  if (bx === ax - 1 && by === ay) return ['v', ax, ay];
  if (by === ay + 1 && bx === ax) return ['h', ax, by];
  if (by === ay - 1 && bx === ax) return ['h', ax, ay];
  return null;
}

// Edges of a straight wall run between two corner points (snapped to one axis).
export function lineEdges(x0, y0, x1, y1) {
  const out = [];
  if (Math.abs(x1 - x0) >= Math.abs(y1 - y0)) {
    for (let x = Math.min(x0, x1); x < Math.max(x0, x1); x++) out.push(['h', x, y0]);
  } else {
    for (let y = Math.min(y0, y1); y < Math.max(y0, y1); y++) out.push(['v', x0, y]);
  }
  return out;
}

// Perimeter edges of a w x h room whose top-left tile is (x, y).
export function rectEdges(x, y, w, h) {
  const out = [];
  for (let i = 0; i < w; i++) { out.push(['h', x + i, y]); out.push(['h', x + i, y + h]); }
  for (let j = 0; j < h; j++) { out.push(['v', x, y + j]); out.push(['v', x + w, y + j]); }
  return out;
}

const passable = (w) => !!(w && w.f && ITEMS[w.f]?.passable);

// ---------- placement ----------
// Returns null when OK, or a short reason string.
export function placementError(plot, lx, ly, itemId, r = 0, level = 0) {
  const item = ITEMS[itemId];
  if (!item) return 'Unknown item';
  const view = levelView(plot, level);
  if (item.layer === 'floor') {
    if (!inInterior(lx, ly)) return 'Outside your plot';
    if (level && itemId === 'soil') return 'Soil only works outdoors';
    const k = key(lx, ly);
    if (view.floor[k] === itemId) return 'Already there';
    const here = objAt(view, lx, ly);
    if (here && ITEMS[here.obj.t]?.crop) return 'Harvest the crop first';
    if (view.floor[k] === 'soil' && here) return 'Clear it first';
    return null;
  }
  if (item.layer !== 'obj') return 'Use the wall tools for that';
  if (!canRotate(itemId) && r) return 'That item can’t be rotated';
  const tiles = tilesOf(itemId, r, lx, ly);
  for (const [tx, ty] of tiles) {
    if (!inInterior(tx, ty)) return 'Doesn’t fit there';
    if (objAt(view, tx, ty)) return 'Tile is occupied';
    if (level && !view.floor[key(tx, ty)]) return 'Needs a floor underneath';
  }
  // A big item can't straddle a wall.
  for (const [ax, ay] of tiles) for (const [bx, by] of tiles) {
    const e = edgeBetween(ax, ay, bx, by);
    if (e && wallAt(plot, level, ...e)) return 'A wall is in the way';
  }
  if (item.crop && (level || view.floor[key(lx, ly)] !== 'soil')) return 'Seeds need tilled soil';
  return null;
}

// Can a wall go on this edge? (Ignores cost.)
export function wallError(plot, level, d, x, y) {
  if (!edgeValid(d, x, y)) return 'Walls must stay inside your fence';
  if (level < 0 || level >= LEVELS) return 'Unknown level';
  // Don't cut through the middle of a multi-tile object.
  const view = levelView(plot, level);
  const [ax, ay, bx, by] = d === 'h' ? [x, y - 1, x, y] : [x - 1, y, x, y];
  const a = objAt(view, ax, ay), b = objAt(view, bx, by);
  if (a && b && a.key === b.key) return 'Something is in the way';
  return null;
}

export function roofError(plot, x, y, w, h, level) {
  if (![x, y, w, h].every(Number.isInteger) || w < 1 || h < 1) return 'Bad roof size';
  if (!inInterior(x, y) || !inInterior(x + w - 1, y + h - 1)) return 'Roofs must stay inside your fence';
  if (level < 0 || level >= LEVELS) return 'Unknown level';
  for (const rf of plot.roofs || []) {
    if (rf.l === level && x < rf.x + rf.w && rf.x < x + w && y < rf.y + rf.h && rf.y < y + h) return 'Overlaps another roof';
  }
  return null;
}

export function roofAt(plot, lx, ly, level) {
  return (plot.roofs || []).findIndex((rf) => (level == null || rf.l === level) && lx >= rf.x && lx < rf.x + rf.w && ly >= rf.y && ly < rf.y + rf.h);
}

// ---------- collision (ground level) ----------
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

const WALL_HALF = 1.5; // wall thickness / 2 in world px

// Does the feet box [x0,x1] x [y0,y1] (world px) touch a closed ground-level wall?
function hitsWall(world, plotStates, x0, y0, x1, y1) {
  const tx0 = Math.floor(x0 / TILE) - 1, tx1 = Math.floor(x1 / TILE) + 1;
  const ty0 = Math.floor(y0 / TILE) - 1, ty1 = Math.floor(y1 / TILE) + 1;
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) continue;
    const pi = world.plotAt[ty * MAP_W + tx];
    if (pi < 0) continue;
    const ps = plotStates[pi];
    if (!ps?.walls) continue;
    const p = world.plots[pi];
    const lx = tx - p.x, ly = ty - p.y;
    const h = ps.walls[edgeKey(0, 'h', lx, ly)];
    if (h && !passable(h)) {
      const wy = ty * TILE;
      if (x1 > tx * TILE && x0 < (tx + 1) * TILE && y1 > wy - WALL_HALF && y0 < wy + WALL_HALF) return true;
    }
    const v = ps.walls[edgeKey(0, 'v', lx, ly)];
    if (v && !passable(v)) {
      const wx = tx * TILE;
      if (y1 > ty * TILE && y0 < (ty + 1) * TILE && x1 > wx - WALL_HALF && x0 < wx + WALL_HALF) return true;
    }
  }
  return false;
}

// (x, y) is the centre of the player's feet in world pixels.
export function canStand(world, plotStates, x, y) {
  const pts = [[x - 5, y - 5], [x + 5, y - 5], [x - 5, y - 0.5], [x + 5, y - 0.5]];
  for (const [px, py] of pts) {
    if (tileSolid(world, plotStates, Math.floor(px / TILE), Math.floor(py / TILE))) return false;
  }
  return !hitsWall(world, plotStates, x - 5, y - 5, x + 5, y - 0.5);
}

// Does a wall on this edge overlap a feet box at (x, y)? Used to refuse walls on players.
export function wallTouchesFeet(world, plotId, d, lx, ly, x, y) {
  const p = world.plots[plotId];
  const tx = p.x + lx, ty = p.y + ly;
  const [x0, y0, x1, y1] = [x - 5, y - 5, x + 5, y - 0.5];
  if (d === 'h') return x1 > tx * TILE && x0 < (tx + 1) * TILE && y1 > ty * TILE - WALL_HALF && y0 < ty * TILE + WALL_HALF;
  return y1 > ty * TILE && y0 < (ty + 1) * TILE && x1 > tx * TILE - WALL_HALF && x0 < tx * TILE + WALL_HALF;
}

// Plot rules shared by server and client: land, roads, footprints, rotation, walls,
// levels, placement and collision.
//
// A plot is a rectangle of land: { id, x, y, w, h } in world tiles, plus its owner and
// contents. Plots have no fences. They must touch a road and may cover roads, but road
// tiles stay public: nothing can be built on them (see roads below).
// Contents use plot-local tile coordinates (0..w-1, 0..h-1):
//   floor / obj     level 0 (ground) floor tiles and objects, keyed "x,y"
//   l1.floor/l1.obj level 1 (upstairs)
//   walls           wall segments on tile *edges*, keyed "level:d:x:y" -> { m, f }
//                   d = 'h' is the top edge of tile (x, y), 'v' its left edge.
//   roofs           [{ x, y, w, h, l, m }] gable roofs over a rectangle at level l
// Objects are stored once at their anchor (top-left) tile: obj["x,y"] = { t, r }.
import { ITEMS, isSoil } from './catalog.js';
import { TILE, MAP_W, MAP_H, SOLID_TILES, LAND, PUBLIC_AREAS, isRoad } from './world.js';
import { cliffBetween } from './landscape.js';

export const LEVELS = 2;
export const LEVEL_H = 2.65; // floor-to-floor height in tiles (the 3D view uses the same)
export const LAND_PRICE = 2; // coins per tile when growing a plot
export const MIN_SIDE = 8;
export const MAX_W = 60;
export const MAX_H = 48;
export const key = (lx, ly) => `${lx},${ly}`;

export const inInterior = (plot, lx, ly) => Number.isInteger(lx) && Number.isInteger(ly) && lx >= 0 && ly >= 0 && lx < plot.w && ly < plot.h;
export const plotList = (plots) => (Array.isArray(plots) ? plots.filter(Boolean) : Object.values(plots));

// Fill world.plotAt (tile -> plot id) from the live plots.
export function indexPlots(world, plots) {
  world.plotsVersion = (world.plotsVersion || 0) + 1; // lets caches (e.g. villager paths) know
  world.plotAt.fill(-1);
  for (const p of plotList(plots)) {
    for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) {
      if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) world.plotAt[y * MAP_W + x] = p.id;
    }
  }
}
const plotAtTile = (world, tx, ty) => (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H ? -1 : world.plotAt[ty * MAP_W + tx]);

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

// Buried pipes and cables (plot.under[item][tile] = 1). Older saves kept them as
// ground-floor objects: move those underground. Returns true if anything moved.
export function buryPipes(plot) {
  let moved = false;
  for (const [k, o] of Object.entries(plot.obj || {})) {
    if (ITEMS[o.t]?.layer !== 'under') continue;
    ((plot.under ||= {})[o.t] ||= {})[k] = 1;
    delete plot.obj[k];
    moved = true;
  }
  for (const [k, o] of Object.entries(plot.l1?.obj || {})) if (ITEMS[o.t]?.layer === 'under') { delete plot.l1.obj[k]; moved = true; }
  if (moved) occChanged(plot);
  return moved;
}
export const underAt = (plot, id, lx, ly) => !!plot.under?.[id]?.[key(lx, ly)];

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

// Two-segment features (double doors): a run of edges along one wall with the same
// feature pairs up from its start: (0,1), (2,3)... Returns { part: 0|1, partner: edge
// key or null } for the edge at (level, d, x, y).
export const featureWidth = (f) => ITEMS[f]?.width || 1;
export function featurePair(plot, level, d, x, y) {
  const w = plot.walls?.[edgeKey(level, d, x, y)];
  if (!w?.f || featureWidth(w.f) < 2) return { part: 0, partner: null };
  const step = (n) => (d === 'h' ? edgeKey(level, d, x + n, y) : edgeKey(level, d, x, y + n));
  let back = 0;
  while (plot.walls?.[step(-(back + 1))]?.f === w.f) back++;
  const part = back % 2;
  const partner = step(part ? -1 : 1);
  return { part, partner: plot.walls?.[partner]?.f === w.f ? partner : null };
}
// Which side of a wall a point is on: 0 = north/west face (wall.m), 1 = south/east (wall.o).
export const wallSideAt = (d, ex, ey, fx, fz) => (d === 'h' ? (fz < ey ? 0 : 1) : (fx < ex ? 0 : 1));
// The material of one face of a wall (o falls back to m).
export const faceMat = (w, side) => (side ? w.o || w.m : w.m);

// Walls go on any edge of the plot's tiles, including its outline.
export function edgeValid(plot, d, x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
  if (d === 'h') return x >= 0 && x < plot.w && y >= 0 && y <= plot.h;
  if (d === 'v') return x >= 0 && x <= plot.w && y >= 0 && y < plot.h;
  return false;
}

// ---------- roads ----------
// Is local tile (lx, ly) of this plot a public road?
export const roadIn = (world, plot, lx, ly) => !!world && isRoad(world, plot.x + lx, plot.y + ly);
const roadMsg = 'That’s a public road';

// Road tiles inside the plot that connect to road outside it ("ends" of the road).
export function roadEnds(world, plot) {
  const out = [];
  for (let ly = 0; ly < plot.h; ly++) for (let lx = 0; lx < plot.w; lx++) {
    if (!roadIn(world, plot, lx, ly)) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = lx + dx, ny = ly + dy;
      if (!inInterior(plot, nx, ny) && isRoad(world, plot.x + nx, plot.y + ny)) { out.push([lx, ly]); break; }
    }
  }
  return out;
}

// Group the plot's road ends by which ones are joined by road inside the plot.
// isRoadLocal lets callers test a hypothetical layout.
function endGroups(plot, ends, isRoadLocal) {
  const comp = new Map();
  let next = 0;
  for (const [sx, sy] of ends) {
    if (comp.has(key(sx, sy))) continue;
    const id = next++;
    const stack = [[sx, sy]];
    comp.set(key(sx, sy), id);
    while (stack.length) {
      const [x, y] = stack.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, k = key(nx, ny);
        if (comp.has(k) || !inInterior(plot, nx, ny) || !isRoadLocal(nx, ny)) continue;
        comp.set(k, id);
        stack.push([nx, ny]);
      }
    }
  }
  return ends.map(([x, y]) => comp.get(key(x, y)));
}

// Can the owner change these local tiles to road (on = true) or dig them up (on = false)?
// Roads stay public: every end of a road crossing the plot must stay, and ends that were
// joined must stay joined, so a road can be moved but never cut.
export function roadEditError(world, plot, tiles, on) {
  if (!tiles.length) return 'Nothing to change';
  const set = new Set();
  for (const [lx, ly] of tiles) {
    if (!inInterior(plot, lx, ly)) return 'Roads can only be moved inside your plot';
    if (roadIn(world, plot, lx, ly) === on) continue;
    if (on) {
      const k = key(lx, ly);
      if (plot.floor[k] || objAt(plot, lx, ly) || Object.values(plot.under || {}).some((t) => t[k]) || plot.l1?.floor[k] || objAt(plot.l1 || { obj: {} }, lx, ly)) return 'Clear the land first';
      for (const [d, x, y] of [['h', lx, ly], ['h', lx, ly + 1], ['v', lx, ly], ['v', lx + 1, ly]]) {
        for (let l = 0; l < LEVELS; l++) if (wallAt(plot, l, d, x, y)) return 'A wall is in the way';
      }
    }
    set.add(key(lx, ly));
  }
  if (!set.size) return on ? 'Already road' : 'There’s no road there';
  if (on) return null;
  const ends = roadEnds(world, plot);
  for (const [x, y] of ends) if (set.has(key(x, y))) return 'That’s where the road enters your land. Ask City Hall to close it';
  const before = endGroups(plot, ends, (x, y) => roadIn(world, plot, x, y));
  const after = endGroups(plot, ends, (x, y) => roadIn(world, plot, x, y) && !set.has(key(x, y)));
  for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
    if (before[i] === before[j] && after[i] !== after[j]) return 'Every end of the road must stay connected';
  }
  return null;
}

// Where to stand when "going home": the road tile nearest the plot's middle (inside it
// or just outside), else its middle. World pixels.
export function plotEntrance(world, plot) {
  const cx = plot.x + plot.w / 2, cy = plot.y + plot.h / 2;
  let best = null, bd = Infinity;
  for (let ty = plot.y - 1; ty <= plot.y + plot.h; ty++) for (let tx = plot.x - 1; tx <= plot.x + plot.w; tx++) {
    if (!isRoad(world, tx, ty) || world.block?.[ty * MAP_W + tx]) continue;
    const d = (tx + 0.5 - cx) ** 2 + (ty + 0.5 - cy) ** 2;
    if (d < bd) { bd = d; best = [tx, ty]; }
  }
  const [tx, ty] = best || [Math.floor(cx), Math.floor(cy)];
  return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE + 4 };
}

export const wallAt = (plot, level, d, x, y) => plot.walls?.[edgeKey(level, d, x, y)] || null;

// Wall heights, like The Sims (w.ht): 5 low, 4 half, 1 short, 2 medium (the default),
// 3 tall. HEIGHT_ORDER lists them lowest first. A tall wall can't poke through an
// upstairs floor; doors and windows need at least a short wall, shopfront glass medium.
export const WALL_HEIGHTS = [0, 2.1, 2.5, 3.3, 1.2, 0.6];
export const HEIGHT_ORDER = [5, 4, 1, 2, 3];
export const HEIGHT_NAMES = { 5: 'Low', 4: 'Half', 1: 'Short', 2: 'Medium', 3: 'Tall' };
const NEEDS_MEDIUM = new Set(['window_shop', 'door_shop', 'door_shopdouble']);
export function wallHeight(plot, level, d, x, y, w = wallAt(plot, level, d, x, y)) {
  let ht = w?.ht || 2;
  if ((ht === 4 || ht === 5) && w?.f) ht = 1;
  if (ht === 1 && NEEDS_MEDIUM.has(w?.f)) ht = 2;
  if (ht === 3 && level + 1 < LEVELS) {
    const up = levelView(plot, level + 1).floor;
    const [ax, ay, bx, by] = d === 'h' ? [x, y - 1, x, y] : [x - 1, y, x, y];
    if (up[key(ax, ay)] || up[key(bx, by)]) ht = 2;
  }
  return WALL_HEIGHTS[ht];
}
// The straight line of walls this one is part of (same direction, end to end).
export function wallLine(plot, level, d, x, y) {
  const has = (i) => { const w = plot.walls?.[d === 'h' ? edgeKey(level, d, i, y) : edgeKey(level, d, x, i)]; return w && !ITEMS[w.m]?.fence; };
  const at = d === 'h' ? x : y;
  if (!has(at)) return null;
  let a = at, b = at + 1;
  while (has(a - 1)) a--;
  while (has(b)) b++;
  return { d, fixed: d === 'h' ? y : x, a, b }; // edges a..b-1 along the line
}
export const lineEdges2 = (L) => Array.from({ length: L.b - L.a }, (_, i) => (L.d === 'h' ? ['h', L.a + i, L.fixed] : ['v', L.fixed, L.a + i]));
// Every wall joined to this one (end to end, on the same floor): what a height change sets.
export function wallRun(plot, level, d, x, y) {
  const out = new Set(), todo = [[d, x, y]];
  const ends = (dd, xx, yy) => (dd === 'h' ? [[xx, yy], [xx + 1, yy]] : [[xx, yy], [xx, yy + 1]]);
  const at = (cx, cy) => [['h', cx, cy], ['h', cx - 1, cy], ['v', cx, cy], ['v', cx, cy - 1]];
  while (todo.length && out.size < 2000) {
    const [dd, xx, yy] = todo.pop(), k = edgeKey(level, dd, xx, yy), w = plot.walls?.[k];
    if (out.has(k) || !w || ITEMS[w.m]?.fence) continue;
    out.add(k);
    for (const [cx, cy] of ends(dd, xx, yy)) todo.push(...at(cx, cy));
  }
  return [...out];
}

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

const passable = (w) => !!(w && ((w.f && ITEMS[w.f]?.passable) || ITEMS[w.m]?.gate));
export const isFence = (w) => !!ITEMS[w?.m]?.fence;

// ---------- placement ----------
// Returns null when OK, or a short reason string.
export function placementError(plot, lx, ly, itemId, r = 0, level = 0, world = null) {
  const item = ITEMS[itemId];
  if (!item || item.cat === 'public') return 'Unknown item';
  const view = levelView(plot, level);
  if (item.layer === 'floor') {
    if (!inInterior(plot, lx, ly)) return 'Outside your plot';
    if (roadIn(world, plot, lx, ly)) return roadMsg;
    if (level && isSoil(itemId)) return 'Soil only works outdoors';
    if (level && isStairTile(plot, lx, ly)) return 'That’s the stairwell';
    const k = key(lx, ly);
    if (view.floor[k] === itemId) return 'Already there';
    const here = objAt(view, lx, ly);
    if (here && ITEMS[here.obj.t]?.crop) return 'Harvest the crop first';
    if (isSoil(view.floor[k]) && here) return 'Clear it first';
    return null;
  }
  if (item.layer === 'under') {
    if (level) return 'Pipes and cables are buried under the ground floor';
    if (!inInterior(plot, lx, ly)) return 'Outside your plot';
    if (roadIn(world, plot, lx, ly)) return roadMsg;
    if (plot.under?.[itemId]?.[key(lx, ly)]) return 'Already there';
    return null;
  }
  if (item.layer !== 'obj') return 'Use the wall tools for that';
  if (!canRotate(itemId) && r) return 'That item can’t be rotated';
  if (item.stairs && level) return 'Stairs go on the ground floor';
  const tiles = tilesOf(itemId, r, lx, ly);
  for (const [tx, ty] of tiles) {
    if (!inInterior(plot, tx, ty)) return 'Doesn’t fit there';
    if (roadIn(world, plot, tx, ty)) return roadMsg;
    if (objAt(view, tx, ty)) return 'Tile is occupied';
    if (level && !view.floor[key(tx, ty)]) return 'Needs a floor underneath';
    if (level && isStairTile(plot, tx, ty)) return 'That’s the stairwell';
    if (item.stairs && objAt(levelView(plot, 1), tx, ty)) return 'Clear the furniture upstairs first';
  }
  for (const [ax, ay] of tiles) for (const [bx, by] of tiles) {
    const e = edgeBetween(ax, ay, bx, by);
    if (e && wallAt(plot, level, ...e)) return 'A wall is in the way';
  }
  if (item.crop && (level || !isSoil(view.floor[key(lx, ly)]))) return 'Seeds need tilled soil';
  return null;
}

export function wallError(plot, level, d, x, y, world = null) {
  if (!edgeValid(plot, d, x, y)) return 'Walls must stay on your plot';
  if (level < 0 || level >= LEVELS) return 'Unknown level';
  const view = levelView(plot, level);
  const [ax, ay, bx, by] = d === 'h' ? [x, y - 1, x, y] : [x - 1, y, x, y];
  for (const [tx, ty] of [[ax, ay], [bx, by]]) if (inInterior(plot, tx, ty) && roadIn(world, plot, tx, ty)) return roadMsg;
  const a = objAt(view, ax, ay), b = objAt(view, bx, by);
  if (a && b && a.key === b.key) return 'Something is in the way';
  return null;
}

export function roofError(plot, x, y, w, h, level, world = null) {
  if (![x, y, w, h].every(Number.isInteger) || w < 1 || h < 1) return 'Bad roof size';
  if (!inInterior(plot, x, y) || !inInterior(plot, x + w - 1, y + h - 1)) return 'Roofs must stay on your plot';
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (roadIn(world, plot, x + i, y + j)) return roadMsg;
  if (level < 0 || level >= LEVELS) return 'Unknown level';
  for (const rf of plot.roofs || []) {
    if (rf.l === level && x < rf.x + rf.w && rf.x < x + w && y < rf.y + rf.h && rf.y < y + h) return 'Overlaps another roof';
  }
  return null;
}

export function roofAt(plot, lx, ly, level) {
  return (plot.roofs || []).findIndex((rf) => (level == null || rf.l === level) && lx >= rf.x && lx < rf.x + rf.w && ly >= rf.y && ly < rf.y + rf.h);
}

// ---------- land: resize, merge, split ----------
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// Is `rect` a valid plot shape for plot `id` (null for a brand-new plot)?
// Plots sit on open land inside the forest, off the public areas, touching a road.
export function landError(plots, id, rect, world) {
  const { x, y, w, h } = rect;
  if (![x, y, w, h].every(Number.isInteger)) return 'Bad plot shape';
  if (w < MIN_SIDE || h < MIN_SIDE) return `Plots must be at least ${MIN_SIDE}×${MIN_SIDE}`;
  if (w > MAX_W || h > MAX_H) return `Plots can be at most ${MAX_W}×${MAX_H}`;
  if (x < LAND.x || y < LAND.y || x + w > LAND.x + LAND.w || y + h > LAND.y + LAND.h) return 'That’s the forest';
  const pub = PUBLIC_AREAS.find((a) => overlaps(a, rect));
  if (pub) return `${pub.name} is public land`;
  for (const p of plotList(plots)) if (p.id !== id && overlaps(p, rect)) return 'Overlaps another plot';
  if (world) {
    let touches = false;
    for (let ty = y - 1; ty <= y + h && !touches; ty++) for (let tx = x - 1; tx <= x + w; tx++) {
      const corner = (tx === x - 1 || tx === x + w) && (ty === y - 1 || ty === y + h);
      if (!corner && isRoad(world, tx, ty)) { touches = true; break; }
    }
    if (!touches) return 'Plots must touch a road';
  }
  return null;
}

// Every tile/edge the plot's contents touch, in local coordinates.
function eachContent(plot, fn) {
  for (const view of [plot, plot.l1 || { floor: {}, obj: {} }]) {
    for (const k of Object.keys(view.floor)) { const [x, y] = k.split(',').map(Number); fn('tile', x, y); }
    for (const [k, o] of Object.entries(view.obj)) {
      const [x, y] = k.split(',').map(Number);
      for (const [tx, ty] of tilesOf(o.t, o.r || 0, x, y)) fn('tile', tx, ty);
    }
  }
  for (const tiles of Object.values(plot.under || {})) for (const k of Object.keys(tiles)) { const [x, y] = k.split(',').map(Number); fn('tile', x, y); }
  for (const k of Object.keys(plot.walls || {})) { const e = parseEdge(k); fn(e.d, e.x, e.y); }
  for (const rf of plot.roofs || []) { fn('tile', rf.x, rf.y); fn('tile', rf.x + rf.w - 1, rf.y + rf.h - 1); }
}

// Would the contents still fit if the plot became `rect`? (Contents keep their world position.)
export function contentFits(plot, rect) {
  const dx = plot.x - rect.x, dy = plot.y - rect.y;
  const shape = { w: rect.w, h: rect.h };
  let ok = true;
  eachContent(plot, (kind, x, y) => {
    if (!ok) return;
    if (kind === 'tile') ok = inInterior(shape, x + dx, y + dy);
    else ok = edgeValid(shape, kind, x + dx, y + dy);
  });
  return ok;
}

export const hasContent = (plot) => { let any = false; eachContent(plot, () => { any = true; }); return any; };

// Move contents by (dx, dy) local tiles (used when the plot's origin moves).
export function shiftContent(plot, dx, dy) {
  if (!dx && !dy) return;
  const sk = (k) => { const [x, y] = k.split(',').map(Number); return key(x + dx, y + dy); };
  const remap = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [sk(k), v]));
  plot.floor = remap(plot.floor); plot.obj = remap(plot.obj);
  if (plot.l1) plot.l1 = { floor: remap(plot.l1.floor), obj: remap(plot.l1.obj) };
  if (plot.under) plot.under = Object.fromEntries(Object.entries(plot.under).map(([id, tiles]) => [id, remap(tiles)]));
  plot.walls = Object.fromEntries(Object.entries(plot.walls || {}).map(([k, v]) => {
    const e = parseEdge(k);
    return [edgeKey(e.l, e.d, e.x + dx, e.y + dy), v];
  }));
  plot.roofs = (plot.roofs || []).map((rf) => ({ ...rf, x: rf.x + dx, y: rf.y + dy }));
  occChanged(plot);
}

// Two plots side by side (same depth) or stacked (same width) merge into one rectangle.
export function mergedRect(a, b) {
  if (a.y === b.y && a.h === b.h && (a.x + a.w === b.x || b.x + b.w === a.x)) return { x: Math.min(a.x, b.x), y: a.y, w: a.w + b.w, h: a.h };
  if (a.x === b.x && a.w === b.w && (a.y + a.h === b.y || b.y + b.h === a.y)) return { x: a.x, y: Math.min(a.y, b.y), w: a.w, h: a.h + b.h };
  return null;
}

// Split a plot with a north-south line at world column `at`.
export function splitRects(plot, at) {
  if (!Number.isInteger(at) || at - plot.x < MIN_SIDE || plot.x + plot.w - at < MIN_SIDE) return null;
  return [{ x: plot.x, y: plot.y, w: at - plot.x, h: plot.h }, { x: at, y: plot.y, w: plot.x + plot.w - at, h: plot.h }];
}

// ---------- stairs ----------
const isStairTile = (plot, lx, ly) => { const h = objAt(plot, lx, ly); return !!(h && ITEMS[h.obj.t]?.stairs); };

// Stairs climb away from their front: r 0 climbs north, 1 east, 2 south, 3 west.
// Returns the stair under world pixel (px, py) with t = 0 at the bottom .. 1 at the top.
function stairInfo(plot, k, o, px, py) {
  const [ax, ay] = k.split(',').map(Number);
  const r = o.r || 0;
  const [w, h] = footprint(o.t, r);
  const x0 = (plot.x + ax) * TILE, y0 = (plot.y + ay) * TILE, x1 = x0 + w * TILE, y1 = y0 + h * TILE;
  const t = r === 0 ? (y1 - py) / (y1 - y0) : r === 2 ? (py - y0) / (y1 - y0) : r === 1 ? (px - x0) / (x1 - x0) : (x1 - px) / (x1 - x0);
  return { plot, key: k, r, x0, y0, x1, y1, t: Math.max(0, Math.min(1, t)) };
}

export function stairsAt(world, plots, px, py) {
  const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
  const pid = plotAtTile(world, tx, ty);
  if (pid < 0) return null;
  const p = plotById(plots, pid);
  const hit = p && objAt(p, tx - p.x, ty - p.y);
  return hit && ITEMS[hit.obj.t]?.stairs ? stairInfo(p, hit.key, hit.obj, px, py) : null;
}

// Height (tiles) of feet at (x, y) for someone on `level`; stairs blend between floors.
export function heightAt(world, plots, x, y, level = 0) {
  const st = stairsAt(world, plots, x, y - 2.5);
  return st ? st.t * LEVEL_H : level * LEVEL_H;
}

// On stairs your level is whichever floor you're closer to.
export function resolveLevel(world, plots, x, y, level) {
  const st = stairsAt(world, plots, x, y - 2.5);
  return st ? (st.t >= 0.5 ? 1 : 0) : level;
}

// Is a stair edge between tiles a and b closed? null = not a stair edge.
// Sides are always closed; the top end only opens upstairs and the bottom end only
// opens downstairs.
function stairEdge(world, plots, ax, ay, bx, by, level) {
  const sa = stairsAt(world, plots, (ax + 0.5) * TILE, (ay + 0.5) * TILE);
  const sb = stairsAt(world, plots, (bx + 0.5) * TILE, (by + 0.5) * TILE);
  if (sa && sb && sa.key === sb.key && sa.plot === sb.plot) return null;
  let res = null;
  for (const [st, sx, sy, ox, oy] of [[sa, ax, ay, bx, by], [sb, bx, by, ax, ay]]) {
    if (!st) continue;
    // Direction from the stair tile to the other tile, vs the climbing direction.
    const dx = ox - sx, dy = oy - sy;
    const up = [[0, -1], [1, 0], [0, 1], [-1, 0]][st.r];
    if (dx === up[0] && dy === up[1]) res = res || level === 0; // top end
    else if (dx === -up[0] && dy === -up[1]) res = res || level === 1; // bottom end: from the ground only
    else res = true; // sides
  }
  return res;
}

// ---------- collision ----------
// plots: live plots (array or object keyed by id); world.plotAt must be indexed.
const plotById = (plots, id) => (Array.isArray(plots) ? plots.find((p) => p && p.id === id) : plots[id]);

export function tileSolid(world, plots, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return true;
  if (SOLID_TILES.has(world.tiles[ty * MAP_W + tx]) || world.block?.[ty * MAP_W + tx]) return true;
  const pid = plotAtTile(world, tx, ty);
  if (pid >= 0) {
    const p = plotById(plots, pid);
    const hit = p && objAt(p, tx - p.x, ty - p.y);
    if (hit && ITEMS[hit.obj.t]?.solid) return true;
  }
  return false;
}

// Can a point be stood on at this level? Upstairs you need a floor under your feet.
function pointOK(world, plots, px, py, level) {
  if (stairsAt(world, plots, px, py)) return true;
  const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
  if (!level) return !tileSolid(world, plots, tx, ty);
  const pid = plotAtTile(world, tx, ty);
  const p = pid >= 0 && plotById(plots, pid);
  if (!p?.l1?.floor[key(tx - p.x, ty - p.y)]) return false;
  const hit = objAt(p.l1, tx - p.x, ty - p.y);
  return !(hit && ITEMS[hit.obj.t]?.solid);
}

// Is the horizontal edge on top of world tile (tx, ty) closed on this level?
function hClosed(world, plots, tx, ty, level) {
  if (cliffBetween(world, tx, ty - 1, tx, ty)) return true; // the edge of high ground
  const st = stairEdge(world, plots, tx, ty - 1, tx, ty, level);
  if (st !== null) return st;
  return edgeClosed(plots, 'h', tx, ty, level, plotAtTile(world, tx, ty - 1), plotAtTile(world, tx, ty));
}

// A world edge is closed by a wall or fence (not a doorway or gate) of either plot it borders.
function edgeClosed(plots, d, tx, ty, level, a, b) {
  for (const id of a === b ? [a] : [a, b]) {
    if (id < 0) continue;
    const p = plotById(plots, id);
    const w = p?.walls?.[edgeKey(level, d, tx - p.x, ty - p.y)];
    if (w && !passable(w)) return true;
  }
  return false;
}

function vClosed(world, plots, tx, ty, level) {
  if (cliffBetween(world, tx - 1, ty, tx, ty)) return true;
  const st = stairEdge(world, plots, tx - 1, ty, tx, ty, level);
  if (st !== null) return st;
  return edgeClosed(plots, 'v', tx, ty, level, plotAtTile(world, tx - 1, ty), plotAtTile(world, tx, ty));
}

const WALL_HALF = 1.5; // wall thickness / 2 in world px

function hitsEdges(world, plots, x0, y0, x1, y1, level) {
  const tx0 = Math.floor(x0 / TILE) - 1, tx1 = Math.floor(x1 / TILE) + 1;
  const ty0 = Math.floor(y0 / TILE) - 1, ty1 = Math.floor(y1 / TILE) + 1;
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    if (hClosed(world, plots, tx, ty, level)) {
      const wy = ty * TILE;
      if (x1 > tx * TILE && x0 < (tx + 1) * TILE && y1 > wy - WALL_HALF && y0 < wy + WALL_HALF) return true;
    }
    if (vClosed(world, plots, tx, ty, level)) {
      const wx = tx * TILE;
      if (y1 > ty * TILE && y0 < (ty + 1) * TILE && x1 > wx - WALL_HALF && x0 < wx + WALL_HALF) return true;
    }
  }
  return false;
}

// Does going in a straight line from (x0, y0) to (x1, y1) cross a wall (doors are open)?
export function crossesWall(world, plots, x0, y0, x1, y1, level = 0) {
  return hitsEdges(world, plots, Math.min(x0, x1) - 1, Math.min(y0, y1) - 1, Math.max(x0, x1) + 1, Math.max(y0, y1) + 1, level);
}

// (x, y) is the centre of the player's feet in world pixels.
export function canStand(world, plots, x, y, level = 0) {
  const pts = [[x - 5, y - 5], [x + 5, y - 5], [x - 5, y - 0.5], [x + 5, y - 0.5]];
  for (const [px, py] of pts) if (!pointOK(world, plots, px, py, level)) return false;
  return !hitsEdges(world, plots, x - 5, y - 5, x + 5, y - 0.5, level);
}

// One step of movement for someone on `level`: the level they end up on, or -1 if the
// step is blocked. Changing floors is only possible along stairs, so the step must be
// valid on both the old and the new level.
export function stepLevel(world, plots, x, y, level) {
  const nl = resolveLevel(world, plots, x, y, level);
  if (!canStand(world, plots, x, y, nl)) return -1;
  if (nl !== level && !canStand(world, plots, x, y, level)) return -1;
  return nl;
}

// Does a wall on this local edge overlap a feet box at (x, y)? Used to refuse walls on players.
export function wallTouchesFeet(plot, d, lx, ly, x, y) {
  const tx = plot.x + lx, ty = plot.y + ly;
  const [x0, y0, x1, y1] = [x - 5, y - 5, x + 5, y - 0.5];
  if (d === 'h') return x1 > tx * TILE && x0 < (tx + 1) * TILE && y1 > ty * TILE - WALL_HALF && y0 < ty * TILE + WALL_HALF;
  return y1 > ty * TILE && y0 < (ty + 1) * TILE && x1 > tx * TILE - WALL_HALF && x0 < tx * TILE + WALL_HALF;
}

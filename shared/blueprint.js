// Blueprints: a piece of a plot (a room, or a whole house) lifted out as a "fragment"
// that can be rotated and put down somewhere else. Used for moving and rotating rooms,
// moving the whole house, the player's library and the built-in styled rooms.
//
// fragment = {
//   w, h,                                   bounding box in tiles
//   levels: [{ floor, obj }, { floor, obj }],  contents keyed "x,y" relative to the box
//   walls: { "l:d:x:y": { m, f } },         relative edges
//   roofs: [{ x, y, w, h, l, m }],          relative rectangles
// }
import { ITEMS } from './catalog.js';
import {
  LEVELS, key, levelView, footprint, tilesOf, canRotate, objAt, occChanged, edgeKey, parseEdge,
  edgeValid, inInterior, roadIn,
} from './plot.js';

const emptyLevels = () => Array.from({ length: LEVELS }, () => ({ floor: {}, obj: {} }));
const parseKey = (k) => k.split(',').map(Number);
const stairAt = (plot, x, y) => { const h = objAt(plot, x, y); return !!(h && ITEMS[h.obj.t]?.stairs); };

// The tiles of the room around (lx, ly) on `level`: floor tiles joined without a wall
// (or door) between them.
export function roomTiles(plot, level, lx, ly) {
  const view = levelView(plot, level);
  if (!view.floor[key(lx, ly)]) return null;
  const seen = new Set([key(lx, ly)]);
  const stack = [[lx, ly]];
  while (stack.length && seen.size < 900) {
    const [x, y] = stack.pop();
    for (const [dx, dy, d, ex, ey] of [[1, 0, 'v', x + 1, y], [-1, 0, 'v', x, y], [0, 1, 'h', x, y + 1], [0, -1, 'h', x, y]]) {
      const nx = x + dx, ny = y + dy, k = key(nx, ny);
      if (seen.has(k) || !view.floor[k] || plot.walls?.[edgeKey(level, d, ex, ey)]) continue;
      seen.add(k);
      stack.push([nx, ny]);
    }
  }
  return seen;
}

// What clicking a room's floor picks up. On the ground floor that's the whole column:
// the room plus everything above it (upstairs floor and furniture, stairs, roofs), so
// two-storey rooms and rooms with stairs move as one piece.
export function roomRegion(plot, level, lx, ly) {
  const tiles = roomTiles(plot, level, lx, ly);
  return tiles && { level, levels: level ? [level] : [...Array(LEVELS).keys()], tiles };
}

// Lift a fragment out of a plot (without changing the plot).
// region: null for everything, or { level, levels?, tiles: Set of "x,y" } for a room
// (levels defaults to just `level`).
export function extract(plot, region = null) {
  const parts = { levels: emptyLevels(), walls: {}, roofs: [] };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (x, y, w = 1, h = 1) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h); };
  const levels = region ? region.levels || [region.level] : [...Array(LEVELS).keys()];
  const inRegion = (x, y) => !region || region.tiles.has(key(x, y));
  for (const l of levels) {
    const view = levelView(plot, l);
    for (const [k, f] of Object.entries(view.floor)) { const [x, y] = parseKey(k); if (inRegion(x, y)) { parts.levels[l].floor[k] = f; grow(x, y); } }
    for (const [k, o] of Object.entries(view.obj)) {
      const [x, y] = parseKey(k);
      const tiles = tilesOf(o.t, o.r || 0, x, y);
      if (tiles.every(([tx, ty]) => inRegion(tx, ty))) { parts.levels[l].obj[k] = { ...o }; const [w, h] = footprint(o.t, o.r || 0); grow(x, y, w, h); }
    }
  }
  for (const [k, w] of Object.entries(plot.walls || {})) {
    const e = parseEdge(k);
    if (!levels.includes(e.l)) continue;
    const [ax, ay] = e.d === 'h' ? [e.x, e.y - 1] : [e.x - 1, e.y];
    if (region && !inRegion(ax, ay) && !inRegion(e.x, e.y)) continue;
    parts.walls[k] = { ...w };
    if (e.d === 'h') grow(e.x, e.y, 1, 0); else grow(e.x, e.y, 0, 1);
  }
  // Roofs come along when they sit wholly over the picked tiles.
  const roofIn = (rf) => { for (let y = rf.y; y < rf.y + rf.h; y++) for (let x = rf.x; x < rf.x + rf.w; x++) if (!inRegion(x, y)) return false; return true; };
  for (const rf of plot.roofs || []) if (!region || (levels.includes(rf.l || 0) && roofIn(rf))) { parts.roofs.push({ ...rf }); grow(rf.x, rf.y, rf.w, rf.h); }
  if (x0 === Infinity) return null;
  // Re-base everything on the bounding box.
  const shift = (k) => { const [x, y] = parseKey(k); return key(x - x0, y - y0); };
  const frag = {
    w: x1 - x0, h: y1 - y0, ox: x0, oy: y0,
    levels: parts.levels.map((v) => ({
      floor: Object.fromEntries(Object.entries(v.floor).map(([k, f]) => [shift(k), f])),
      obj: Object.fromEntries(Object.entries(v.obj).map(([k, o]) => [shift(k), o])),
    })),
    walls: Object.fromEntries(Object.entries(parts.walls).map(([k, w]) => { const e = parseEdge(k); return [edgeKey(e.l, e.d, e.x - x0, e.y - y0), w]; })),
    roofs: parts.roofs.map((rf) => ({ ...rf, x: rf.x - x0, y: rf.y - y0 })),
  };
  return frag;
}

// Turn a fragment a quarter turn clockwise (as seen from above, north up).
export function rotate(frag) {
  const H = frag.h;
  const out = { w: frag.h, h: frag.w, levels: emptyLevels(), walls: {}, roofs: [] };
  frag.levels.forEach((v, l) => {
    for (const [k, f] of Object.entries(v.floor)) { const [x, y] = parseKey(k); out.levels[l].floor[key(H - 1 - y, x)] = f; }
    for (const [k, o] of Object.entries(v.obj)) {
      const [x, y] = parseKey(k);
      const [, fh] = footprint(o.t, o.r || 0);
      const r = canRotate(o.t) ? ((o.r || 0) + 1) % 4 : o.r || 0;
      const n = { ...o };
      if (r) n.r = r; else delete n.r;
      out.levels[l].obj[key(H - y - fh, x)] = n;
    }
  });
  for (const [k, w] of Object.entries(frag.walls)) {
    const e = parseEdge(k);
    // A wall's two faces: turning a north/south wall clockwise puts its north face on
    // the east, so the paints swap; west/east walls keep theirs (west becomes north).
    const nw = e.d === 'h' && w.o ? { ...w, m: w.o, o: w.m } : w;
    out.walls[e.d === 'h' ? edgeKey(e.l, 'v', H - e.y, e.x) : edgeKey(e.l, 'h', H - e.y - 1, e.x)] = nw;
  }
  out.roofs = frag.roofs.map((rf) => ({ ...rf, x: H - rf.y - rf.h, y: rf.x, w: rf.h, h: rf.w }));
  return out;
}

export function rotateTimes(frag, n) { let f = frag; for (let i = 0; i < ((n % 4) + 4) % 4; i++) f = rotate(f); return f; }

// Price of everything in a fragment (shop-only furniture is never included: it can't be
// bought with coins, so blueprints leave it out).
export function fragmentValue(frag) {
  let v = 0;
  for (const lv of frag.levels) {
    for (const f of Object.values(lv.floor)) v += ITEMS[f]?.price || 0;
    for (const o of Object.values(lv.obj)) if (!ITEMS[o.t]?.shop) v += ITEMS[o.t]?.price || 0;
  }
  for (const w of Object.values(frag.walls)) v += (ITEMS[w.m]?.price || 0) + (ITEMS[w.f]?.price || 0) / (ITEMS[w.f]?.width || 1) + (w.o ? Math.ceil((ITEMS[w.o]?.price || 0) / 2) : 0);
  for (const rf of frag.roofs) v += (ITEMS[rf.m]?.price || 0) * rf.w * rf.h;
  return v;
}

// Shop furniture (which can't be bought with coins) comes out of your bag. Returns the
// fragment without the pieces you don't have, plus what it takes from the bag and what's
// missing, as { type: count }. free (free build) keeps everything.
export function stockFragment(frag, inv = {}, free = false) {
  const left = { ...inv }, used = {}, missing = {};
  const keep = (o) => {
    if (free || !ITEMS[o.t]?.shop) return true;
    const ok = (left[o.t] || 0) > 0;
    if (ok) left[o.t]--;
    const tally = ok ? used : missing;
    tally[o.t] = (tally[o.t] || 0) + 1;
    return ok;
  };
  const levels = frag.levels.map((v) => ({ floor: v.floor, obj: Object.fromEntries(Object.entries(v.obj).filter(([, o]) => keep(o))) }));
  return { frag: { ...frag, levels }, used, missing };
}

// Delete what a fragment covers at (ox, oy) from the plot (used to pick a room up).
export function removeAt(plot, frag, ox, oy) {
  frag.levels.forEach((v, l) => {
    const view = levelView(plot, l);
    for (const k of Object.keys(v.floor)) { const [x, y] = parseKey(k); delete view.floor[key(x + ox, y + oy)]; }
    for (const k of Object.keys(v.obj)) { const [x, y] = parseKey(k); delete view.obj[key(x + ox, y + oy)]; }
  });
  for (const k of Object.keys(frag.walls)) { const e = parseEdge(k); delete plot.walls[edgeKey(e.l, e.d, e.x + ox, e.y + oy)]; }
  const roofKeys = new Set(frag.roofs.map((rf) => `${rf.x + ox},${rf.y + oy},${rf.w},${rf.h},${rf.l}`));
  plot.roofs = (plot.roofs || []).filter((rf) => !roofKeys.has(`${rf.x},${rf.y},${rf.w},${rf.h},${rf.l}`));
  occChanged(plot);
}

// Can the fragment go down at (ox, oy)? Everything must land on empty land inside the
// plot and off the public road.
export function placeError(plot, frag, ox, oy, world) {
  for (let l = 0; l < frag.levels.length; l++) {
    const v = frag.levels[l], view = levelView(plot, l);
    for (const k of Object.keys(v.floor)) {
      const [x, y] = parseKey(k);
      const tx = x + ox, ty = y + oy;
      if (!inInterior(plot, tx, ty)) return 'It doesn’t fit on your plot';
      if (roadIn(world, plot, tx, ty)) return 'That’s a public road';
      if (view.floor[key(tx, ty)] || objAt(view, tx, ty)) return 'Clear the space first';
      if (l > 0 && stairAt(plot, tx, ty)) return 'That’s the stairwell';
    }
    for (const [k, o] of Object.entries(v.obj)) {
      const [x, y] = parseKey(k);
      for (const [tx, ty] of tilesOf(o.t, o.r || 0, x + ox, y + oy)) {
        if (!inInterior(plot, tx, ty)) return 'It doesn’t fit on your plot';
        if (roadIn(world, plot, tx, ty)) return 'That’s a public road';
        if (objAt(view, tx, ty)) return 'Clear the space first';
        if (l > 0 && !view.floor[key(tx, ty)] && !v.floor[key(tx - ox, ty - oy)]) return 'Upstairs furniture needs a floor';
        if (l > 0 && stairAt(plot, tx, ty)) return 'That’s the stairwell';
        if (ITEMS[o.t]?.stairs) {
          const up = levelView(plot, 1);
          if (up.floor[key(tx, ty)] || objAt(up, tx, ty)) return 'Stairs need a clear stairwell upstairs';
        }
      }
    }
  }
  for (const k of Object.keys(frag.walls)) {
    const e = parseEdge(k);
    const x = e.x + ox, y = e.y + oy;
    if (!edgeValid(plot, e.d, x, y)) return 'It doesn’t fit on your plot';
    if (plot.walls?.[edgeKey(e.l, e.d, x, y)]) return 'A wall is in the way';
    const [ax, ay] = e.d === 'h' ? [x, y - 1] : [x - 1, y];
    for (const [tx, ty] of [[ax, ay], [x, y]]) if (inInterior(plot, tx, ty) && roadIn(world, plot, tx, ty)) return 'That’s a public road';
  }
  for (const rf of frag.roofs) {
    if (!inInterior(plot, rf.x + ox, rf.y + oy) || !inInterior(plot, rf.x + ox + rf.w - 1, rf.y + oy + rf.h - 1)) return 'It doesn’t fit on your plot';
    for (const o of plot.roofs || []) if (o.l === rf.l && rf.x + ox < o.x + o.w && o.x < rf.x + ox + rf.w && rf.y + oy < o.y + o.h && o.y < rf.y + oy + rf.h) return 'A roof is in the way';
  }
  return null;
}

// Put a fragment down at (ox, oy). Call placeError first.
export function applyAt(plot, frag, ox, oy, opts = {}) {
  frag.levels.forEach((v, l) => {
    const view = levelView(plot, l);
    for (const [k, f] of Object.entries(v.floor)) { const [x, y] = parseKey(k); view.floor[key(x + ox, y + oy)] = f; }
    for (const [k, o] of Object.entries(v.obj)) {
      const [x, y] = parseKey(k);
      const n = { ...o };
      if (ITEMS[o.t]?.crop) n.p = opts.now ?? n.p;
      view.obj[key(x + ox, y + oy)] = n;
    }
  });
  for (const [k, w] of Object.entries(frag.walls)) { const e = parseEdge(k); plot.walls[edgeKey(e.l, e.d, e.x + ox, e.y + oy)] = { ...w }; }
  plot.roofs ||= [];
  for (const rf of frag.roofs) plot.roofs.push({ ...rf, x: rf.x + ox, y: rf.y + oy });
  occChanged(plot);
}

// Strip the bookkeeping fields before storing a fragment.
// A blueprint to keep: shape and furniture only (no stock on shelves, jobs in machines
// or animals in barns).
const bare = (o) => { const { stock, job, animals, goods, inv, qual, ...rest } = o; return rest; };
export const cleanFragment = (f) => ({
  w: f.w, h: f.h, walls: f.walls, roofs: f.roofs,
  levels: f.levels.map((l) => ({ ...l, obj: Object.fromEntries(Object.entries(l.obj || {}).map(([k, o]) => [k, bare(o)])) })),
});

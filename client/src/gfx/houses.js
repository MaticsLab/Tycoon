// Builds a plot's house in 3D from its Sims-style data (see shared/plot.js):
// floors on two levels, wall segments on tile edges with real door/window openings,
// Sims cutaway, gable roofs, furniture models and pixel-art cards for plants/crops.
import { ITEMS, cropStage, isWet } from '@shared/catalog.js';
import { parseEdge, levelView, footprint, LEVELS, LEVEL_H, featurePair, edgeKey, objAt } from '@shared/plot.js';
import { wallTex, floorTex, roofTex, woodTex, signTex, doorTex, WALL_H } from './textures.js';
import { Batch, boxAt, gableRoof } from './geom.js';
import { itemInto, hasModel, BILLBOARD, materials } from './models.js';
import { Geo, box, toMesh, node, lambert as mkLambert } from './bjs.js';
import { objectSprite, cropSprite } from '../sprites.js';

export { LEVEL_H }; // floor-to-floor height (shared with the game rules)
export const LOW_H = 0.4; // cut-away wall height
const THICK = 0.12;
// Night lights of newer items: [x, y, z (tiles from the item's NW corner), kind].
const EXTRA_LIGHTS = {
  arclamp: [0.6, 1.3, 0.68, 'lamp'], lantern: [0.5, 0.3, 0.5, 'pumpkin'],
  firepit: [0.5, 0.35, 0.5, 'fire'], stonelantern: [0.5, 0.95, 0.5, 'pumpkin'],
};

const mats = new Map();
const mat = (key, make) => { if (!mats.has(key)) mats.set(key, make()); return mats.get(key); };
const lambert = (o) => mkLambert(o);
const wallMat = (m) => mat(`wall|${m}`, () => lambert({ map: wallTex(m) }));
const trimMat = () => mat('trim', () => lambert({ color: '#4a2e18' }));
const doorMat = () => mat('door', () => lambert({ map: woodTex() }));
export const glassMat = () => mat('glass', () => lambert({ color: '#8fd0f0', emissive: '#000000', transparent: true, opacity: 0.55 }));
const knobMat = () => mat('knob', () => lambert({ color: '#f5c542' }));
// Door and window paint (Design tool cycles it): natural wood, blue, red, green, black, cream.
export const DOOR_COLS = ['#9b6436', '#2f5d8a', '#b03a2e', '#3e7a3a', '#2e3238', '#efe9dc'];
const TRIM_COLS = ['#4a2e18', '#284f78', '#8f2c22', '#2f5f2d', '#23272c', '#e8e2d2'];
const frameMat = (fc = 0) => mat(`frame|${fc}`, () => lambert({ color: TRIM_COLS[fc] || TRIM_COLS[0] }));
const panelDoorMat = (fc = 0, style = 'panel') => mat(`doorp|${fc}|${style}`, () => lambert({ map: doorTex(DOOR_COLS[fc] || DOOR_COLS[0], style) }));
const alumMat = () => mat('alum', () => lambert({ color: '#3a4048' }));
// Storefront pieces join up into one glass wall when they sit side by side.
const SHOPFRONT = new Set(['window_shop', 'door_shop', 'door_shopdouble']);
const featureWidth2 = (f) => (ITEMS[f]?.width || 1) === 2;
const railMat = () => mat('rail', () => lambert({ map: woodTex() }));
const ceilMat = () => mat('ceil', () => lambert({ color: '#e8e2d4' }));
const roofMat = (m) => mat(`roof|${m}`, () => lambert({ map: roofTex(m) }));
const floorMat = (t) => mat(`floor|${t}`, () => lambert({ map: floorTex(t) }));

// A piece of wall along an edge: `a`..`b` along the edge (0..1), `y0`..`y1` up.
function wallPiece(batch, m, e, ox, oz, base, a, b, y0, y1, thick = THICK) {
  if (b - a <= 0.001 || y1 - y0 <= 0.001) return;
  const x = ox + e.x, z = oz + e.y;
  if (e.d === 'h') batch.add(m, boxAt(x + a, base + y0, z - thick / 2, b - a, y1 - y0, thick));
  else batch.add(m, boxAt(x - thick / 2, base + y0, z + a, thick, y1 - y0, b - a));
}
// A door leaf: like wallPiece, but its texture is stretched over the whole leaf (so
// a painted door picture fits each door) instead of tiling in world space.
function leafPiece(batch, m, e, ox, oz, base, a, b, y0, y1, thick) {
  if (b - a <= 0.001 || y1 - y0 <= 0.001) return;
  const x = ox + e.x, z = oz + e.y;
  const geo = e.d === 'h' ? boxAt(x + a, base + y0, z - thick / 2, b - a, y1 - y0, thick) : boxAt(x - thick / 2, base + y0, z + a, thick, y1 - y0, b - a);
  const p = geo.pos, n = geo.nrm, uv = geo.uv;
  for (let i = 0; i < geo.count; i++) {
    if (Math.abs(n[i * 3 + 1]) > 0.5) continue;
    const along = (e.d === 'h' ? p[i * 3] - x : p[i * 3 + 2] - z);
    uv[i * 2] = (along - a) / (b - a);
    uv[i * 2 + 1] = (p[i * 3 + 1] - base - y0) / (y1 - y0);
  }
  batch.add(m, geo);
}

// The same with a different material on each face: m0 on the north/west side, m1 on
// the south/east side (each half the wall's thickness).
function wallPiece2(batch, m0, m1, e, ox, oz, base, a, b, y0, y1) {
  if (m0 === m1) return wallPiece(batch, m0, e, ox, oz, base, a, b, y0, y1);
  if (b - a <= 0.001 || y1 - y0 <= 0.001) return;
  const x = ox + e.x, z = oz + e.y, t = THICK / 2;
  if (e.d === 'h') {
    batch.add(m0, boxAt(x + a, base + y0, z - t, b - a, y1 - y0, t));
    batch.add(m1, boxAt(x + a, base + y0, z, b - a, y1 - y0, t));
  } else {
    batch.add(m0, boxAt(x - t, base + y0, z + a, t, y1 - y0, b - a));
    batch.add(m1, boxAt(x, base + y0, z + a, t, y1 - y0, b - a));
  }
}

// Which walls get lowered in cutaway: a wall drops when the room behind it (on the
// side away from the camera) has a floor, so you can see inside — just like The Sims.
function lowered(plot, e, level, cut) {
  if (cut.mode === 'down') return true;
  if (cut.mode !== 'cut') return false;
  const view = levelView(plot, level);
  const far = e.d === 'h' ? (cut.fz < 0 ? [e.x, e.y - 1] : [e.x, e.y]) : (cut.fx < 0 ? [e.x - 1, e.y] : [e.x, e.y]);
  if (view.floor[`${far[0]},${far[1]}`]) return true;
  // Upstairs, the stairwell counts as part of the room (there's no floor, just the hole).
  if (level > 0) { const hit = objAt(plot, far[0], far[1]); if (hit && ITEMS[hit.obj.t]?.stairs) return true; }
  return false;
}

// Plots have no fences. Land for sale gets little survey stakes at its corners.
function stakes(batch, plot) {
  const wood = mat('stake', () => lambert({ map: woodTex() }));
  const flag = mat('stakeflag', () => lambert({ color: '#f39c12' }));
  const { x, y, w, h } = plot;
  for (const [px, pz] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
    batch.add(wood, boxAt(px - 0.05, 0, pz - 0.05, 0.1, 0.55, 0.1));
    batch.add(flag, boxAt(px + 0.05, 0.38, pz - 0.02, 0.22, 0.14, 0.04));
  }
}

// opts: { cut: { mode: 'up'|'cut'|'down', fx, fz }, maxLevel, roofs: bool, cards: BillboardSet, now,
//         entrance: { x, z } (tiles) where the plot meets the road }
// Returns { group, lights: [{ x, y, z, kind }] }.
export function buildPlot(plot, opts) {
  const group = node('plot');
  const lights = [];
  const ox = plot.x, oz = plot.y;
  const batch = new Batch();
  const maxLevel = opts.maxLevel ?? LEVELS - 1;
  if (!plot.owner) stakes(batch, plot);

  // Floors
  for (let l = 0; l <= maxLevel; l++) {
    const view = levelView(plot, l);
    const y = l * LEVEL_H;
    const byType = new Map();
    for (let [k, t] of Object.entries(view.floor)) {
      if ((t === 'soil' || t === 'soil_rich') && !l && isWet(view.obj[k] || {}, opts.now)) t = `${t}_wet`;
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t).push(k.split(',').map(Number));
    }
    for (const [t, tiles] of byType) {
      const pos = [], uv = [], idx = [];
      tiles.forEach(([lx, ly], i) => {
        const x = ox + lx, z = oz + ly, u = (lx % 4) / 4, v = 1 - (ly % 4) / 4;
        pos.push(x, y + 0.02, z, x + 1, y + 0.02, z, x + 1, y + 0.02, z + 1, x, y + 0.02, z + 1);
        uv.push(u, v, u + 0.25, v, u + 0.25, v - 0.25, u, v - 0.25);
        idx.push(i * 4, i * 4 + 2, i * 4 + 1, i * 4, i * 4 + 3, i * 4 + 2);
      });
      const nrm = new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0));
      toMesh(new Geo(pos, nrm, uv, idx), floorMat(t), { parent: group });
      // Upstairs floors are slabs with a ceiling underneath.
      if (l > 0) for (const [lx, ly] of tiles) batch.add(ceilMat(), boxAt(ox + lx, y - 0.14, oz + ly, 1, 0.15, 1));
    }
  }

  // Walls
  const corners = new Map();
  for (const [k, w] of Object.entries(plot.walls || {})) {
    const e = parseEdge(k);
    if (e.l > maxLevel || !ITEMS[w.m]) continue;
    const base = e.l * LEVEL_H;
    const low = lowered(plot, e, e.l, opts.cut);
    const H = low ? LOW_H : WALL_H;
    const m0 = wallMat(w.m), m1 = wallMat(w.o || w.m);
    const piece = (a, b, y0, y1) => wallPiece2(batch, m0, m1, e, ox, oz, base, a, b, y0, y1);
    const f = w.f, fc = w.fc || 0;
    // Neighbouring segments along the same wall line (for joined shopfronts).
    const along = (n) => plot.walls[e.d === 'h' ? edgeKey(e.l, e.d, e.x + n, e.y) : edgeKey(e.l, e.d, e.x, e.y + n)];
    const joinPrev = SHOPFRONT.has(f) && SHOPFRONT.has(along(-1)?.f), joinNext = SHOPFRONT.has(f) && SHOPFRONT.has(along(1)?.f);
    if (low && f && ITEMS[f]?.passable) {
      // Cut-away wall with a doorway: keep the gap, so you can see where the door is.
      const pair = featureWidth2(f) ? featurePair(plot, e.l, e.d, e.x, e.y) : null;
      const a = pair ? (pair.part ? 0 : 0.1) : SHOPFRONT.has(f) && joinPrev ? 0 : 0.14;
      const b = pair ? (pair.part ? 0.9 : 1) : SHOPFRONT.has(f) && joinNext ? 1 : 0.86;
      piece(0, a, 0, H); piece(b, 1, 0, H);
      wallPiece(batch, frameMat(fc), e, ox, oz, base, a, b, 0, 0.03, THICK + 0.04); // threshold
    } else if (!f || low) {
      piece(0, 1, 0, H);
    } else if (f === 'window' || f === 'window_tall') {
      const [s, t] = f === 'window' ? [0.9, 1.85] : [0.45, 2.1];
      piece(0, 0.2, 0, H); piece(0.8, 1, 0, H); piece(0.2, 0.8, 0, s); piece(0.2, 0.8, t, H);
      const fr = frameMat(fc);
      wallPiece(batch, fr, e, ox, oz, base, 0.16, 0.84, s - 0.05, s, THICK + 0.1); // sill
      wallPiece(batch, fr, e, ox, oz, base, 0.17, 0.83, t, t + 0.04, THICK + 0.05); // head
      wallPiece(batch, fr, e, ox, oz, base, 0.17, 0.2, s, t, THICK + 0.05); wallPiece(batch, fr, e, ox, oz, base, 0.8, 0.83, s, t, THICK + 0.05);
      wallPiece(batch, glassMat(), e, ox, oz, base, 0.2, 0.8, s, t, 0.03);
      wallPiece(batch, fr, e, ox, oz, base, 0.48, 0.52, s, t, 0.05);
      wallPiece(batch, fr, e, ox, oz, base, 0.2, 0.8, (s + t) / 2 - 0.02, (s + t) / 2 + 0.02, 0.05);
    } else if (f === 'window_shop') {
      // Floor-to-ceiling storefront glass on a low kick panel; joins its neighbours.
      const a = joinPrev ? 0 : 0.08, b = joinNext ? 1 : 0.92;
      if (!joinPrev) piece(0, a, 0, H);
      if (!joinNext) piece(b, 1, 0, H);
      piece(a, b, 0, 0.3); piece(a, b, 2.3, H);
      const fr = fc ? frameMat(fc) : alumMat();
      wallPiece(batch, fr, e, ox, oz, base, a, b, 0.3, 0.35, THICK + 0.06);
      wallPiece(batch, fr, e, ox, oz, base, a, b, 2.25, 2.3, THICK + 0.06);
      wallPiece(batch, fr, e, ox, oz, base, joinPrev ? 0 : a, (joinPrev ? 0 : a) + 0.035, 0.3, 2.3, THICK + 0.04);
      wallPiece(batch, glassMat(), e, ox, oz, base, a, b, 0.35, 2.25, 0.03);
      wallPiece(batch, fr, e, ox, oz, base, a, b, 1.95, 1.98, 0.05); // transom bar
    } else if (f === 'door_shop' || f === 'door_shopdouble') {
      // Glass shop doors in a slim metal frame, with a transom light above.
      const pair = f === 'door_shopdouble' ? featurePair(plot, e.l, e.d, e.x, e.y) : null;
      const a = pair ? (pair.part ? 0 : (joinPrev ? 0 : 0.08)) : (joinPrev ? 0 : 0.1);
      const b = pair ? (pair.part ? (joinNext ? 1 : 0.92) : 1) : (joinNext ? 1 : 0.9);
      if (a > 0) piece(0, a, 0, H);
      if (b < 1) piece(b, 1, 0, H);
      piece(a, b, 2.3, H);
      const fr = fc ? frameMat(fc) : alumMat();
      wallPiece(batch, fr, e, ox, oz, base, a, b, 2.25, 2.3, THICK + 0.06);
      wallPiece(batch, glassMat(), e, ox, oz, base, a, b, 2.03, 2.25, 0.03);
      wallPiece(batch, fr, e, ox, oz, base, a, b, 1.98, 2.03, 0.06);
      const la = a + 0.02, lb = b - 0.02;
      wallPiece(batch, fr, e, ox, oz, base, la, lb, 0, 0.12, 0.06);           // bottom rail
      wallPiece(batch, fr, e, ox, oz, base, la, la + 0.05, 0, 1.98, 0.06);    // stiles
      wallPiece(batch, fr, e, ox, oz, base, lb - 0.05, lb, 0, 1.98, 0.06);
      wallPiece(batch, glassMat(), e, ox, oz, base, la + 0.05, lb - 0.05, 0.12, 1.98, 0.03);
      const bar = pair ? (pair.part ? [la + 0.07, la + 0.3] : [lb - 0.3, lb - 0.07]) : [la + 0.1, lb - 0.1];
      wallPiece(batch, knobMat(), e, ox, oz, base, bar[0], bar[1], 1.0, 1.04, 0.14);   // push bar
    } else if (f === 'door_double') {
      // French double doors: panelled leaves with glass, meeting in the middle of the pair.
      const pair = featurePair(plot, e.l, e.d, e.x, e.y);
      const a = pair.part ? 0 : 0.1, b = pair.part ? 0.9 : 1;
      piece(pair.part ? b : 0, pair.part ? 1 : a, 0, H);
      piece(a, b, 2.2, H);
      const fr = frameMat(fc);
      wallPiece(batch, fr, e, ox, oz, base, a, b, 2.15, 2.21, THICK + 0.04);
      if (pair.part) wallPiece(batch, fr, e, ox, oz, base, b - 0.02, b + 0.02, 0, 2.2, THICK + 0.04);
      else wallPiece(batch, fr, e, ox, oz, base, a - 0.02, a + 0.02, 0, 2.2, THICK + 0.04);
      const dm = panelDoorMat(fc, 'french');
      leafPiece(batch, dm, e, ox, oz, base, a + 0.01, b - 0.01, 0, 2.15, 0.06);
      wallPiece(batch, glassMat(), e, ox, oz, base, a + 0.1, b - 0.1, 0.95, 1.95, 0.08);
      const kx = pair.part ? a + 0.06 : b - 0.1;
      wallPiece(batch, knobMat(), e, ox, oz, base, kx, kx + 0.04, 1.0, 1.1, 0.12);
    } else {
      // Doors and archways: piers either side and a lintel over a 2.05-high opening.
      piece(0, 0.14, 0, H); piece(0.86, 1, 0, H); piece(0.14, 0.86, 2.05, H);
      const fr = frameMat(fc);
      wallPiece(batch, fr, e, ox, oz, base, 0.12, 0.88, 2.0, 2.06, THICK + 0.04);
      wallPiece(batch, fr, e, ox, oz, base, 0.11, 0.15, 0, 2.06, THICK + 0.04);
      wallPiece(batch, fr, e, ox, oz, base, 0.85, 0.89, 0, 2.06, THICK + 0.04);
      if (f === 'door') {
        leafPiece(batch, panelDoorMat(fc, 'panel'), e, ox, oz, base, 0.15, 0.85, 0, 2.0, 0.06);
        wallPiece(batch, knobMat(), e, ox, oz, base, 0.74, 0.79, 0.95, 1.02, 0.12);
      } else if (f === 'door_glass') {
        leafPiece(batch, panelDoorMat(fc, 'french'), e, ox, oz, base, 0.15, 0.85, 0, 2.0, 0.06);
        wallPiece(batch, glassMat(), e, ox, oz, base, 0.24, 0.76, 0.95, 1.9, 0.08);
        wallPiece(batch, knobMat(), e, ox, oz, base, 0.74, 0.79, 0.95, 1.02, 0.12);
      }
    }
    // Dark trim along the top so walls read clearly from above.
    wallPiece(batch, trimMat(), e, ox, oz, base, 0, 1, H - 0.05, H + 0.01, THICK + 0.02);
    // Remember corner posts.
    const ends = e.d === 'h' ? [[e.x, e.y], [e.x + 1, e.y]] : [[e.x, e.y], [e.x, e.y + 1]];
    for (const [cx, cz] of ends) {
      const ck = `${e.l}|${cx}|${cz}`;
      const prev = corners.get(ck);
      corners.set(ck, { l: e.l, x: cx, z: cz, m: prev?.m || w.m, h: Math.max(prev?.h || 0, H) });
    }
  }
  for (const c of corners.values()) {
    const p = THICK + 0.04;
    batch.add(wallMat(c.m), boxAt(ox + c.x - p / 2, c.l * LEVEL_H, oz + c.z - p / 2, p, c.h + 0.01, p));
    batch.add(trimMat(), boxAt(ox + c.x - p / 2 - 0.01, c.l * LEVEL_H + c.h - 0.05, oz + c.z - p / 2 - 0.01, p + 0.02, 0.07, p + 0.02));
  }

  // Roofs
  if (opts.roofs) {
    for (const rf of plot.roofs || []) {
      if (rf.l > maxLevel) continue;
      const y = rf.l * LEVEL_H + WALL_H;
      gableRoof(batch, ox + rf.x, oz + rf.y, ox + rf.x + rf.w, oz + rf.y + rf.h, y, roofMat(rf.m), wallMat('wall_white'), trimMat());
    }
  }
  // A balustrade upstairs around each stairwell (open sides only, not the top exit).
  if (maxLevel >= 1) {
    const up = levelView(plot, 1);
    for (const [k, o] of Object.entries(plot.obj)) {
      if (!ITEMS[o.t]?.stairs) continue;
      const [sx, sy] = k.split(',').map(Number);
      const r = o.r || 0;
      const [w, h] = footprint(o.t, r);
      // The stairs climb away from their front: front south (r 0) -> exit at the north end.
      const exit = [['h', sx, sy], ['v', sx + w, sy], ['h', sx, sy + h], ['v', sx, sy]][r];
      const edges = [];
      for (let i = 0; i < w; i++) edges.push(['h', sx + i, sy, [sx + i, sy - 1]], ['h', sx + i, sy + h, [sx + i, sy + h]]);
      for (let j = 0; j < h; j++) edges.push(['v', sx, sy + j, [sx - 1, sy + j]], ['v', sx + w, sy + j, [sx + w, sy + j]]);
      for (const [d, x, y2, [nx, ny]] of edges) {
        if (d === exit[0] && x === exit[1] && y2 === exit[2]) continue;
        if (plot.walls?.[edgeKey(1, d, x, y2)] || !up.floor[`${nx},${ny}`]) continue;
        const e = { d, x, y: y2 }, base = LEVEL_H;
        wallPiece(batch, railMat(), e, ox, oz, base, 0, 1, 0.86, 0.94, 0.1);             // handrail
        wallPiece(batch, railMat(), e, ox, oz, base, 0, 1, 0, 0.06, 0.1);                // bottom rail
        for (let t = 0.1; t < 1; t += 0.2) wallPiece(batch, railMat(), e, ox, oz, base, t - 0.025, t + 0.025, 0.06, 0.86, 0.05); // balusters
      }
    }
  }
  batch.build(group);

  // Furniture, plants and crops (all the furniture of a plot is one mesh, plus one for glowing parts)
  const cards = opts.cards;
  const furn = new Batch();
  for (let l = 0; l <= maxLevel; l++) {
    const view = levelView(plot, l);
    const y = l * LEVEL_H;
    for (const [k, o] of Object.entries(view.obj)) {
      const d = ITEMS[o.t];
      if (!d) continue;
      const [lx, ly] = k.split(',').map(Number);
      const rot = o.r || 0;
      const [w, h] = footprint(o.t, rot);
      if (hasModel(o.t)) {
        itemInto(furn, o.t, rot, ox + lx, y, oz + ly, o.c || 0);
      } else if (cards && d.crop) {
        cards.add(cropSprite(d.crop, cropStage(o, opts.now)), 8, 13, ox + lx + 0.5, y, oz + ly + 0.6);
      } else if (cards && BILLBOARD.has(o.t)) {
        cards.add(objectSprite(o.t, 0, opts.now), 8, 14, ox + lx + w / 2, y, oz + ly + h - 0.35, { shadow: 0.5 });
      }
      if (o.t === 'lamp') lights.push({ x: ox + lx + 0.5, y: y + 1.3, z: oz + ly + 0.5, kind: 'lamp' });
      else if (o.t === 'lamppost') lights.push({ x: ox + lx + 0.5, y: y + 2.2, z: oz + ly + 0.5, kind: 'post' });
      else if (o.t === 'fireplace') lights.push({ x: ox + lx + w / 2, y: y + 0.4, z: oz + ly + h / 2 + 0.6, kind: 'fire' });
      else if (o.t === 'jackolantern') lights.push({ x: ox + lx + 0.5, y: y + 0.5, z: oz + ly + 0.8, kind: 'pumpkin' });
      else if (o.t === 'candles') lights.push({ x: ox + lx + 0.5, y: y + 0.4, z: oz + ly + 0.5, kind: 'pumpkin' }); // small warm glow
      else if (o.t === 'cauldron') lights.push({ x: ox + lx + 0.5, y: y + 0.9, z: oz + ly + 0.5, kind: 'cauldron' });
      else if (EXTRA_LIGHTS[o.t]) {
        // Offset from the NW corner of the unrotated footprint, turned with the item.
        const [px, py, pz, kind] = EXTRA_LIGHTS[o.t];
        const [w0, h0] = footprint(o.t, 0);
        const [ux, uz] = [px - w0 / 2, pz - h0 / 2];
        const a = (-rot * Math.PI) / 2, c = Math.cos(a), sn = Math.sin(a);
        lights.push({ x: ox + lx + w / 2 + c * ux + sn * uz, y: y + py, z: oz + ly + h / 2 - sn * ux + c * uz, kind });
      }
    }
  }

  furn.build(group, { noCast: materials().glowMat });

  // "For sale" sign where the plot meets the road
  if (!plot.owner) {
    const e = opts.entrance || { x: ox + plot.w / 2, z: oz + plot.h };
    const sx = Math.min(Math.max(e.x - 1.5, ox), ox + plot.w - 1), sz = Math.min(Math.max(e.z - 0.8, oz + 0.2), oz + plot.h - 0.3);
    const s = new Batch();
    s.add(doorMat(), boxAt(sx + 0.45, 0, sz, 0.1, 0.9, 0.1));
    const sale = mat('forsale', () => lambert({ map: signTex('FOR SALE', 48, 20) }));
    // The board: the sign on its front face, plain wood elsewhere.
    s.add(doorMat(), box(1.0, 0.45, 0.06, ['px', 'nx', 'py', 'ny', 'nz']).translate(sx + 0.5, 0.95, sz + 0.1));
    s.add(sale, box(1.0, 0.45, 0.06, ['pz']).translate(sx + 0.5, 0.95, sz + 0.1));
    s.build(group);
  }
  return { group, lights };
}

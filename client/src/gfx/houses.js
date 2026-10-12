// Builds a plot's house in 3D from its Sims-style data (see shared/plot.js):
// floors on two levels, wall segments on tile edges with real door/window openings,
// Sims cutaway, gable roofs, furniture models and pixel-art cards for plants/crops.
import * as THREE from 'three';
import { ITEMS, cropStage } from '@shared/catalog.js';
import { parseEdge, levelView, footprint, LEVELS, LEVEL_H } from '@shared/plot.js';
import { wallTex, floorTex, roofTex, woodTex, signTex, WALL_H } from './textures.js';
import { Batch, boxAt, gableRoof } from './geom.js';
import { makeItem, hasModel, BILLBOARD } from './models.js';
import { objectSprite, cropSprite } from '../sprites.js';

export { LEVEL_H }; // floor-to-floor height (shared with the game rules)
export const LOW_H = 0.4; // cut-away wall height
const THICK = 0.12;

const mats = new Map();
const mat = (key, make) => { if (!mats.has(key)) mats.set(key, make()); return mats.get(key); };
const lambert = (o) => new THREE.MeshLambertMaterial(o);
const wallMat = (m) => mat(`wall|${m}`, () => lambert({ map: wallTex(m) }));
const trimMat = () => mat('trim', () => lambert({ color: '#4a2e18' }));
const doorMat = () => mat('door', () => lambert({ map: woodTex() }));
export const glassMat = () => mat('glass', () => lambert({ color: '#8fd0f0', emissive: '#000000', transparent: true, opacity: 0.55 }));
const knobMat = () => mat('knob', () => lambert({ color: '#f5c542' }));
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

// Which walls get lowered in cutaway: a wall drops when the room behind it (on the
// side away from the camera) has a floor, so you can see inside — just like The Sims.
function lowered(plot, e, level, cut) {
  if (cut.mode === 'down') return true;
  if (cut.mode !== 'cut') return false;
  const view = levelView(plot, level);
  const far = e.d === 'h' ? (cut.fz < 0 ? [e.x, e.y - 1] : [e.x, e.y]) : (cut.fx < 0 ? [e.x - 1, e.y] : [e.x, e.y]);
  return !!view.floor[`${far[0]},${far[1]}`];
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
  const group = new THREE.Group();
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
    for (const [k, t] of Object.entries(view.floor)) {
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
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
      g.setIndex(idx);
      const mesh = new THREE.Mesh(g, floorMat(t));
      mesh.receiveShadow = true;
      group.add(mesh);
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
    const m = wallMat(w.m);
    const f = w.f;
    if (!f || low) {
      wallPiece(batch, m, e, ox, oz, base, 0, 1, 0, H);
    } else if (f === 'window' || f === 'window_tall') {
      const [s, t] = f === 'window' ? [0.9, 1.85] : [0.45, 2.1];
      wallPiece(batch, m, e, ox, oz, base, 0, 0.2, 0, H);
      wallPiece(batch, m, e, ox, oz, base, 0.8, 1, 0, H);
      wallPiece(batch, m, e, ox, oz, base, 0.2, 0.8, 0, s);
      wallPiece(batch, m, e, ox, oz, base, 0.2, 0.8, t, H);
      wallPiece(batch, trimMat(), e, ox, oz, base, 0.16, 0.84, s - 0.05, s, THICK + 0.1); // sill
      wallPiece(batch, glassMat(), e, ox, oz, base, 0.2, 0.8, s, t, 0.03);
      wallPiece(batch, trimMat(), e, ox, oz, base, 0.48, 0.52, s, t, 0.05);
      wallPiece(batch, trimMat(), e, ox, oz, base, 0.2, 0.8, (s + t) / 2 - 0.02, (s + t) / 2 + 0.02, 0.05);
    } else {
      // Doors and archways: piers either side and a lintel over a 2.05-high opening.
      wallPiece(batch, m, e, ox, oz, base, 0, 0.14, 0, H);
      wallPiece(batch, m, e, ox, oz, base, 0.86, 1, 0, H);
      wallPiece(batch, m, e, ox, oz, base, 0.14, 0.86, 2.05, H);
      wallPiece(batch, trimMat(), e, ox, oz, base, 0.12, 0.88, 2.0, 2.06, THICK + 0.04);
      if (f === 'door') {
        wallPiece(batch, doorMat(), e, ox, oz, base, 0.14, 0.86, 0, 2.0, 0.05);
        wallPiece(batch, knobMat(), e, ox, oz, base, 0.74, 0.79, 0.95, 1.02, 0.1);
      } else if (f === 'door_glass') {
        wallPiece(batch, doorMat(), e, ox, oz, base, 0.14, 0.86, 0, 0.7, 0.05);
        wallPiece(batch, doorMat(), e, ox, oz, base, 0.14, 0.86, 1.9, 2.0, 0.05);
        wallPiece(batch, glassMat(), e, ox, oz, base, 0.16, 0.84, 0.7, 1.9, 0.03);
        wallPiece(batch, doorMat(), e, ox, oz, base, 0.48, 0.52, 0, 2.0, 0.06);
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
  batch.build(group);

  // Furniture, plants and crops
  const cards = opts.cards;
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
        group.add(makeItem(o.t, rot, ox + lx, y, oz + ly));
      } else if (cards && d.crop) {
        cards.add(cropSprite(d.crop, cropStage(o, opts.now)), 8, 13, ox + lx + 0.5, y, oz + ly + 0.6);
      } else if (cards && BILLBOARD.has(o.t)) {
        cards.add(objectSprite(o.t, 0, opts.now), 8, 14, ox + lx + w / 2, y, oz + ly + h - 0.35, { shadow: 0.5 });
      }
      if (o.t === 'lamp') lights.push({ x: ox + lx + 0.5, y: y + 1.3, z: oz + ly + 0.5, kind: 'lamp' });
      else if (o.t === 'lamppost') lights.push({ x: ox + lx + 0.5, y: y + 2.2, z: oz + ly + 0.5, kind: 'post' });
      else if (o.t === 'fireplace') lights.push({ x: ox + lx + w / 2, y: y + 0.4, z: oz + ly + h / 2 + 0.6, kind: 'fire' });
      else if (o.t === 'jackolantern') lights.push({ x: ox + lx + 0.5, y: y + 0.5, z: oz + ly + 0.8, kind: 'pumpkin' });
      else if (o.t === 'cauldron') lights.push({ x: ox + lx + 0.5, y: y + 0.9, z: oz + ly + 0.5, kind: 'cauldron' });
    }
  }

  // "For sale" sign where the plot meets the road
  if (!plot.owner) {
    const e = opts.entrance || { x: ox + plot.w / 2, z: oz + plot.h };
    const sx = Math.min(Math.max(e.x - 1.5, ox), ox + plot.w - 1), sz = Math.min(Math.max(e.z - 0.8, oz + 0.2), oz + plot.h - 0.3);
    const s = new Batch();
    s.add(doorMat(), boxAt(sx + 0.45, 0, sz, 0.1, 0.9, 0.1));
    s.build(group);
    const sale = mat('forsale', () => lambert({ map: signTex('FOR SALE', 48, 20) }));
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.45, 0.06), [doorMat(), doorMat(), doorMat(), doorMat(), sale, doorMat()]);
    board.position.set(sx + 0.5, 0.95, sz + 0.1);
    board.castShadow = true;
    group.add(board);
  }
  return { group, lights };
}

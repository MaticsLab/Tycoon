// Translucent previews for the build tools (green = OK, red = can't place).
// Draw order (three.js renderOrder before): see-through previews sort by alphaIndex,
// so the plot outline (4) draws first, then preview walls/floors (5, floors 5.4), then
// furniture (7) last — a transparent floor preview never washes out the furniture on it.
import { footprint, canRotate, parseEdge } from '@shared/plot.js';
import { ITEMS } from '@shared/catalog.js';
import { boxAt } from './geom.js';
import { makeItem, hasModel } from './models.js';
import { WALL_H, wallTex, floorTex, roofTex } from './textures.js';
import { objectSprite } from '../sprites.js';
import { texOf } from './billboards.js';
import { LEVEL_H } from './houses.js';
import { Geo, merge, toMesh, node, basic, lambert, TyMaterial, spriteGeo, linear } from './bjs.js';

const mk = (color, opacity = 0.45) => basic({ color, transparent: true, opacity, depthWrite: false });
let M = null;
function mats() {
  if (M) return M;
  M = {
    OK: mk('#7dff8a'), BAD: mk('#ff5a5a'), TILE_OK: mk('#a6ffb0'), TILE_BAD: mk('#ff8a8a'),
    FOOT_OK: basic({ color: '#4dff6a', transparent: true, opacity: 0.95, depthWrite: false, doubleSided: true }),
    FOOT_BAD: basic({ color: '#ff4a4a', transparent: true, opacity: 0.95, depthWrite: false, doubleSided: true }),
    FILL_OK: mk('#7dff8a', 0.18), FILL_BAD: mk('#ff5a5a', 0.25),
    WIRE: basic({ color: '#ffffff', transparent: true, opacity: 0.95, depthTest: false, lines: true }),
    ROOM_FILL: mk('#ffffff', 0.12),
  };
  return M;
}

// See-through copies of real materials for previews: true colours when it fits,
// tinted red when it doesn't.
const previewCache = new Map();
function preview(mat, ok) {
  const k = `${mat.uniqueId}|${ok}`;
  let m = previewCache.get(k);
  if (!m) {
    const lit = mat.o.kind === 'lit';
    m = mat.cloneWith({
      transparent: true, opacity: ok ? 0.82 : 0.6, depthWrite: false, receive: false,
      // A soft glow keeps previews readable at night.
      ...(ok ? {} : { color: linear('#ff7070') }),
      ...(lit ? { emissive: linear(ok ? '#4a4a40' : '#5a0000') } : {}),
    });
    previewCache.set(k, m);
  }
  return m;
}
const texPreview = (key, tex, ok) => {
  const k = `tex|${key}`;
  let base = previewCache.get(k);
  if (!base) { base = lambert({ map: tex }); previewCache.set(k, base); }
  return preview(base, ok);
};

export class Ghost {
  constructor() {
    this.group = node('ghost');
  }

  add(geo, mat, order = 5) { return toMesh(geo, mat, { parent: this.group, alphaIndex: order }); }

  clear() {
    for (const c of this.group.getChildren()) c.dispose(false, false);
  }

  // edges: [[d, x, y]] in plot-local coordinates
  // m: a wall material id to preview in its real texture (else a plain highlight).
  walls(edges, def, level, ok, low = false, m = null) {
    const y = level * LEVEL_H, h = low ? 0.4 : WALL_H;
    const mat = m ? texPreview(`wall|${m}`, wallTex(m), ok) : ok ? mats().OK : mats().BAD;
    for (const [d, x, z] of edges) {
      const g = d === 'h' ? boxAt(def.x + x, y, def.y + z - 0.07, 1, h, 0.14) : boxAt(def.x + x - 0.07, y, def.y + z, 0.14, h, 1);
      this.add(g, mat);
    }
  }

  // Floor (or roof) tiles in their real texture.
  texturedTiles(tiles, def, level, ok, kind, id, height = 0.04) {
    const y = level * LEVEL_H;
    const mat = kind === 'roof' ? texPreview(`roof|${id}`, roofTex(id), ok) : texPreview(`floor|${id}`, floorTex(id), ok);
    for (const [x, z] of tiles) this.add(boxAt(def.x + x, y + 0.01, def.y + z, 1, height, 1), mat, 5.4);
  }

  tiles(tiles, def, level, ok, height = 0.04) {
    const y = level * LEVEL_H;
    for (const [x, z] of tiles) this.add(boxAt(def.x + x + 0.04, y + 0.02, def.y + z + 0.04, 0.92, height, 0.92), ok ? mats().TILE_OK : mats().TILE_BAD);
  }

  // The item itself, in its real colours (red-tinted if it can't go there), over its footprint.
  item(t, r, def, lx, ly, level, ok, c = 0, footprintMarks = true) {
    const [w, h] = footprint(t, r);
    const y = level * LEVEL_H;
    if (footprintMarks) this.footprint(def.x + lx, def.y + ly, w, h, y, ok, canRotate(t) ? r : null);
    if (hasModel(t)) {
      const g = makeItem(t, r, def.x + lx, y, def.y + ly, c, { cast: false, parent: this.group });
      // Furniture draws after the see-through floor and walls so it isn't washed out.
      for (const m of g.getChildMeshes(true)) { m.material = preview(m.material, ok); m.alphaIndex = 7; }
    } else {
      // Pixel-art plants and crops: a card anchored at its base, like in the house view.
      const spr = objectSprite(t, 0, 0);
      let base = previewCache.get(`spr|${t}`);
      if (!base) { base = new TyMaterial({ kind: 'sprite', map: texOf(spr.cv), alphaTest: 0.3 }); previewCache.set(`spr|${t}`, base); }
      const geo = spriteGeo(spr.cv.width / 16, spr.cv.height / 16, (8 - spr.dx) / spr.cv.width, 1 - (14 - spr.dy) / spr.cv.height);
      const sp = this.add(geo, preview(base, ok));
      sp.position.set(def.x + lx + w / 2, y, def.y + ly + h - 0.35);
      sp.alwaysSelectAsActiveMesh = true;
    }
  }

  // Sims-style footprint: a glowing outline with tile lines, and an arrow showing
  // which way the item will face (r: 0 south, 1 west, 2 north, 3 east).
  footprint(x, z, w, h, y, ok, r) {
    const line = ok ? mats().FOOT_OK : mats().FOOT_BAD, t = 0.07;
    const add = (g) => this.add(g, line);
    add(boxAt(x, y + 0.02, z, w, 0.02, t)); add(boxAt(x, y + 0.02, z + h - t, w, 0.02, t));
    add(boxAt(x, y + 0.02, z, t, 0.02, h)); add(boxAt(x + w - t, y + 0.02, z, t, 0.02, h));
    for (let i = 1; i < w; i++) add(boxAt(x + i - 0.02, y + 0.02, z, 0.04, 0.02, h));
    for (let j = 1; j < h; j++) add(boxAt(x, y + 0.02, z + j - 0.02, w, 0.02, 0.04));
    this.add(boxAt(x, y + 0.01, z, w, 0.01, h), ok ? mats().FILL_OK : mats().FILL_BAD);
    if (r == null) return;
    const [dx, dz] = [[0, 1], [-1, 0], [0, -1], [1, 0]][r];
    const cx = x + w / 2 + dx * (w / 2 + 0.3), cz = z + h / 2 + dz * (h / 2 + 0.3);
    const g = new Geo([0, 0.28, 0, -0.26, -0.12, 0, 0.26, -0.12, 0], [0, 0, 1, 0, 0, 1, 0, 0, 1], [], [1, 2, 0]);
    g.rotateX(-Math.PI / 2);
    g.rotateY(Math.atan2(-dx, -dz));
    g.translate(cx, y + 0.04, cz);
    add(g);
  }

  // White wireframe box around a room (Sims room selection), drawn on top of everything.
  box(x, z, w, h, y, height = 2.6) {
    this.add(edgesBox(x, y, z, w, height, h), mats().WIRE);
    this.add(boxAt(x, y + 0.01, z, w, 0.01, h), mats().ROOM_FILL);
  }

  // A whole blueprint (room or house) at plot-local (ox, oy), in its real materials.
  fragment(frag, def, ox, oy, ok) {
    frag.levels.forEach((v, l) => {
      const byType = new Map();
      for (const [k, f] of Object.entries(v.floor)) { const [x, y] = k.split(',').map(Number); if (!byType.has(f)) byType.set(f, []); byType.get(f).push([ox + x, oy + y]); }
      for (const [f, tiles] of byType) this.texturedTiles(tiles, def, l, ok, 'floor', f, 0.03);
      for (const [k, o] of Object.entries(v.obj)) {
        if (!ITEMS[o.t]) continue;
        const [x, y] = k.split(',').map(Number);
        this.item(o.t, o.r || 0, def, ox + x, oy + y, l, ok, o.c || 0, false);
      }
    });
    const byMat = new Map();
    for (const [k, w] of Object.entries(frag.walls)) {
      const e = parseEdge(k);
      const mk = `${e.l}|${w.m}`;
      if (!byMat.has(mk)) byMat.set(mk, []);
      byMat.get(mk).push([e.d, ox + e.x, oy + e.y]);
    }
    for (const [mk, edges] of byMat) { const [l, m] = mk.split('|'); this.walls(edges, def, +l, ok, true, m); } // cut-away walls show what's inside
    this.box(def.x + ox, def.y + oy, frag.w, frag.h, 0, Math.max(2.6, frag.levels[1] && Object.keys(frag.levels[1].floor).length ? 5.3 : 2.6));
  }

  // A rectangle of land in world tiles (the land tools' preview).
  rect(x, y, w, h, ok) {
    this.add(boxAt(x, 0.03, y, w, 0.04, h), ok ? mats().TILE_OK : mats().TILE_BAD);
    for (const [bx, bz, bw, bd] of [[x, y - 0.06, w, 0.12], [x, y + h - 0.06, w, 0.12], [x - 0.06, y, 0.12, h], [x + w - 0.06, y, 0.12, h]]) {
      this.add(boxAt(bx, 0, bz, bw, 1.1, bd), ok ? mats().OK : mats().BAD);
    }
  }

  // A north-south cut line at world column x (the split tool).
  cut(x, y, h) {
    this.add(boxAt(x - 0.08, 0, y, 0.16, 1.4, h), mats().BAD);
  }

  // Outline box marking one tile (used by the sledgehammer).
  marker(def, lx, ly, level, height = 0.6) {
    this.add(boxAt(def.x + lx + 0.02, level * LEVEL_H, def.y + ly + 0.02, 0.96, height, 0.96), mats().BAD);
  }
}

// The 12 edges of an axis-aligned box as line segments.
function edgesBox(x, y, z, w, h, d) {
  const pos = [];
  for (let i = 0; i < 8; i++) pos.push(x + (i & 1 ? w : 0), y + (i & 2 ? h : 0), z + (i & 4 ? d : 0));
  const idx = [0, 1, 2, 3, 4, 5, 6, 7, 0, 2, 1, 3, 4, 6, 5, 7, 0, 4, 1, 5, 2, 6, 3, 7];
  return new Geo(pos, [], [], idx);
}

// Plot boundaries for build mode: a bright outline with corner posts around your plot,
// faint outlines of the plots around it, and the public road tiles you can't build on.
let OM = null;
function omats() {
  return (OM ||= {
    LINE: basic({ color: '#ffe36e', transparent: true, opacity: 0.95, depthWrite: false }),
    POST: basic({ color: '#fff3b0' }),
    OTHER: basic({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false }),
    GRID: basic({ color: '#ffffff', transparent: true, opacity: 0.16, depthWrite: false, lines: true }),
    ROAD: basic({ color: '#ff7a4a', transparent: true, opacity: 0.28, depthWrite: false }),
  });
}

export class Outline {
  constructor() {
    this.group = node('outline');
    this.sig = '';
  }

  clear() {
    for (const c of this.group.getChildren()) c.dispose(false, false);
    this.sig = '';
  }

  // plot: your plot; others: nearby plots; roads: [[x, y]] world tiles of road inside it.
  show(plot, others, roads, level) {
    const sig = JSON.stringify([plot.x, plot.y, plot.w, plot.h, others.map((o) => [o.x, o.y, o.w, o.h]), roads, level]);
    if (sig === this.sig) return;
    this.clear();
    this.sig = sig;
    const { LINE, POST, OTHER, GRID, ROAD } = omats();
    const y = level * LEVEL_H + 0.03;
    // Everything of one material goes into one mesh.
    const parts = new Map();
    const add = (mat, g) => { if (!parts.has(mat)) parts.set(mat, []); parts.get(mat).push(g); };
    const frame = (r, mat, t, h) => {
      for (const [bx, bz, bw, bd] of [[r.x, r.y - t / 2, r.w, t], [r.x, r.y + r.h - t / 2, r.w, t], [r.x - t / 2, r.y, t, r.h], [r.x + r.w - t / 2, r.y, t, r.h]]) {
        add(mat, boxAt(bx, y, bz, bw, h, bd));
      }
    };
    for (const o of others) frame(o, OTHER, 0.06, 0.03);
    frame(plot, LINE, 0.12, 0.05);
    for (const [px, pz] of [[plot.x, plot.y], [plot.x + plot.w, plot.y], [plot.x, plot.y + plot.h], [plot.x + plot.w, plot.y + plot.h]]) {
      add(POST, boxAt(px - 0.07, y, pz - 0.07, 0.14, 0.7, 0.14));
    }
    for (const [tx, tz] of roads) add(ROAD, boxAt(tx + 0.03, y, tz + 0.03, 0.94, 0.02, 0.94));
    for (const [mat, list] of parts) toMesh(merge(list), mat, { parent: this.group, alphaIndex: 4 });
    // A faint tile grid over your land, to line things up by.
    const pts = [];
    for (let i = 1; i < plot.w; i++) pts.push(plot.x + i, y + 0.01, plot.y, plot.x + i, y + 0.01, plot.y + plot.h);
    for (let j = 1; j < plot.h; j++) pts.push(plot.x, y + 0.01, plot.y + j, plot.x + plot.w, y + 0.01, plot.y + j);
    if (pts.length) toMesh(new Geo(pts, [], [], pts.map((_, i) => i).slice(0, pts.length / 3)), GRID, { parent: this.group, alphaIndex: 4 });
  }
}

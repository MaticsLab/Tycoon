// Translucent previews for the build tools (green = OK, red = can't place).
import * as THREE from 'three';
import { footprint } from '@shared/plot.js';
import { boxAt } from './geom.js';
import { makeItem, hasModel } from './models.js';
import { WALL_H, wallTex, floorTex, roofTex } from './textures.js';
import { objectSprite } from '../sprites.js';
import { texOf } from './billboards.js';
import { LEVEL_H } from './houses.js';

const mk = (color) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false });
const OK = mk('#7dff8a'), BAD = mk('#ff5a5a'), TILE_OK = mk('#a6ffb0'), TILE_BAD = mk('#ff8a8a');

// See-through copies of real materials for previews: true colours when it fits,
// tinted red when it doesn't.
const previewCache = new Map();
function preview(mat, ok) {
  const k = `${mat.uuid}|${ok}`;
  let m = previewCache.get(k);
  if (!m) {
    m = mat.clone();
    m.transparent = true; m.opacity = ok ? 0.82 : 0.6; m.depthWrite = false;
    // A soft glow keeps previews readable at night.
    if (!ok) { m.color = new THREE.Color('#ff7070'); if (m.emissive) m.emissive = new THREE.Color('#5a0000'); }
    else if (m.emissive) m.emissive = new THREE.Color('#4a4a40');
    previewCache.set(k, m);
  }
  return m;
}
const texPreview = (key, tex, ok) => {
  const k = `tex|${key}`;
  let base = previewCache.get(k);
  if (!base) { base = new THREE.MeshLambertMaterial({ map: tex }); previewCache.set(k, base); }
  return preview(base, ok);
};

export class Ghost {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.renderOrder = 5;
    scene.add(this.group);
  }

  clear() {
    for (const c of this.group.children) c.traverse((o) => { if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose(); });
    this.group.clear();
  }

  // edges: [[d, x, y]] in plot-local coordinates
  // m: a wall material id to preview in its real texture (else a plain highlight).
  walls(edges, def, level, ok, low = false, m = null) {
    const y = level * LEVEL_H, h = low ? 0.4 : WALL_H;
    const mat = m ? texPreview(`wall|${m}`, wallTex(m), ok) : ok ? OK : BAD;
    for (const [d, x, z] of edges) {
      const g = d === 'h' ? boxAt(def.x + x, y, def.y + z - 0.07, 1, h, 0.14) : boxAt(def.x + x - 0.07, y, def.y + z, 0.14, h, 1);
      this.group.add(new THREE.Mesh(g, mat));
    }
  }

  // Floor (or roof) tiles in their real texture.
  texturedTiles(tiles, def, level, ok, kind, id, height = 0.04) {
    const y = level * LEVEL_H;
    const mat = kind === 'roof' ? texPreview(`roof|${id}`, roofTex(id), ok) : texPreview(`floor|${id}`, floorTex(id), ok);
    for (const [x, z] of tiles) this.group.add(new THREE.Mesh(boxAt(def.x + x, y + 0.01, def.y + z, 1, height, 1), mat));
  }

  tiles(tiles, def, level, ok, height = 0.04) {
    const y = level * LEVEL_H;
    for (const [x, z] of tiles) this.group.add(new THREE.Mesh(boxAt(def.x + x + 0.04, y + 0.02, def.y + z + 0.04, 0.92, height, 0.92), ok ? TILE_OK : TILE_BAD));
  }

  // The item itself, in its real colours (red-tinted if it can't go there), over its footprint.
  item(t, r, def, lx, ly, level, ok) {
    const [w, h] = footprint(t, r);
    const tiles = [];
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) tiles.push([lx + i, ly + j]);
    this.tiles(tiles, def, level, ok, 0.03);
    const y = level * LEVEL_H;
    if (hasModel(t)) {
      const m = makeItem(t, r, def.x + lx, y, def.y + ly);
      m.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.material = preview(o.material, ok); } });
      this.group.add(m);
    } else {
      // Pixel-art plants and crops: a card anchored at its base, like in the house view.
      const spr = objectSprite(t, 0, 0);
      let base = previewCache.get(`spr|${t}`);
      if (!base) { base = new THREE.SpriteMaterial({ map: texOf(spr.cv), alphaTest: 0.3 }); previewCache.set(`spr|${t}`, base); }
      const sp = new THREE.Sprite(preview(base, ok));
      sp.center.set((8 - spr.dx) / spr.cv.width, 1 - (14 - spr.dy) / spr.cv.height);
      sp.scale.set(spr.cv.width / 16, spr.cv.height / 16, 1);
      sp.position.set(def.x + lx + w / 2, y, def.y + ly + h - 0.35);
      this.group.add(sp);
    }
  }

  // A rectangle of land in world tiles (the land tools' preview).
  rect(x, y, w, h, ok) {
    this.group.add(new THREE.Mesh(boxAt(x, 0.03, y, w, 0.04, h), ok ? TILE_OK : TILE_BAD));
    for (const [bx, bz, bw, bd] of [[x, y - 0.06, w, 0.12], [x, y + h - 0.06, w, 0.12], [x - 0.06, y, 0.12, h], [x + w - 0.06, y, 0.12, h]]) {
      this.group.add(new THREE.Mesh(boxAt(bx, 0, bz, bw, 1.1, bd), ok ? OK : BAD));
    }
  }

  // A north-south cut line at world column x (the split tool).
  cut(x, y, h) {
    this.group.add(new THREE.Mesh(boxAt(x - 0.08, 0, y, 0.16, 1.4, h), BAD));
  }

  // Outline box marking one tile (used by the sledgehammer).
  marker(def, lx, ly, level, height = 0.6) {
    this.group.add(new THREE.Mesh(boxAt(def.x + lx + 0.02, level * LEVEL_H, def.y + ly + 0.02, 0.96, height, 0.96), BAD));
  }
}

// Plot boundaries for build mode: a bright outline with corner posts around your plot,
// faint outlines of the plots around it, and the public road tiles you can't build on.
const LINE = new THREE.MeshBasicMaterial({ color: '#ffe36e', transparent: true, opacity: 0.95, depthWrite: false });
const POST = new THREE.MeshBasicMaterial({ color: '#fff3b0' });
const OTHER = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false });
const GRID = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.16, depthWrite: false });
const ROAD = new THREE.MeshBasicMaterial({ color: '#ff7a4a', transparent: true, opacity: 0.28, depthWrite: false });

export class Outline {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.renderOrder = 4;
    scene.add(this.group);
    this.sig = '';
  }

  clear() {
    for (const c of this.group.children) c.geometry?.dispose();
    this.group.clear();
    this.sig = '';
  }

  // plot: your plot; others: nearby plots; roads: [[x, y]] world tiles of road inside it.
  show(plot, others, roads, level) {
    const sig = JSON.stringify([plot.x, plot.y, plot.w, plot.h, others.map((o) => [o.x, o.y, o.w, o.h]), roads, level]);
    if (sig === this.sig) return;
    this.clear();
    this.sig = sig;
    const y = level * LEVEL_H + 0.03;
    const frame = (r, mat, t, h) => {
      for (const [bx, bz, bw, bd] of [[r.x, r.y - t / 2, r.w, t], [r.x, r.y + r.h - t / 2, r.w, t], [r.x - t / 2, r.y, t, r.h], [r.x + r.w - t / 2, r.y, t, r.h]]) {
        this.group.add(new THREE.Mesh(boxAt(bx, y, bz, bw, h, bd), mat));
      }
    };
    for (const o of others) frame(o, OTHER, 0.06, 0.03);
    frame(plot, LINE, 0.12, 0.05);
    for (const [px, pz] of [[plot.x, plot.y], [plot.x + plot.w, plot.y], [plot.x, plot.y + plot.h], [plot.x + plot.w, plot.y + plot.h]]) {
      this.group.add(new THREE.Mesh(boxAt(px - 0.07, y, pz - 0.07, 0.14, 0.7, 0.14), POST));
    }
    for (const [tx, tz] of roads) this.group.add(new THREE.Mesh(boxAt(tx + 0.03, y, tz + 0.03, 0.94, 0.02, 0.94), ROAD));
    // A faint tile grid over your land, to line things up by.
    const pts = [];
    for (let i = 1; i < plot.w; i++) pts.push(plot.x + i, y + 0.01, plot.y, plot.x + i, y + 0.01, plot.y + plot.h);
    for (let j = 1; j < plot.h; j++) pts.push(plot.x, y + 0.01, plot.y + j, plot.x + plot.w, y + 0.01, plot.y + j);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.group.add(new THREE.LineSegments(g, GRID));
  }
}

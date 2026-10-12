// Translucent previews for the build tools (green = OK, red = can't place).
import * as THREE from 'three';
import { footprint } from '@shared/plot.js';
import { boxAt } from './geom.js';
import { makeItem } from './models.js';
import { WALL_H } from './textures.js';
import { LEVEL_H } from './houses.js';

const mk = (color) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, depthWrite: false });
const OK = mk('#7dff8a'), BAD = mk('#ff5a5a'), TILE_OK = mk('#a6ffb0'), TILE_BAD = mk('#ff8a8a');

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
  walls(edges, def, level, ok, low = false) {
    const y = level * LEVEL_H, h = low ? 0.4 : WALL_H;
    for (const [d, x, z] of edges) {
      const g = d === 'h' ? boxAt(def.x + x, y, def.y + z - 0.08, 1, h, 0.16) : boxAt(def.x + x - 0.08, y, def.y + z, 0.16, h, 1);
      this.group.add(new THREE.Mesh(g, ok ? OK : BAD));
    }
  }

  tiles(tiles, def, level, ok, height = 0.04) {
    const y = level * LEVEL_H;
    for (const [x, z] of tiles) this.group.add(new THREE.Mesh(boxAt(def.x + x + 0.04, y + 0.02, def.y + z + 0.04, 0.92, height, 0.92), ok ? TILE_OK : TILE_BAD));
  }

  item(t, r, def, lx, ly, level, ok) {
    const [w, h] = footprint(t, r);
    const tiles = [];
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) tiles.push([lx + i, ly + j]);
    this.tiles(tiles, def, level, ok);
    if (ok) {
      const m = makeItem(t, r, def.x + lx, level * LEVEL_H, def.y + ly);
      m.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.material = OK; } });
      this.group.add(m);
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

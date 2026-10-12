// Pixel-art cards that always face the camera (HD-2D style), batched into one mesh
// per source image so hundreds of trees cost a handful of draw calls. The camera only
// turns in 90° steps, so cards are rebuilt when it rotates rather than every frame.
import * as THREE from 'three';
import { canvasTex, blobTex, TEXEL } from './textures.js';

const texCache = new WeakMap();
export function texOf(cv) {
  let t = texCache.get(cv);
  if (!t) { t = canvasTex(cv); texCache.set(cv, t); }
  return t;
}

const matCache = new Map();
export function cardMaterial(tex) {
  let m = matCache.get(tex);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide });
    matCache.set(tex, m);
  }
  return m;
}

export class BillboardSet {
  constructor() {
    this.group = new THREE.Group();
    this.items = [];
    this.shadows = [];
  }

  clear() { this.items = []; this.shadows = []; }

  // spr: a baked sprite { cv, dx, dy } (see sprites.js bake()). (ax, ay) is the ground
  // contact point in the sprite's local pixel coordinates; (x, y, z) its world position.
  add(spr, ax, ay, x, y, z, { shadow = 0 } = {}) {
    this.items.push({ spr, ax, ay, x, y, z });
    if (shadow) this.shadows.push([x, y, z, shadow]);
  }

  // basis: { right, up, back } unit vectors of the camera.
  build(basis) {
    for (const m of this.group.children) m.geometry.dispose();
    this.group.clear();
    const byCanvas = new Map();
    for (const it of this.items) {
      if (!byCanvas.has(it.spr.cv)) byCanvas.set(it.spr.cv, []);
      byCanvas.get(it.spr.cv).push(it);
    }
    const { right: R, up: U, back: B } = basis;
    for (const [cv, list] of byCanvas) {
      const W = cv.width, H = cv.height;
      const pos = new Float32Array(list.length * 12), nor = new Float32Array(list.length * 12), uv = new Float32Array(list.length * 8);
      const idx = [];
      list.forEach((it, i) => {
        const cx = it.ax - it.spr.dx, cy = it.ay - it.spr.dy; // anchor in canvas pixels
        const corners = [[0, 0], [W, 0], [W, H], [0, H]];
        corners.forEach(([px, py], k) => {
          const u = (px - cx) / TEXEL, v = (cy - py) / TEXEL;
          pos.set([it.x + R.x * u + U.x * v, it.y + R.y * u + U.y * v, it.z + R.z * u + U.z * v], i * 12 + k * 3);
          nor.set([B.x, B.y, B.z], i * 12 + k * 3);
          uv.set([px / W, 1 - py / H], i * 8 + k * 2);
        });
        const o = i * 4;
        idx.push(o, o + 2, o + 1, o, o + 3, o + 2);
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setIndex(idx);
      const mesh = new THREE.Mesh(g, cardMaterial(texOf(cv)));
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    if (this.shadows.length) this.group.add(blobMesh(this.shadows));
  }
}

// Flat soft shadows on the ground under billboards: [x, y, z, radius][]
export function blobMesh(list) {
  const pos = [], uv = [], idx = [];
  list.forEach(([x, y, z, rad], i) => {
    const h = rad * 0.7;
    pos.push(x - rad, y + 0.015, z - h, x + rad, y + 0.015, z - h, x + rad, y + 0.015, z + h, x - rad, y + 0.015, z + h);
    uv.push(0, 1, 1, 1, 1, 0, 0, 0);
    idx.push(i * 4, i * 4 + 2, i * 4 + 1, i * 4, i * 4 + 3, i * 4 + 2);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: blobTex(), transparent: true, depthWrite: false, side: THREE.DoubleSide }));
}

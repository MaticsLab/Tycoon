// Pixel-art cards that always face the camera (HD-2D style), batched into one mesh
// per source image so hundreds of trees cost a handful of draw calls. The camera only
// turns in 90° steps, so cards are rebuilt when it rotates rather than every frame
// (in place: the vertex buffers are rewritten, the meshes stay).
import { Geo, toMesh, node, lambert, basic, disposeNode } from './bjs.js';
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
    m = lambert({ map: tex, alphaTest: 0.5, doubleSided: true });
    matCache.set(tex, m);
  }
  return m;
}

export class BillboardSet {
  constructor() {
    this.group = node('cards');
    this.items = [];
    this.shadows = [];
    this.meshes = null; // [{ mesh, list, pos, nor }]
  }

  clear() { this.items = []; this.shadows = []; }

  // spr: a baked sprite { cv, dx, dy } (see sprites.js bake()). (ax, ay) is the ground
  // contact point in the sprite's local pixel coordinates; (x, y, z) its world position.
  add(spr, ax, ay, x, y, z, { shadow = 0, scale = 1 } = {}) {
    // Overlapping cards side by side sit at exactly the same depth from the camera and
    // would z-fight (flickering trees): give each a tiny fixed nudge so one always wins.
    const h = Math.imul(Math.round(x * 16) ^ Math.imul(Math.round(z * 16), 40503), 2654435761) >>> 0;
    this.items.push({ spr, ax, ay, x, y, z, scale, bias: ((h % 1000) / 1000) * 0.02 });
    if (shadow) this.shadows.push([x, y, z, shadow]);
    this.meshes = null;
  }

  // basis: { right, up, back } unit vectors of the camera.
  build(basis) {
    if (!this.meshes) this.create();
    const { right: R, up: U, back: B } = basis;
    for (const e of this.meshes) {
      const { list, pos, nor, W, H } = e;
      list.forEach((it, i) => {
        const cx = it.ax - it.spr.dx, cy = it.ay - it.spr.dy; // anchor in canvas pixels
        for (let k = 0; k < 4; k++) {
          const px = k === 1 || k === 2 ? W : 0, py = k >= 2 ? H : 0;
          const u = ((px - cx) / TEXEL) * it.scale, v = ((cy - py) / TEXEL) * it.scale;
          const o = i * 12 + k * 3;
          const b = it.bias || 0;
          pos[o] = it.x + R.x * u + U.x * v + B.x * b; pos[o + 1] = it.y + R.y * u + U.y * v + B.y * b; pos[o + 2] = it.z + R.z * u + U.z * v + B.z * b;
          nor[o] = B.x; nor[o + 1] = B.y; nor[o + 2] = B.z;
        }
      });
      e.mesh.updateVerticesData('position', pos, false, false);
      e.mesh.updateVerticesData('normal', nor, false, false);
      e.mesh.refreshBoundingInfo();
    }
  }

  create() {
    for (const m of this.group.getChildMeshes(true)) disposeNode(m);
    this.meshes = [];
    const byCanvas = new Map();
    for (const it of this.items) {
      if (!byCanvas.has(it.spr.cv)) byCanvas.set(it.spr.cv, []);
      byCanvas.get(it.spr.cv).push(it);
    }
    for (const [cv, list] of byCanvas) {
      const W = cv.width, H = cv.height, n = list.length;
      const pos = new Float32Array(n * 12), nor = new Float32Array(n * 12), uv = new Float32Array(n * 8);
      const idx = n * 4 > 65535 ? new Uint32Array(n * 6) : new Uint16Array(n * 6);
      for (let i = 0; i < n; i++) {
        uv.set([0, 1, 1, 1, 1, 0, 0, 0], i * 8);
        const o = i * 4;
        idx.set([o, o + 2, o + 1, o, o + 3, o + 2], i * 6);
      }
      const mesh = toMesh(new Geo(pos, nor, uv, idx), cardMaterial(texOf(cv)), { parent: this.group, updatable: true });
      this.meshes.push({ mesh, list, pos, nor, W, H });
    }
    if (this.shadows.length) blobMesh(this.shadows, this.group);
  }

  dispose() { disposeNode(this.group); this.meshes = null; }
}

// Flat soft shadows on the ground under billboards: [x, y, z, radius][]
let blobMat;
export function blobMaterial() {
  return (blobMat ||= basic({ map: blobTex(), transparent: true, depthWrite: false, doubleSided: true }));
}
export function blobMesh(list, parent = null) {
  const pos = [], nrm = [], uv = [], idx = [];
  list.forEach(([x, y, z, rad], i) => {
    const h = rad * 0.7;
    pos.push(x - rad, y + 0.015, z - h, x + rad, y + 0.015, z - h, x + rad, y + 0.015, z + h, x - rad, y + 0.015, z + h);
    nrm.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
    uv.push(0, 1, 1, 1, 1, 0, 0, 0);
    idx.push(i * 4, i * 4 + 2, i * 4 + 1, i * 4, i * 4 + 3, i * 4 + 2);
  });
  return toMesh(new Geo(pos, nrm, uv, idx), blobMaterial(), { parent });
}

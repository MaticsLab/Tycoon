// Voxel-style 3D furniture. Each model is a list of boxes in tile units, with the
// origin at the north-west corner of the item's unrotated footprint, y up, and the
// front facing south (+z). Boxes are merged into one mesh per item (plus one for
// glowing parts like lamp shades), and a dithered grain texture keeps the pixel look.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { footprint } from '@shared/plot.js';
import { grainTex } from './textures.js';

const WOOD = '#a8703f', WOOD_D = '#6b4424', WOOD_L = '#c99363', METAL = '#2f3542', WHITE = '#f4f6f7';

const legs = (x0, z0, x1, z1, h, col = WOOD_D, t = 0.08) => [
  [x0, 0, z0, t, h, t, col], [x1 - t, 0, z0, t, h, t, col], [x0, 0, z1 - t, t, h, t, col], [x1 - t, 0, z1 - t, t, h, t, col],
];

// [x, y, z, w, h, d, colour, glow?]
const MODELS = {
  bed: () => [
    [0.05, 0, 0.02, 0.9, 0.95, 0.12, WOOD_D], [0.05, 0, 1.86, 0.9, 0.5, 0.1, WOOD_D],
    [0.05, 0.08, 0.1, 0.9, 0.22, 1.78, WOOD], [0.1, 0.3, 0.14, 0.8, 0.16, 1.72, '#f4f1ea'],
    [0.18, 0.46, 0.2, 0.64, 0.12, 0.32, '#ffffff'], [0.07, 0.4, 0.62, 0.86, 0.12, 1.22, '#4d79c7'],
    [0.07, 0.46, 0.62, 0.86, 0.07, 0.14, '#9cbbf0'], [0.2, 0.521, 0.9, 0.2, 0.01, 0.2, '#3a63aa'], [0.6, 0.521, 1.3, 0.2, 0.01, 0.2, '#3a63aa'],
  ],
  table: () => [
    [0.05, 0.68, 0.08, 1.9, 0.08, 0.84, WOOD_L], [0.05, 0.62, 0.08, 1.9, 0.06, 0.84, WOOD],
    ...legs(0.12, 0.15, 1.88, 0.85, 0.62),
    [0.3, 0.76, 0.32, 0.3, 0.02, 0.3, WHITE], [1.4, 0.76, 0.32, 0.3, 0.02, 0.3, WHITE],
    [0.94, 0.76, 0.44, 0.12, 0.2, 0.12, '#e9668a'], [0.96, 0.96, 0.46, 0.08, 0.08, 0.08, '#4f9e3a'],
  ],
  chair: () => [
    [0.2, 0.4, 0.22, 0.6, 0.08, 0.6, WOOD_L], ...legs(0.22, 0.24, 0.78, 0.8, 0.4),
    [0.2, 0.48, 0.2, 0.6, 0.62, 0.08, WOOD], [0.2, 1.04, 0.18, 0.6, 0.08, 0.12, WOOD_D],
  ],
  sofa: () => [
    [0.04, 0.08, 0.08, 1.92, 0.32, 0.84, '#357a6c'], [0.04, 0.08, 0.06, 1.92, 0.86, 0.24, '#3f8f7f'],
    [0.2, 0.4, 0.3, 0.78, 0.12, 0.6, '#5fbca8'], [1.02, 0.4, 0.3, 0.78, 0.12, 0.6, '#5fbca8'],
    [0.04, 0.08, 0.08, 0.18, 0.6, 0.84, '#2a6458'], [1.78, 0.08, 0.08, 0.18, 0.6, 0.84, '#2a6458'],
    [0.3, 0.66, 0.3, 0.3, 0.22, 0.1, '#f5c542'], ...legs(0.1, 0.12, 1.9, 0.9, 0.08, WOOD_D, 0.06),
  ],
  armchair: () => [
    [0.08, 0.08, 0.1, 0.84, 0.32, 0.8, '#a64a33'], [0.08, 0.08, 0.08, 0.84, 0.92, 0.22, '#c0593e'],
    [0.22, 0.4, 0.3, 0.56, 0.12, 0.56, '#e08467'], [0.08, 0.08, 0.1, 0.16, 0.62, 0.8, '#8f3d2a'], [0.76, 0.08, 0.1, 0.16, 0.62, 0.8, '#8f3d2a'],
    ...legs(0.12, 0.14, 0.88, 0.86, 0.08, WOOD_D, 0.06),
  ],
  rug: () => [
    [0.08, 0, 0.08, 1.84, 0.02, 1.84, '#b8902a'], [0.16, 0.003, 0.16, 1.68, 0.02, 1.68, '#7e2f52'],
    [0.45, 0.006, 0.45, 1.1, 0.02, 1.1, '#c9a227'], [0.6, 0.009, 0.6, 0.8, 0.02, 0.8, '#2f4d88'], [0.85, 0.012, 0.85, 0.3, 0.02, 0.3, '#e6d6a0'],
  ],
  lamp: () => [
    [0.3, 0, 0.3, 0.4, 0.08, 0.4, WOOD_D], [0.46, 0.08, 0.46, 0.08, 1.02, 0.08, '#5a4632'],
    [0.24, 1.05, 0.24, 0.52, 0.42, 0.52, '#f6e1a0', true],
  ],
  bookshelf: () => {
    const out = [[0.05, 0, 0.08, 0.9, 2.05, 0.45, WOOD_D], [0.1, 0.04, 0.5, 0.8, 1.94, 0.02, '#3a2414']];
    const cols = ['#c0392b', '#2980b9', '#27ae60', '#f39c12', '#8e44ad', '#ecf0f1', '#d35400'];
    for (let s = 0; s < 4; s++) {
      const y = 0.1 + s * 0.5;
      out.push([0.08, y - 0.04, 0.12, 0.84, 0.04, 0.42, WOOD]);
      let x = 0.12;
      for (let b = 0; x < 0.84; b++) {
        const w = 0.07 + ((b + s) % 3) * 0.03, h = 0.3 + ((b * 5 + s) % 3) * 0.05;
        out.push([x, y, 0.2, w, h, 0.32, cols[(b + s * 2) % cols.length]]);
        x += w + 0.01;
      }
    }
    return out;
  },
  tv: () => [
    [0.04, 0, 0.3, 0.92, 0.45, 0.5, WOOD], [0.04, 0.45, 0.28, 0.92, 0.04, 0.54, WOOD_L],
    [0.1, 0.5, 0.48, 0.8, 0.58, 0.1, '#1d2025'], [0.14, 0.54, 0.585, 0.72, 0.48, 0.01, '#5cc0e0', true],
  ],
  fridge: () => [
    [0.1, 0, 0.12, 0.8, 1.9, 0.76, '#e3eaee'], [0.1, 1.24, 0.879, 0.8, 0.03, 0.01, '#93a0a8'],
    [0.74, 0.7, 0.88, 0.05, 0.42, 0.05, '#7c8a92'], [0.74, 1.34, 0.88, 0.05, 0.36, 0.05, '#7c8a92'],
    [0.22, 1.5, 0.881, 0.1, 0.1, 0.01, '#e9668a'], [0.36, 1.42, 0.881, 0.08, 0.08, 0.01, '#f5c542'],
  ],
  stove: () => [
    [0.05, 0, 0.1, 0.9, 0.85, 0.8, '#d8dde0'], [0.05, 0.85, 0.1, 0.9, 0.05, 0.8, '#2c3036'],
    [0.15, 0.9, 0.2, 0.25, 0.02, 0.25, '#5a6068'], [0.6, 0.9, 0.2, 0.25, 0.02, 0.25, '#5a6068'],
    [0.15, 0.9, 0.55, 0.25, 0.02, 0.25, '#5a6068'], [0.6, 0.9, 0.55, 0.25, 0.02, 0.25, '#e05a2a', true],
    [0.15, 0.15, 0.9, 0.7, 0.5, 0.02, '#22262b'], [0.2, 0.62, 0.92, 0.6, 0.04, 0.03, '#aab2b8'],
  ],
  counter: () => [
    [0, 0, 0.12, 1, 0.84, 0.78, WOOD], [0, 0.84, 0.08, 1, 0.08, 0.84, '#e6e1d6'],
    [0.08, 0.1, 0.9, 0.38, 0.66, 0.02, WOOD_L], [0.54, 0.1, 0.9, 0.38, 0.66, 0.02, WOOD_L],
    [0.4, 0.5, 0.92, 0.05, 0.12, 0.03, '#d6be6c'], [0.56, 0.5, 0.92, 0.05, 0.12, 0.03, '#d6be6c'],
  ],
  dresser: () => [
    [0.05, 0, 0.2, 0.9, 0.95, 0.6, WOOD],
    ...[0.1, 0.38, 0.66].flatMap((y) => [[0.1, y, 0.8, 0.8, 0.24, 0.02, WOOD_L], [0.45, y + 0.1, 0.82, 0.1, 0.04, 0.03, '#f5c542']]),
    [0.2, 0.95, 0.35, 0.16, 0.22, 0.16, '#e9668a'],
  ],
  bathtub: () => [
    [0.05, 0.06, 0.08, 1.9, 0.5, 0.84, WHITE], [0.15, 0.48, 0.18, 1.7, 0.06, 0.64, '#7cc4e8'],
    [1.75, 0.56, 0.4, 0.06, 0.25, 0.06, '#9aa4ac'], ...legs(0.1, 0.12, 1.9, 0.88, 0.06, '#d6be6c', 0.08),
  ],
  toilet: () => [
    [0.25, 0, 0.08, 0.5, 0.9, 0.22, '#e3eaee'], [0.28, 0, 0.3, 0.44, 0.4, 0.5, WHITE],
    [0.26, 0.4, 0.28, 0.48, 0.05, 0.54, '#ffffff'], [0.33, 0.45, 0.36, 0.34, 0.01, 0.36, '#9fd6ee'],
  ],
  picket: () => [
    [0, 0.24, 0.46, 1, 0.07, 0.06, '#e8e2d4'], [0, 0.56, 0.46, 1, 0.07, 0.06, '#e8e2d4'],
    ...[0.08, 0.43, 0.78].map((x) => [x, 0, 0.42, 0.14, 0.86, 0.1, '#fbf9f4']),
  ],
  lamppost: () => [
    [0.32, 0, 0.32, 0.36, 0.16, 0.36, METAL], [0.46, 0.16, 0.46, 0.08, 1.9, 0.08, METAL],
    [0.3, 2.02, 0.3, 0.4, 0.06, 0.4, METAL], [0.34, 2.08, 0.34, 0.32, 0.34, 0.32, '#ffe8a3', true], [0.28, 2.42, 0.28, 0.44, 0.08, 0.44, METAL],
  ],
  bench: () => [
    [0.05, 0.4, 0.3, 1.9, 0.06, 0.48, WOOD_L], [0.05, 0.5, 0.26, 1.9, 0.38, 0.06, WOOD],
    [0.12, 0, 0.32, 0.08, 0.4, 0.44, METAL], [1.8, 0, 0.32, 0.08, 0.4, 0.44, METAL],
  ],
  mailbox: () => [
    [0.45, 0, 0.45, 0.1, 0.9, 0.1, WOOD_D], [0.3, 0.9, 0.3, 0.4, 0.3, 0.5, '#3d6fb5'],
    [0.31, 1.2, 0.31, 0.38, 0.06, 0.48, '#5585cc'], [0.72, 1.0, 0.55, 0.04, 0.3, 0.1, '#e74c3c'],
  ],
  piano: () => [
    [0.05, 0.25, 0.05, 1.9, 0.55, 0.9, '#15161a'], [0.05, 0.8, 0.05, 1.9, 0.06, 0.9, '#2c2e35'],
    [0.2, 0.86, 0.08, 1.2, 0.6, 0.05, '#15161a'],
    [0.1, 0.66, 0.78, 1.8, 0.05, 0.2, '#f4f1ea'], ...[0.2, 0.4, 0.6, 0.9, 1.1, 1.3, 1.5, 1.7].map((x) => [x, 0.705, 0.8, 0.06, 0.03, 0.12, '#15161a']),
    ...legs(0.15, 0.15, 1.85, 0.85, 0.25, '#15161a', 0.1),
  ],
  fireplace: () => [
    [0, 0, 0.25, 2, 1.35, 0.7, '#9a9384'], [0.5, 1.35, 0.32, 1, 1.25, 0.5, '#8e877a'],
    [-0.05, 1.22, 0.18, 2.1, 0.1, 0.82, WOOD], [0.45, 0, 0.94, 1.1, 0.82, 0.02, '#2a1a10'],
    [0.6, 0.05, 0.9, 0.8, 0.45, 0.05, '#f39c12', true], [0.75, 0.05, 0.88, 0.5, 0.25, 0.05, '#ffe58a', true],
    [0.2, 1.32, 0.4, 0.14, 0.2, 0.14, '#f5c542'], [1.6, 1.32, 0.4, 0.12, 0.26, 0.12, '#e9668a'],
  ],
  aquarium: () => [
    [0.05, 0, 0.15, 1.9, 0.6, 0.7, WOOD_D], [0.05, 0.6, 0.15, 1.9, 0.72, 0.7, '#4cb0dc', true],
    [0.08, 0.6, 0.18, 1.84, 0.1, 0.64, '#e6d39a'], [0.4, 0.7, 0.4, 0.05, 0.4, 0.05, '#2d8a3c'], [1.5, 0.7, 0.3, 0.05, 0.5, 0.05, '#2d8a3c'],
    [0.7, 0.95, 0.5, 0.14, 0.08, 0.05, '#f39c12'], [1.2, 1.1, 0.4, 0.12, 0.07, 0.05, '#e74c3c'], [0.05, 1.32, 0.15, 1.9, 0.05, 0.7, '#2c3036'],
  ],
  grandclock: () => [
    [0.2, 0, 0.25, 0.6, 2.1, 0.5, WOOD_D], [0.15, 2.1, 0.2, 0.7, 0.14, 0.6, WOOD], [0.3, 2.24, 0.3, 0.4, 0.1, 0.4, WOOD_L],
    [0.3, 1.58, 0.76, 0.4, 0.38, 0.02, '#f4f1ea'], [0.49, 1.66, 0.78, 0.02, 0.16, 0.01, '#2a1a12'],
    [0.3, 0.4, 0.76, 0.4, 1.0, 0.01, '#2c1a0e'], [0.48, 0.6, 0.77, 0.04, 0.6, 0.01, '#d6be6c'], [0.44, 0.52, 0.77, 0.12, 0.12, 0.02, '#f5c542'],
  ],
};

// Items shown as camera-facing pixel-art cards instead of boxes.
export const BILLBOARD = new Set(['houseplant', 'bush', 'sapling', 'scarecrow', 'statue', 'telescope', 'flowerbed']);

export const hasModel = (t) => !!MODELS[t];

function colorize(geo, hex) {
  const c = new THREE.Color(hex).convertSRGBToLinear();
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

const geoCache = new Map();
let solidMat, glowMat;
export function materials() {
  solidMat ||= new THREE.MeshLambertMaterial({ vertexColors: true, map: grainTex() });
  glowMat ||= new THREE.MeshBasicMaterial({ vertexColors: true });
  return { solidMat, glowMat };
}

// Geometry for an item, centred on its footprint (so rotation spins it in place).
function itemGeometry(t) {
  if (geoCache.has(t)) return geoCache.get(t);
  const [w0, d0] = footprint(t, 0);
  const solid = [], glow = [];
  for (const [x, y, z, w, h, d, col, lit] of MODELS[t]()) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x + w / 2 - w0 / 2, y + h / 2, z + d / 2 - d0 / 2);
    (lit ? glow : solid).push(colorize(g, col));
  }
  const out = { solid: solid.length ? mergeGeometries(solid) : null, glow: glow.length ? mergeGeometries(glow) : null };
  for (const g of [out.solid, out.glow]) if (g) g.userData.shared = true; // cached: never dispose
  geoCache.set(t, out);
  return out;
}

// A ready-to-place furniture object. (x, z) = world position of the footprint's
// north-west corner, y = floor height; r = rotation 0..3.
export function makeItem(t, r, x, y, z) {
  const { solidMat, glowMat } = materials();
  const g = itemGeometry(t);
  const grp = new THREE.Group();
  if (g.solid) { const m = new THREE.Mesh(g.solid, solidMat); m.castShadow = true; m.receiveShadow = true; grp.add(m); }
  if (g.glow) grp.add(new THREE.Mesh(g.glow, glowMat));
  const [w, d] = footprint(t, r);
  grp.position.set(x + w / 2, y, z + d / 2);
  grp.rotation.y = (-r * Math.PI) / 2;
  grp.userData.item = t;
  return grp;
}

// Procedural pixel art in a Stardew-like style.
//
// Every sprite is painted once (with fillRect, 1 unit = 1 world pixel) into a cached
// offscreen canvas, then given an automatic dark outline. Light comes from the
// top-left: shapes use 3-4 tone ramps (shadow, shade, base, light), and objects
// sit on soft drop shadows. The ground is rendered per pixel: dithered grass, ragged
// dirt edges with a raised grass lip, deep water with bank shadows, and cobblestones.
import { T, TILE, MAP_W, MAP_H, tileHash } from '@shared/world.js';
import { ITEMS, cropStage } from '@shared/catalog.js';
import { footprint } from '@shared/plot.js';

// ---------- drawing helpers ----------
export const r = (c, x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
export const px = (c, x, y, col) => r(c, x, y, 1, 1, col);

// Filled pixel ellipse centred on (cx, cy).
export function disc(c, cx, cy, rx, ry, col) {
  c.fillStyle = col;
  for (let dy = -ry; dy <= ry; dy++) {
    const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy / (ry + 0.5)) ** 2)));
    if (half > 0) c.fillRect(cx - half, cy + dy, half * 2, 1);
  }
}

// Colour ramp helpers.
function rgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function hex([a, b, c]) { return '#' + ((1 << 24) | (a << 16) | (b << 8) | c).toString(16).slice(1); }
export function mix(a, b, t) { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => Math.round(v + (y[i] - v) * t))); }
export const dk = (h, t = 0.25) => mix(h, '#20140c', t);
export const lt = (h, t = 0.25) => mix(h, '#fff6dc', t);
export const ramp = (h) => [dk(h, 0.38), dk(h, 0.16), h, lt(h, 0.28)]; // shadow, shade, base, light

// Soft drop shadow under an object.
export function shadow(c, cx, cy, rx, ry) {
  disc(c, Math.round(cx), Math.round(cy), Math.max(2, Math.round(rx)), Math.max(1, Math.round(ry)), 'rgba(24,16,8,0.24)');
}

// Dark, warm outline around every opaque shape (Stardew's signature look).
export function outline(cv) {
  const c = cv.getContext('2d');
  const { width: w, height: h } = cv;
  const img = c.getImageData(0, 0, w, h);
  const d = img.data, s = new Uint8ClampedArray(d);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (s[i + 3] > 90) continue;
    let j = -1;
    if (y > 0 && s[i - w * 4 + 3] > 200) j = i - w * 4;
    else if (x > 0 && s[i - 1] > 200) j = i - 4;
    else if (x < w - 1 && s[i + 7] > 200) j = i + 4;
    else if (y < h - 1 && s[i + w * 4 + 3] > 200) j = i + w * 4;
    if (j < 0) continue;
    d[i] = s[j] * 0.28 + 16; d[i + 1] = s[j + 1] * 0.25 + 9; d[i + 2] = s[j + 2] * 0.25 + 8; d[i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
}

// Sprite cache. `paint` draws in local coordinates where (0, 0) is the anchor; the
// canvas covers x in [-left, w - left) and y in [-top, h - top).
const SPR = new Map();
export function bake(id, left, top, w, h, paint, line = true) {
  let s = SPR.get(id);
  if (!s) {
    const cv = document.createElement('canvas');
    cv.width = w + 2; cv.height = h + 2;
    const c = cv.getContext('2d');
    c.translate(left + 1, top + 1);
    paint(c);
    if (line) outline(cv);
    s = { cv, dx: -(left + 1), dy: -(top + 1) };
    SPR.set(id, s);
  }
  return s;
}
const blit = (c, s, x, y) => c.drawImage(s.cv, Math.round(x + s.dx), Math.round(y + s.dy));

// ---------- noise ----------
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16 - 0.5);
const hash = (x, y) => tileHash(x * 7 + 3, y * 13 + 5);
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y) => vnoise(x / 9, y / 9) * 0.6 + vnoise(x / 4, y / 4) * 0.28 + vnoise(x / 2, y / 2) * 0.12;

// ---------- ground ----------
const C = { GRASS: 0, DIRT: 1, SAND: 2, WATER: 3, STONE: 4, LAWN: 5, FIELD: 6 };
function tileClass(t) {
  switch (t) {
    case T.PATH: case T.GATE: return C.DIRT;
    case T.SAND: return C.SAND;
    case T.WATER: return C.WATER;
    case T.PLAZA: case T.FOUNTAIN: case T.SHOP: case T.HALL: return C.STONE;
    case T.FIELD: case T.CORN: return C.FIELD;
    case T.LAWN: case T.FENCE: return C.LAWN;
    default: return C.GRASS;
  }
}
const PAL = {
  grass: ['#3d7a2b', '#4c9233', '#5aa63b', '#6db844', '#86cc52'],
  lawn: ['#478a30', '#56a138', '#65b441', '#78c54b', '#90d65a'],
  dirt: ['#94622f', '#a8733c', '#b98449', '#c99559', '#d8a96d'],
  field: ['#4e2f18', '#5f3a1e', '#704626', '#82552e', '#93653a'],
  sand: ['#cfae6c', '#dcbe7d', '#e7cb8c', '#f0d9a2', '#f7e6b9'],
  stone: ['#9d9586', '#aea697', '#bcb4a5', '#cbc4b5', '#dad4c6'],
};
const pick = (pal, f) => pal[Math.max(0, Math.min(pal.length - 1, Math.floor(f * pal.length)))];

// opts.deco = false leaves out all decorations; opts.three leaves out the ones the 3D
// view builds as real geometry (fences, gates, rocks, fountain).
export function renderGround(world, opts = {}) {
  const W = MAP_W * TILE, H = MAP_H * TILE;
  const tcls = new Uint8Array(MAP_W * MAP_H);
  for (let i = 0; i < tcls.length; i++) tcls[i] = tileClass(world.tiles[i]);
  const clsAtTile = (tx, ty) => tcls[Math.max(0, Math.min(MAP_H - 1, ty)) * MAP_W + Math.max(0, Math.min(MAP_W - 1, tx))];

  // 1. Classify every pixel. Natural borders are domain-warped so they look hand-drawn;
  //    lawns and paved stone keep their straight edges.
  const cls = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const base = clsAtTile(x >> 4, y >> 4);
    let k = base;
    if (base !== C.LAWN && base !== C.STONE && base !== C.FIELD) {
      const wx = x + (vnoise(x / 5, y / 5) - 0.5) * 8, wy = y + (vnoise(x / 5 + 40, y / 5 + 40) - 0.5) * 8;
      const w = clsAtTile(Math.floor(wx / TILE), Math.floor(wy / TILE));
      if (w !== C.LAWN && w !== C.STONE && w !== C.FIELD) k = w;
    }
    cls[y * W + x] = k;
  }
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? C.GRASS : cls[y * W + x]);
  const green = (k) => k === C.GRASS || k === C.LAWN;

  // Cobblestone cells for the plaza.
  const CELL = 8;
  const cellPt = (cx, cy) => [cx * CELL + 1 + hash(cx, cy) * (CELL - 2), cy * CELL + 1 + hash(cy + 91, cx) * (CELL - 2)];
  function cobble(x, y) {
    const gx = Math.floor(x / CELL), gy = Math.floor(y / CELL);
    let d1 = 1e9, d2 = 1e9, id = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const [qx, qy] = cellPt(gx + i, gy + j);
      const d = (x - qx) ** 2 + (y - qy) ** 2;
      if (d < d1) { d2 = d1; d1 = d; id = (gx + i) * 977 + (gy + j); } else if (d < d2) d2 = d;
    }
    return { edge: Math.sqrt(d2) - Math.sqrt(d1), id };
  }

  // 2. Colour.
  const img = new ImageData(W, H);
  const data = img.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = cls[y * W + x];
    const dither = BAYER[(y & 3) * 4 + (x & 3)] * 0.14;
    const n = fbm(x, y) + dither;
    const h = hash(x * 31 + 7, y * 17 + 3);
    let col;
    if (k === C.GRASS || k === C.LAWN) {
      const pal = k === C.LAWN ? PAL.lawn : PAL.grass;
      col = pick(pal, n * 0.95 + (k === C.LAWN ? (Math.floor((x + y) / 10) % 2) * 0.06 : 0));
      if (h < 0.05) col = pal[4];
      else if (h > 0.955) col = pal[0];
      // Raised lip where grass meets a lower surface below.
      const below = at(x, y + 1), below2 = at(x, y + 2);
      if (!green(below) && below !== C.WATER) col = pal[0];
      else if (!green(below2) && below2 !== C.WATER) col = mix(pal[1], pal[0], 0.5);
    } else if (k === C.FIELD) {
      // Ploughed furrows running east-west.
      const row = y % 8;
      col = pick(PAL.field, n * 0.7 + (row < 2 ? 0.35 : row > 5 ? -0.05 : 0.15));
      if (row === 2) col = PAL.field[4];
      else if (row === 7) col = PAL.field[0];
    } else if (k === C.DIRT || k === C.SAND) {
      const pal = k === C.DIRT ? PAL.dirt : PAL.sand;
      col = pick(pal, n * 0.9 + 0.08);
      if (h < 0.012) col = pal[0];
      else if (h > 0.99) col = pal[4];
      // Shadow cast by the grass lip above.
      if (green(at(x, y - 1)) || green(at(x, y - 2))) col = dk(col, 0.28);
      else if (green(at(x, y - 3))) col = dk(col, 0.12);
    } else if (k === C.WATER) {
      let shore = 99;
      for (const d of [1, 2, 3, 5, 8]) {
        if (at(x - d, y) !== C.WATER || at(x + d, y) !== C.WATER || at(x, y - d) !== C.WATER || at(x, y + d) !== C.WATER) { shore = d; break; }
      }
      col = shore <= 1 ? '#a6e0ee' : shore <= 3 ? '#62b9df' : shore <= 5 ? '#4aa2d6' : shore <= 8 ? '#3a8cc9' : '#2f7abb';
      if (shore > 2 && n > 0.62 && (Math.floor(x / 3 + Math.sin(y / 3) * 2) % 7 === 0)) col = '#8cd0ec';
      if (at(x, y - 1) !== C.WATER || at(x, y - 2) !== C.WATER) col = '#2a679f';
      else if (at(x, y - 3) !== C.WATER) col = mix(col, '#2a679f', 0.5);
    } else {
      const { edge, id } = cobble(x, y);
      if (edge < 1.1) col = '#857d6e';
      else {
        const base = PAL.stone[1 + Math.floor(hash(id, 7) * 3)];
        col = base;
        if (cobble(x, y - 1).edge < 1.1 || cobble(x - 1, y).edge < 1.1) col = lt(base, 0.3);
        else if (cobble(x, y + 1).edge < 1.1 || cobble(x + 1, y).edge < 1.1) col = dk(base, 0.18);
        else if (h < 0.03) col = dk(base, 0.1);
      }
      if (green(at(x, y - 1)) || green(at(x, y - 2))) col = dk(col, 0.25);
    }
    const [R, G, B] = rgb(col);
    const i = (y * W + x) * 4;
    data[i] = R; data[i + 1] = G; data[i + 2] = B; data[i + 3] = 255;
  }
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  c.putImageData(img, 0, 0);
  if (opts.deco === false) return cv;

  // 3. Low decorations (outlined), composited on top.
  const deco = document.createElement('canvas');
  deco.width = W; deco.height = H;
  const d = deco.getContext('2d');
  const tile = (tx, ty) => (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H ? -1 : world.tiles[ty * MAP_W + tx]);
  for (let ty = 0; ty < MAP_H; ty++) for (let tx = 0; tx < MAP_W; tx++) {
    const t = tile(tx, ty), x = tx * TILE, y = ty * TILE, hv = tileHash(tx, ty);
    if (t === T.FLOWERS) flowers(d, x, y, tx, ty);
    else if (t === T.TALLGRASS && !opts.three) tuft(d, x + 3 + Math.floor(hv * 6), y + 12, hv);
    else if (t === T.ROCK) { if (!opts.three) rock(d, x, y, hv); }
    else if (t === T.FENCE) { if (!opts.three) fence(d, x, y, tile, tx, ty); }
    else if (t === T.GATE) { if (!opts.three) gatePost(d, x, y, tile(tx - 1, ty) === T.FENCE); }
    else if (t === T.GRASS && hv < 0.18 && !opts.three) tuft(d, x + Math.floor(hv * 60) % 12 + 2, y + 10 + Math.floor(hv * 30) % 5, hv * 5);
    else if (t === T.PATH && hv < 0.1) pebble(d, x + Math.floor(hv * 90) % 12 + 2, y + Math.floor(hv * 170) % 12 + 2);
    else if (t === T.WATER && hv > 0.9 && tile(tx, ty - 1) === T.WATER && tile(tx, ty + 1) === T.WATER) lilypad(d, x + 4, y + 5, hv);
  }
  if (!opts.three) fountain(d, 40 * TILE, 24 * TILE);
  outline(deco);
  c.drawImage(deco, 0, 0);
  // In 3D, grass tufts are painted softly (no outline) and more sparsely.
  if (opts.three) {
    const green = (t) => t === T.GRASS || t === T.TALLGRASS || t === T.FLOWERS || t === T.LAWN;
    for (let ty = 0; ty < MAP_H; ty++) for (let tx = 0; tx < MAP_W; tx++) {
      const t = tile(tx, ty), hv = tileHash(tx, ty);
      if ((t === T.TALLGRASS && hv < 0.6) || (t === T.GRASS && hv < 0.05)) softTuft(c, tx * TILE + 3 + Math.floor(hv * 9), ty * TILE + 12, hv);
      // Grassy verges: tufts creep onto the road along its edges.
      if (t === T.PATH) {
        const edges = [[0, -1], [0, 1], [-1, 0], [1, 0]].filter(([dx, dy]) => green(tile(tx + dx, ty + dy)));
        for (const [dx, dy] of edges) {
          for (let i = 0; i < 3; i++) {
            const h2 = tileHash(tx * 5 + i * 17 + dx * 3, ty * 7 + i * 29 + dy * 5);
            if (h2 < 0.25) continue;
            const along = 2 + Math.floor(h2 * 12);
            const inset = 1 + Math.floor(tileHash(tx + i, ty - i) * 4);
            const px0 = tx * TILE + (dx ? (dx < 0 ? inset : TILE - inset) : along);
            const py0 = ty * TILE + (dy ? (dy < 0 ? inset + 4 : TILE - inset + 2) : along + 3);
            softTuft(c, px0, py0, h2);
          }
        }
      }
    }
    if (world.season?.fall) fallenLeaves(c, world, tile);
  }
  return cv;
}

// Fall: red, orange and gold leaves scattered on the grass, thicker under trees.
function fallenLeaves(c, world, tile) {
  const cols = ['#c8462a', '#e8703a', '#d6861e', '#f0ae3a', '#9a2e1c', '#e6cc4a'];
  for (let ty = 0; ty < MAP_H; ty++) for (let tx = 0; tx < MAP_W; tx++) {
    const t = tile(tx, ty);
    if (t !== T.GRASS && t !== T.TALLGRASS && t !== T.LAWN && t !== T.PATH) continue;
    let near = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (tile(tx + dx, ty + dy) === T.TREE) near++;
    const n = Math.min(9, Math.floor(tileHash(tx * 3, ty * 5) * 3) + near * (t === T.PATH ? 0.5 : 1.5));
    for (let i = 0; i < n; i++) {
      const lx = tx * TILE + Math.floor(tileHash(tx + i * 13, ty * 7) * 15), ly = ty * TILE + Math.floor(tileHash(ty + i * 11, tx * 3) * 15);
      const col = cols[(tx + ty * 3 + i) % cols.length];
      r(c, lx, ly, 2, 1, col); px(c, lx + (i % 2), ly + 1, dk(col, 0.25));
    }
  }
}

function flowers(d, x, y, tx, ty) {
  const cols = [['#f6f0de', '#fff'], ['#f5c542', '#ffe58a'], ['#e9668a', '#ff9db8'], ['#8f7cf0', '#b9adff'], ['#5fa8f0', '#a6d4ff']];
  const n = 2 + Math.floor(tileHash(tx, ty * 3) * 3);
  for (let i = 0; i < n; i++) {
    const fx = x + 2 + Math.floor(tileHash(tx + i * 5, ty * 3) * 11), fy = y + 3 + Math.floor(tileHash(ty + i * 7, tx * 5) * 10);
    const [a, b] = cols[(tx * 3 + ty + i) % cols.length];
    r(d, fx, fy + 2, 1, 3, '#3f7f2d');
    r(d, fx - 1, fy, 3, 1, a); r(d, fx, fy - 1, 1, 3, a); px(d, fx, fy - 1, b); px(d, fx, fy, '#f2b134');
  }
}

function tuft(d, x, y, v) {
  const g = ['#2f6a24', '#3f8a2e', '#5aa63b', '#7cc451'];
  for (const [bx, bh] of [[-3, 4], [-1, 7], [1, 5], [3, 3]]) {
    const hh = bh + (Math.floor(v * 3) % 2);
    r(d, x + bx, y - hh, 1, hh, g[1]);
    px(d, x + bx, y - hh, g[3]);
    r(d, x + bx + 1, y - hh + 2, 1, hh - 2, g[0]);
  }
}

function softTuft(d, x, y, v) {
  const g = ['#3f8a2e', '#4c9a35', '#6fb848', '#8fd05c'];
  for (const [bx, bh] of [[-2, 3], [0, 5], [2, 4]]) {
    const hh = bh + (Math.floor(v * 7) % 2);
    r(d, x + bx, y - hh, 1, hh, g[1]);
    px(d, x + bx, y - hh, g[3]);
    r(d, x + bx + 1, y - hh + 1, 1, hh - 1, g[0]);
  }
}

function pebble(d, x, y) {
  r(d, x, y, 3, 2, '#9a8f80'); px(d, x, y, '#c9bfae'); px(d, x + 2, y + 1, '#776d60');
}

function rock(d, x, y, v) {
  const p = ['#5f646c', '#7c828b', '#979da5', '#b9bec4'];
  disc(d, x + 8, y + 10, 6, 4, p[1]);
  disc(d, x + 7, y + 9, 5, 3, p[2]);
  r(d, x + 4, y + 7, 4, 2, p[3]); px(d, x + 5, y + 6, p[3]);
  r(d, x + 4, y + 13, 9, 1, p[0]);
  if (v > 0.5) { r(d, x + 9, y + 7, 3, 1, '#6c9a3c'); px(d, x + 10, y + 6, '#86b84a'); }
}

function lilypad(d, x, y, v) {
  disc(d, x + 4, y + 3, 4, 2, '#3f8f3a'); r(d, x + 4, y + 1, 2, 2, '#4aa2d6'); r(d, x + 1, y + 2, 3, 1, '#5fb04a');
  if (v > 0.95) { r(d, x + 2, y, 3, 2, '#f5a3c7'); px(d, x + 3, y, '#ffd8ea'); }
}

const WOOD = ['#5a3519', '#7a4c27', '#9b6436', '#bb8250', '#d6a26d'];
function post(d, x, y, h = 13) {
  r(d, x, y + 1, 4, h, WOOD[2]); r(d, x, y + 1, 1, h, WOOD[3]); r(d, x + 3, y + 1, 1, h, WOOD[1]);
  r(d, x + 1, y, 2, 1, WOOD[3]); r(d, x, y + 1, 4, 1, WOOD[4]);
  r(d, x + 1, y + h - 3, 2, 1, WOOD[1]);
}
function fence(d, x, y, tile, tx, ty) {
  const f = (t) => t === T.FENCE || t === T.GATE;
  const horiz = f(tile(tx - 1, ty)) || f(tile(tx + 1, ty));
  const vert = f(tile(tx, ty - 1)) && f(tile(tx, ty + 1));
  if (horiz) {
    for (const ry of [5, 9]) { r(d, x, y + ry, TILE, 2, WOOD[2]); r(d, x, y + ry, TILE, 1, WOOD[3]); r(d, x, y + ry + 2, TILE, 1, WOOD[0]); }
  }
  if (vert) { r(d, x + 6, y, 2, TILE, WOOD[2]); px(d, x + 6, y, WOOD[3]); r(d, x + 8, y, 1, TILE, WOOD[0]); }
  post(d, x + 6, y + 1);
}
function gatePost(d, x, y, fenceOnLeft) {
  const gx = fenceOnLeft ? x : x + 11;
  r(d, gx, y, 5, 15, WOOD[2]); r(d, gx, y, 1, 15, WOOD[3]); r(d, gx + 4, y, 1, 15, WOOD[1]);
  r(d, gx - 1, y - 2, 7, 3, WOOD[3]); r(d, gx - 1, y - 2, 7, 1, WOOD[4]);
}

function fountain(d, x, y) {
  const s = ['#7d776b', '#9a9384', '#b6af9f', '#d3cdbf', '#e9e4d8'];
  disc(d, x + 32, y + 36, 30, 24, s[0]);
  disc(d, x + 32, y + 34, 30, 24, s[2]);
  disc(d, x + 32, y + 33, 28, 21, s[3]);
  disc(d, x + 32, y + 35, 25, 18, '#2f7abb');
  disc(d, x + 32, y + 36, 24, 16, '#3a8cc9');
  disc(d, x + 30, y + 33, 18, 10, '#4aa2d6');
  for (let i = 0; i < 9; i++) r(d, x + 12 + i * 5, y + 30 + (i % 3) * 5, 3, 1, '#8cd0ec');
  r(d, x + 4, y + 48, 56, 2, s[1]);
  r(d, x + 27, y + 24, 10, 20, s[1]); r(d, x + 27, y + 24, 3, 20, s[3]); r(d, x + 35, y + 24, 2, 20, s[0]);
  disc(d, x + 32, y + 22, 11, 4, s[1]); disc(d, x + 32, y + 21, 10, 3, s[3]); disc(d, x + 32, y + 21, 7, 2, '#4aa2d6');
  r(d, x + 30, y + 11, 4, 10, s[2]); r(d, x + 30, y + 11, 1, 10, s[4]);
  disc(d, x + 32, y + 11, 3, 2, s[3]); px(d, x + 31, y + 10, s[4]);
}

// ---------- trees ----------
const LEAF = {
  oak: ['#1f4f22', '#2d6a2c', '#3f8a35', '#58a842', '#7cc457'],
  oak2: ['#1d4a2b', '#285f35', '#367a40', '#4b9850', '#6db86a'],
  blossom: ['#7d3c62', '#a65384', '#cf78a8', '#eba2c8', '#ffd2e8'],
  pine: ['#163d2c', '#1f5238', '#2a6a45', '#3c8656', '#5aa86c'],
  // fall colours
  maple: ['#6a1e14', '#9a2e1c', '#c8462a', '#e8703a', '#f8a25a'],
  amber: ['#6e3a10', '#a35a16', '#d6861e', '#f0ae3a', '#ffd46a'],
  gold: ['#6a5a14', '#9a8420', '#c8ac2e', '#e6cc4a', '#fbe680'],
};
const BARK = ['#3f2615', '#5a3a1e', '#7a5030', '#98673f'];

function trunk(c) {
  r(c, 5, -4, 7, 18, BARK[2]); r(c, 5, -4, 2, 18, BARK[3]); r(c, 10, -4, 2, 18, BARK[1]);
  r(c, 7, 2, 1, 4, BARK[1]); r(c, 8, 8, 1, 3, BARK[1]);
  r(c, 2, 12, 4, 3, BARK[2]); r(c, 2, 12, 2, 1, BARK[3]); r(c, 11, 12, 4, 3, BARK[2]); r(c, 13, 14, 2, 1, BARK[1]);
  r(c, 5, 14, 7, 1, BARK[1]);
}

function canopy(c, pal, blobs, seed) {
  for (const [x, y, rad] of blobs) disc(c, x, y + 2, rad, rad, pal[0]);
  for (const [x, y, rad] of blobs) disc(c, x, y, rad, rad, pal[1]);
  for (const [x, y, rad] of blobs) disc(c, x - 1, y - 1, rad - 2, rad - 2, pal[2]);
  for (const [x, y, rad] of blobs) disc(c, x - 2, y - 3, Math.max(1, rad - 5), Math.max(1, rad - 5), pal[3]);
  for (let i = 0; i < 46; i++) {
    const [bx, by, rad] = blobs[i % blobs.length];
    const a = tileHash(i, seed) * Math.PI * 2, dist = tileHash(seed, i) * (rad - 2);
    const lx = Math.round(bx + Math.cos(a) * dist), ly = Math.round(by + Math.sin(a) * dist);
    if (ly < by - 1) { r(c, lx, ly, 2, 1, pal[4]); px(c, lx, ly + 1, pal[3]); }
    else { r(c, lx, ly, 2, 1, pal[0]); px(c, lx + 1, ly - 1, pal[1]); }
  }
}

function paintTree(c, kind, v) {
  if (kind === 'pine') {
    r(c, 6, 2, 5, 12, BARK[2]); r(c, 6, 2, 1, 12, BARK[3]); r(c, 4, 13, 9, 2, BARK[1]);
    const p = LEAF.pine;
    for (let i = 0; i < 4; i++) {
      const top = -34 + i * 9, half = 5 + i * 3;
      for (let j = 0; j < 12; j++) {
        const w = Math.round((half * j) / 11);
        r(c, 8 - w, top + j, w * 2 + 1, 1, p[1]);
        r(c, 8 - w, top + j, Math.max(1, Math.round(w * 0.6)), 1, p[2]);
        px(c, 8 - w, top + j, p[3]);
        r(c, 8 + w - 1, top + j, 2, 1, p[0]);
      }
      r(c, 8 - half, top + 11, half * 2 + 1, 1, p[0]);
    }
    px(c, 8, -35, p[4]);
    return;
  }
  trunk(c);
  const blobs = v > 0.5
    ? [[0, -8, 9], [16, -8, 9], [8, -18, 11], [3, 0, 7], [13, 0, 7], [8, -8, 11]]
    : [[-1, -10, 8], [17, -10, 8], [8, -20, 10], [2, -2, 7], [14, -2, 7], [8, -9, 11], [8, -28, 6]];
  canopy(c, LEAF[kind], blobs, Math.floor(v * 1000));
  if (kind === 'oak' && v > 0.85) for (const [ax, ay] of [[2, -6], [13, -12], [7, 0], [16, -2]]) { r(c, ax, ay, 2, 2, '#d8402f'); px(c, ax, ay, '#ff8a6a'); }
}

export const treeKind = (variant) => (variant < 0.42 ? 'oak' : variant < 0.78 ? 'oak2' : variant < 0.94 ? 'pine' : 'blossom');

// Baked tree sprite (anchor = tile top-left). Exposed for the 3D view's billboards.
export function treeSprite(variant, kind = treeKind(variant)) {
  const v = Math.floor(variant * 8) / 8;
  return bake(`tree|${kind}|${v}`, 12, 40, 42, 58, (cc) => paintTree(cc, kind, v));
}

// variant 0..1 chooses the species; x, y = tile top-left.
export function drawTree(c, x, y, variant) {
  shadow(c, x + 8, y + 14, 13, 4);
  blit(c, treeSprite(variant), x, y);
}

// ---------- floors ----------
export const FLOOR = {
  floor_wood(c, x, y, lx, ly) {
    const p = ['#8a5a32', '#a8703f', '#bb8250', '#cf9a63'];
    for (let i = 0; i < 4; i++) {
      const col = p[1 + ((lx * 3 + ly * 5 + i) % 3)];
      r(c, x, y + i * 4, TILE, 4, col); r(c, x, y + i * 4, TILE, 1, lt(col, 0.18)); r(c, x, y + i * 4 + 3, TILE, 1, p[0]);
      r(c, x + ((lx * 7 + i * 5) % 13) + 1, y + i * 4, 1, 3, p[0]);
    }
  },
  floor_tile(c, x, y) {
    r(c, x, y, TILE, TILE, '#dfe7ea');
    for (const [ox, oy] of [[0, 0], [8, 0], [0, 8], [8, 8]]) { r(c, x + ox, y + oy, 7, 7, '#eef3f5'); r(c, x + ox, y + oy, 7, 1, '#ffffff'); r(c, x + ox + 6, y + oy, 1, 7, '#c8d3d8'); }
  },
  floor_checker(c, x, y, lx, ly) {
    const dark = (lx + ly) % 2;
    r(c, x, y, TILE, TILE, dark ? '#2f3542' : '#eceef3');
    r(c, x, y, TILE, 1, dark ? '#454c5c' : '#ffffff'); r(c, x + 15, y, 1, TILE, dark ? '#232833' : '#cfd3dc');
  },
  floor_red(c, x, y, lx, ly) { carpet(c, x, y, lx, ly, ['#7d2530', '#9e2f3b', '#b33b44', '#c95560', '#e6b450']); },
  floor_blue(c, x, y, lx, ly) { carpet(c, x, y, lx, ly, ['#223a6b', '#2f4d88', '#3d5a98', '#5574b5', '#e6d6a0']); },
  floor_stone(c, x, y, lx, ly) {
    r(c, x, y, TILE, TILE, '#5aa63b');
    const o = (lx + ly) % 2;
    for (const [sx, sy, w, h] of [[1, 1 + o, 7, 6], [9, 2 - o, 6, 5], [3, 9, 8, 6], [12, 9, 3, 4]]) {
      r(c, x + sx, y + sy, w, h, '#b6ae9f'); r(c, x + sx, y + sy, w, 1, '#d6d0c3'); r(c, x + sx, y + sy + h - 1, w, 1, '#857d6e');
    }
  },
  soil(c, x, y, lx, ly) {
    r(c, x, y, TILE, TILE, '#6b4527');
    for (let i = 0; i < 4; i++) { r(c, x + 1, y + i * 4 + 1, 14, 2, '#5a391f'); r(c, x + 1, y + i * 4 + 3, 14, 1, '#7d5432'); }
    r(c, x, y, TILE, 1, '#4a2e18'); r(c, x, y + 15, TILE, 1, '#8a6040');
    if ((lx + ly) % 3 === 0) px(c, x + 5, y + 6, '#9a7050');
  },
};
function carpet(c, x, y, lx, ly, p) {
  r(c, x, y, TILE, TILE, p[2]);
  for (let i = 0; i < TILE; i += 2) px(c, x + i + (ly % 2), y + ((lx * 3 + i) % 16), p[1]);
  r(c, x + 4, y + 4, 8, 8, p[1]); r(c, x + 6, y + 6, 4, 4, p[4]); r(c, x + 7, y + 7, 2, 2, p[3]);
}

export function drawFloor(c, type, x, y, lx = 0, ly = 0) {
  const s = bake(`floor|${type}|${lx % 4}|${ly % 4}`, 0, 0, TILE, TILE, (cc) => (FLOOR[type] || FLOOR.floor_wood)(cc, 0, 0, lx % 4, ly % 4), false);
  blit(c, s, x, y);
}

// ---------- walls ----------
const WALLS = {
  wall_wood: { face: ['#6b4424', '#8a5a32', '#a8703f', '#c58c55'], kind: 'plank' },
  wall_brick: { face: ['#6e2c20', '#93402e', '#b0533c', '#cc7357'], kind: 'brick' },
  wall_white: { face: ['#b8ab92', '#d6cbb4', '#ece4d2', '#fbf6ea'], kind: 'plaster' },
  window: { face: ['#b8ab92', '#d6cbb4', '#ece4d2', '#fbf6ea'], kind: 'plaster' },
  door: { face: ['#b8ab92', '#d6cbb4', '#ece4d2', '#fbf6ea'], kind: 'plaster' },
};
const TRIM = ['#3f2615', '#5a3a1e', '#7a5030', '#98673f'];

function paintWall(c, t, short, nb) {
  const { face: f, kind } = WALLS[t];
  const top = short ? 6 : -14, hgt = 16 - top;
  r(c, 0, top, TILE, hgt, f[2]);
  if (kind === 'plank') {
    for (let i = 0; i < TILE; i += 4) { r(c, i, top + 3, 1, hgt - 3, f[1]); r(c, i + 1, top + 3, 1, hgt - 3, f[3]); }
    for (let i = 0; i < 4; i++) px(c, (i * 5 + 2) % 15, top + 6 + i * 5, f[0]);
  } else if (kind === 'brick') {
    for (let row = 0, yy = top + 3; yy < 16; row++, yy += 4) {
      r(c, 0, yy, TILE, 1, f[0]);
      for (let bx = row % 2 ? -4 : 0; bx < TILE; bx += 8) {
        r(c, bx, yy + 1, 1, 3, f[0]); r(c, bx + 1, yy + 1, 6, 1, f[3]);
        if (tileHash(bx + 20, yy) > 0.7) r(c, bx + 2, yy + 2, 4, 2, f[1]);
      }
    }
  } else {
    r(c, 0, top + 3, TILE, 2, TRIM[2]); r(c, 0, top + 3, TILE, 1, TRIM[3]);
    if (!short) { r(c, 2, top + 5, 1, hgt - 9, f[3]); px(c, 9, top + 12, f[1]); px(c, 12, top + 20, f[1]); }
  }
  r(c, 0, 13, TILE, 3, kind === 'plaster' ? TRIM[2] : f[0]); r(c, 0, 13, TILE, 1, kind === 'plaster' ? TRIM[3] : f[1]);
  r(c, 0, top, TILE, 3, TRIM[1]); r(c, 0, top, TILE, 1, TRIM[3]);
  if (!nb.l) { r(c, 0, top, 1, hgt, TRIM[0]); r(c, 1, top + 3, 1, hgt - 6, f[3]); }
  if (!nb.r) { r(c, 15, top, 1, hgt, TRIM[0]); r(c, 14, top + 3, 1, hgt - 6, f[1]); }
  r(c, 0, top - 1, TILE, 1, TRIM[0]); r(c, 0, 15, TILE, 1, TRIM[0]);
  if (t === 'window') {
    const wy = short ? 9 : -6;
    const wh = short ? 3 : 12;
    r(c, 2, wy - 1, 12, wh + 2, TRIM[1]); r(c, 3, wy, 10, wh, '#7cc4e8'); r(c, 3, wy, 10, 1, '#4f8fb8');
    if (!short) {
      for (let i = 0; i < 4; i++) px(c, 4 + i, wy + 4 - i, '#e2f6ff');
      r(c, 7, wy, 2, wh, TRIM[2]); r(c, 3, wy + 5, 10, 1, TRIM[2]);
      r(c, 0, wy - 1, 2, wh + 2, '#4f7f4a'); r(c, 14, wy - 1, 2, wh + 2, '#4f7f4a'); r(c, 0, wy - 1, 1, wh + 2, '#6fa060');
      r(c, 2, wy + wh + 1, 12, 2, TRIM[3]); r(c, 3, wy + wh + 3, 2, 2, '#e9668a'); r(c, 7, wy + wh + 3, 2, 2, '#f5c542'); r(c, 11, wy + wh + 3, 2, 2, '#8f7cf0');
    }
  }
  if (t === 'door') {
    if (short) { r(c, 2, 10, 12, 6, '#5a391f'); r(c, 2, 15, 12, 1, TRIM[3]); return; }
    r(c, 1, -9, 14, 25, TRIM[1]); r(c, 2, -8, 12, 24, '#9b6436'); r(c, 2, -8, 1, 24, '#bb8250');
    for (let i = 4; i < 13; i += 4) r(c, 2 + i, -8, 1, 24, '#7a4c27');
    r(c, 4, -6, 8, 5, '#6a9fc0'); r(c, 4, -6, 8, 1, '#4f7f9f'); px(c, 5, -5, '#d8f0ff');
    r(c, 11, 4, 2, 2, '#f5c542'); px(c, 11, 4, '#fff1a8');
    r(c, 0, 15, TILE, 1, '#7a4c27');
  }
}

function drawWall(c, t, x, y, short, nb = {}) {
  blit(c, bake(`wall|${t}|${short ? 1 : 0}|${nb.l ? 1 : 0}${nb.r ? 1 : 0}`, 0, 16, TILE, 32, (cc) => paintWall(cc, t, short, nb), false), x, y);
}

// ---------- crops ----------
const CROP = {
  turnip: { leaf: ['#2d6a2c', '#3f8a35', '#5aa842', '#86cc5a'], fruit: ['#e8dcef', '#f8f2fa', '#a35ab5'] },
  carrot: { leaf: ['#2d6a2c', '#3f8a35', '#5aa842', '#86cc5a'], fruit: ['#c25e17', '#f28a2e', '#ffb15e'] },
  berry: { leaf: ['#235a2a', '#327a35', '#45973f', '#6cbd56'], fruit: ['#a3192a', '#e33b4a', '#ff8a95'] },
  pumpkin: { leaf: ['#2d5a24', '#3d7a30', '#55993f', '#7cbc55'], fruit: ['#b8561a', '#f0882a', '#ffb260'] },
};

function paintCrop(c, type, s) {
  const { leaf: L, fruit: F } = CROP[type];
  if (s === 0) { r(c, 7, 9, 2, 4, L[1]); r(c, 5, 8, 2, 2, L[2]); r(c, 9, 7, 2, 2, L[3]); return; }
  if (s === 1) {
    r(c, 7, 5, 2, 8, L[1]);
    disc(c, 5, 7, 3, 2, L[2]); disc(c, 11, 6, 3, 2, L[2]); px(c, 4, 6, L[3]); px(c, 10, 5, L[3]);
    return;
  }
  const leaves = (y0) => {
    disc(c, 4, y0 + 3, 4, 3, L[1]); disc(c, 12, y0 + 3, 4, 3, L[1]); disc(c, 8, y0, 4, 4, L[2]);
    disc(c, 3, y0 + 2, 2, 1, L[3]); disc(c, 7, y0 - 2, 2, 1, L[3]); r(c, 7, y0 + 3, 2, 8, L[0]);
  };
  if (s === 2) { leaves(3); return; }
  if (type === 'pumpkin') {
    disc(c, 3, 4, 3, 2, L[2]); disc(c, 13, 3, 3, 2, L[2]);
    disc(c, 8, 9, 7, 5, F[0]); disc(c, 8, 8, 7, 5, F[1]);
    r(c, 5, 4, 1, 9, F[0]); r(c, 10, 4, 1, 9, F[0]); r(c, 3, 6, 2, 3, F[2]); r(c, 7, 4, 2, 2, F[2]);
    r(c, 7, 1, 2, 4, '#5a6a2a'); px(c, 7, 1, '#7a8a3a');
  } else if (type === 'berry') {
    leaves(2);
    for (const [bx, by] of [[3, 8], [10, 6], [6, 11], [12, 10]]) { r(c, bx, by, 3, 3, F[1]); px(c, bx, by, F[2]); px(c, bx + 1, by + 2, F[0]); px(c, bx + 1, by - 1, L[3]); }
  } else {
    r(c, 4, 1, 2, 6, L[2]); r(c, 7, 0, 2, 7, L[1]); r(c, 10, 2, 2, 5, L[2]); px(c, 7, 0, L[3]); px(c, 4, 1, L[3]);
    disc(c, 8, 10, 4, 4, F[1]); r(c, 5, 8, 2, 3, F[2]); r(c, 7, 14, 2, 2, F[0]);
    if (type === 'turnip') { disc(c, 8, 8, 4, 2, F[2]); px(c, 6, 7, '#c88ad8'); }
    else { r(c, 6, 12, 4, 2, F[0]); px(c, 9, 9, F[0]); px(c, 7, 11, F[0]); }
  }
}

export function cropSprite(type, stage) {
  return bake(`crop|${type}|${stage}`, 2, 4, 20, 22, (cc) => paintCrop(cc, type, stage));
}

function drawCrop(c, o, x, y, now) {
  const s = cropStage(o, now);
  blit(c, cropSprite(ITEMS[o.t].crop, s), x, y);
  if (s === 3 && Math.floor(now / 400) % 3 === 0) { r(c, x + 13, y, 1, 3, '#fff'); r(c, x + 12, y + 1, 3, 1, '#fff'); }
}

// ---------- furniture ----------
const W8 = ['#4a2e18', '#6b4424', '#8a5a32', '#a8703f', '#c99363'];
const bricks = (c, x, y, w, h) => {
  for (let j = 0; j < h; j += 4) { r(c, x, y + j, w, 1, '#6c7079'); for (let i = (j / 4) % 2 ? 0 : 4; i < w; i += 8) r(c, x + i, y + j, 1, 4, '#6c7079'); }
};

// Single-tile items. now is a synthetic time for animation frames.
const OBJ = {
  lamp(c) {
    r(c, 4, 13, 8, 3, W8[1]); r(c, 4, 13, 8, 1, W8[3]); r(c, 7, 2, 2, 11, W8[2]); px(c, 7, 2, W8[4]);
    r(c, 2, -5, 12, 8, '#f3dc94'); r(c, 3, -6, 10, 1, '#f3dc94'); r(c, 2, -5, 3, 8, '#fff2c4'); r(c, 11, -5, 3, 8, '#d8bd6a'); r(c, 2, 2, 12, 1, '#b89c4f');
  },
  bookshelf(c) {
    r(c, 0, -12, 16, 28, W8[2]); r(c, 0, -13, 16, 2, W8[4]); r(c, 0, -12, 1, 28, W8[3]); r(c, 15, -12, 1, 28, W8[1]); r(c, 1, -10, 14, 25, '#9b6a3e');
    const cols = ['#d9534f', '#4a90d9', '#5cb85c', '#f0ad4e', '#9b59b6', '#f4f1ea', '#e67e22', '#3fb5a3'];
    for (let s = 0; s < 3; s++) {
      r(c, 1, -2 + s * 8, 14, 2, W8[2]); r(c, 1, -2 + s * 8, 14, 1, W8[3]);
      let bx = 2;
      for (let b = 0; b < 6 && bx < 14; b++) {
        const w = 1 + ((b + s) % 2), h = 5 + ((b * 3 + s) % 2);
        const col = cols[(b + s * 3) % cols.length];
        r(c, bx, -2 + s * 8 - h, w, h, col); px(c, bx, -2 + s * 8 - h, lt(col, 0.4)); bx += w + (b % 3 === 2 ? 1 : 0);
      }
    }
  },
  fridge(c) {
    r(c, 3, -18, 4, 5, '#cfe8f2'); r(c, 3, -18, 4, 1, '#d9534f'); r(c, 4, -16, 2, 2, '#c9934c');
    r(c, 9, -16, 4, 3, '#c96f4a'); disc(c, 11, -18, 3, 2, '#5aa842'); px(c, 10, -19, '#86cc5a');
    r(c, 2, 15, 12, 1, '#2f3542');
    r(c, 1, -13, 14, 28, '#9fd8c4'); r(c, 2, -14, 12, 1, '#b4e4d3'); r(c, 1, -13, 3, 28, '#c4eadc'); r(c, 13, -13, 2, 28, '#7fbfaa');
    r(c, 1, -3, 14, 1, '#6fae99'); r(c, 11, -10, 2, 5, '#e3eaee'); r(c, 11, 0, 2, 7, '#e3eaee'); r(c, 12, -10, 1, 5, '#aab4ba'); r(c, 12, 0, 1, 7, '#aab4ba');
    r(c, 6, -12, 4, 1, '#e3eaee');
    r(c, 4, -9, 4, 4, '#ffffff'); r(c, 5, -8, 2, 2, '#f5c542'); r(c, 4, 2, 2, 2, '#e9668a'); r(c, 7, 4, 2, 2, '#4a90d9');
  },
  stove(c) {
    r(c, 0, -5, 16, 5, '#f2e6c9'); r(c, 0, -5, 16, 1, '#c9d2d8'); r(c, 6, -4, 4, 3, '#ffffff');
    r(c, 0, 0, 16, 16, '#e6d7b4'); r(c, 1, 0, 14, 16, '#f2e6c9'); r(c, 0, 0, 16, 6, '#3a3e46'); r(c, 0, 0, 16, 1, '#4a5058');
    for (const bx of [2, 9]) { disc(c, bx + 2, 3, 2, 1, '#5a6068'); }
    px(c, 11, 3, '#ff7a3a'); r(c, 2, -1, 5, 4, '#d9534f'); r(c, 1, -2, 7, 1, '#e8706b');
    for (const kx of [2, 5, 10, 13]) px(c, kx, 7, '#3a3e46');
    r(c, 2, 9, 12, 6, '#f7eed8'); r(c, 4, 10, 8, 3, '#2c3036'); r(c, 4, 10, 3, 1, '#4a5058'); r(c, 3, 9, 10, 1, '#c9d2d8'); r(c, 0, 6, 16, 1, '#fffaf0');
  },
  counter(c) {
    r(c, 0, 1, 16, 15, W8[2]); r(c, 0, 1, 16, 5, '#e6e1d6'); r(c, 0, 1, 16, 1, '#fffbf2'); r(c, 0, 5, 16, 1, '#a39d90');
    r(c, 7, 7, 2, 8, W8[1]); r(c, 3, 9, 1, 3, '#d6be6c'); r(c, 12, 9, 1, 3, '#d6be6c'); r(c, 0, 15, 16, 1, W8[0]);
  },
  dresser(c) {
    r(c, 0, -4, 16, 20, W8[2]); r(c, 0, -4, 16, 2, W8[4]); r(c, 0, -4, 1, 20, W8[3]); r(c, 15, -4, 1, 20, W8[1]);
    for (let i = 0; i < 3; i++) { r(c, 2, -1 + i * 5, 12, 4, W8[3]); r(c, 2, -1 + i * 5 + 3, 12, 1, W8[1]); r(c, 7, i * 5, 2, 1, '#f5c542'); }
    r(c, 4, -8, 3, 4, '#e9668a'); r(c, 5, -9, 1, 1, '#3f8a35');
  },
  houseplant(c) {
    r(c, 3, 9, 10, 7, '#a9532f'); r(c, 3, 9, 10, 2, '#cd7349'); r(c, 3, 9, 2, 7, '#c56a43'); r(c, 4, 15, 8, 1, '#7a3a1f');
    disc(c, 8, 3, 7, 6, '#2d6a2c'); disc(c, 7, 2, 6, 5, '#3f8a35'); disc(c, 5, 0, 3, 2, '#5aa842'); disc(c, 11, -2, 2, 2, '#58a842'); px(c, 4, -1, '#86cc5a');
  },
  flowerbed(c) {
    r(c, 0, 3, 16, 12, '#7a4f2b'); r(c, 1, 4, 14, 10, '#5a391f'); r(c, 0, 3, 16, 1, '#a8703f');
    const cols = [['#e9668a', '#ff9db8'], ['#f5c542', '#ffe58a'], ['#8f7cf0', '#b9adff'], ['#f6f0de', '#fff']];
    for (let i = 0; i < 6; i++) {
      const fx = 3 + (i % 3) * 5, fy = 6 + Math.floor(i / 3) * 4;
      r(c, fx, fy + 1, 1, 3, '#3f8a35');
      const [a, b] = cols[i % 4];
      r(c, fx - 1, fy, 3, 2, a); px(c, fx - 1, fy, b);
    }
  },
  bush(c) {
    disc(c, 8, 6, 8, 7, '#2d6a2c'); disc(c, 7, 5, 7, 6, '#3f8a35'); disc(c, 5, 2, 4, 3, '#58a842'); disc(c, 4, 1, 2, 1, '#7cc457');
    for (const [fx, fy] of [[3, 7], [11, 3], [9, 9], [13, 7]]) { r(c, fx, fy, 2, 2, '#f0a8cf'); px(c, fx, fy, '#ffe0f0'); }
  },
  sapling(c) {
    r(c, 6, 2, 4, 13, BARK[2]); r(c, 6, 2, 1, 13, BARK[3]); r(c, 4, 13, 8, 2, BARK[1]);
    canopy(c, LEAF.oak, [[8, -6, 7], [3, -1, 5], [13, -1, 5], [8, 1, 6]], 77);
  },
  picket(c) {
    r(c, 0, 5, 16, 2, '#e8e2d4'); r(c, 0, 10, 16, 2, '#e8e2d4'); r(c, 0, 7, 16, 1, '#b8b0a0'); r(c, 0, 12, 16, 1, '#b8b0a0');
    for (const bx of [1, 6, 11]) { r(c, bx, 1, 4, 14, '#fbf9f4'); r(c, bx + 1, 0, 2, 1, '#fbf9f4'); r(c, bx + 3, 1, 1, 14, '#cfc8b8'); px(c, bx, 1, '#ffffff'); }
  },
  lamppost(c) {
    r(c, 4, 12, 8, 4, '#2f3542'); r(c, 4, 12, 8, 1, '#4f5866'); r(c, 7, -8, 2, 20, '#2f3542'); px(c, 7, -8, '#4f5866');
    r(c, 3, -16, 10, 9, '#2f3542'); r(c, 4, -15, 8, 7, '#ffe8a3'); r(c, 4, -15, 3, 7, '#fff6cf'); r(c, 2, -17, 12, 2, '#3c4452'); px(c, 7, -19, '#3c4452'); px(c, 8, -19, '#3c4452');
  },
  mailbox(c) {
    r(c, 7, 6, 2, 10, W8[1]); r(c, 7, 6, 1, 10, W8[3]);
    r(c, 2, -2, 12, 9, '#3d6fb5'); r(c, 2, -3, 12, 2, '#5585cc'); r(c, 2, -2, 2, 9, '#5585cc'); r(c, 12, -2, 2, 9, '#2c5590'); r(c, 4, 2, 6, 3, '#2c5590');
    r(c, 13, -6, 1, 6, '#e74c3c'); r(c, 13, -6, 3, 3, '#e74c3c'); px(c, 13, -6, '#ff8a7a');
  },
  scarecrow(c) {
    r(c, 7, -6, 2, 22, W8[1]); r(c, 0, -1, 16, 2, W8[2]); r(c, 0, -1, 16, 1, W8[3]);
    r(c, 3, -2, 10, 10, '#3d6fb5'); r(c, 3, -2, 2, 10, '#5585cc'); r(c, 6, 0, 4, 6, '#2c5590'); r(c, 3, 7, 3, 2, '#e8c97a'); r(c, 10, 7, 3, 2, '#e8c97a');
    disc(c, 8, -9, 4, 4, '#e8c97a'); r(c, 6, -10, 1, 2, '#2a1a12'); r(c, 10, -10, 1, 2, '#2a1a12'); r(c, 7, -7, 3, 1, '#a85a30');
    r(c, 1, -13, 14, 2, '#c9a24c'); r(c, 1, -13, 14, 1, '#e8c97a'); r(c, 4, -18, 8, 5, '#c9a24c'); r(c, 4, -18, 8, 1, '#e8c97a'); r(c, 4, -14, 8, 1, '#c0392b');
  },
  grandclock(c, now) {
    r(c, 2, -18, 12, 34, W8[1]); r(c, 2, -18, 12, 2, W8[3]); r(c, 2, -18, 2, 34, W8[3]); r(c, 12, -18, 2, 34, W8[0]);
    disc(c, 8, -10, 4, 4, '#f4f1ea'); px(c, 8, -13, '#2a1a12'); r(c, 8, -12, 1, 3, '#2a1a12'); r(c, 8, -10, 3, 1, '#2a1a12');
    r(c, 5, -4, 6, 16, '#2c1a0e'); r(c, 5, -4, 6, 1, W8[3]);
    const sw = Math.round(Math.sin(now / 400) * 2);
    r(c, 8 + sw, -3, 1, 9, '#d6be6c'); disc(c, 8 + sw, 8, 2, 2, '#f5c542');
    r(c, 1, 13, 14, 3, W8[0]); r(c, 3, -21, 10, 3, W8[2]); r(c, 6, -23, 4, 2, W8[3]);
  },
  telescope(c) {
    r(c, 3, 6, 1, 10, W8[1]); r(c, 12, 6, 1, 10, W8[1]); r(c, 7, 6, 2, 10, W8[1]); r(c, 5, 5, 6, 2, W8[2]);
    for (let i = 0; i < 9; i++) { r(c, 2 + i, 5 - i, 4, 3, '#c9a24c'); px(c, 2 + i, 5 - i, '#f0d68a'); }
    r(c, 10, -6, 5, 5, '#9a7a2c'); r(c, 11, -5, 3, 3, '#4a6a8a'); px(c, 11, -5, '#bfe4ff'); r(c, 0, 5, 3, 3, '#7a5f22');
  },
  petbed(c) {
    disc(c, 8, 10, 7, 5, '#7a4a2a'); disc(c, 8, 9, 7, 5, '#a8703f'); disc(c, 8, 10, 5, 3, '#d9534f'); disc(c, 7, 9, 3, 2, '#f08a7a');
  },
  endtable(c) {
    r(c, 7, 7, 2, 8, W8[2]); r(c, 7, 7, 1, 8, W8[3]); r(c, 4, 14, 8, 2, W8[1]); r(c, 4, 14, 8, 1, W8[3]);
    disc(c, 8, 6, 7, 3, W8[2]); disc(c, 8, 4, 7, 3, W8[4]); disc(c, 7, 3, 4, 1, '#e0b07a');
    r(c, 3, 1, 4, 3, '#7fb9ad'); r(c, 3, 1, 4, 1, '#a8dccf'); px(c, 7, 2, '#7fb9ad');
    r(c, 9, 0, 4, 4, '#c96f4a'); r(c, 9, 0, 1, 4, '#e08a62'); disc(c, 11, -2, 3, 2, '#3f8a35'); px(c, 10, -3, '#5aa842'); px(c, 12, -4, '#5aa842');
  },
  beanbag(c) {
    disc(c, 8, 10, 7, 5, '#c47f24'); disc(c, 8, 9, 7, 5, '#e8a33a'); disc(c, 8, 3, 6, 4, '#e8a33a');
    disc(c, 6, 2, 3, 2, '#f6c470'); disc(c, 9, 10, 4, 2, '#d48a2a'); px(c, 4, 6, '#f6c470'); r(c, 3, 13, 10, 1, '#b06e1c');
  },
  floorvase(c) {
    for (const [x, top, lean] of [[4, -16, -1], [8, -19, 0], [12, -15, 1], [6, -12, 0], [10, -13, 1]]) {
      r(c, x, top + 6, 1, 4 - top, '#b8a07a'); disc(c, x + lean, top + 2, 2, 4, '#e8d6b0'); r(c, x + lean - 1, top - 1, 2, 5, '#f7ecd4');
    }
    disc(c, 8, 10, 5, 5, '#a85a38'); disc(c, 8, 10, 4, 5, '#c96f4a'); r(c, 6, 3, 4, 3, '#c96f4a'); r(c, 5, 2, 6, 2, '#d8875f');
    r(c, 4, 9, 8, 1, '#f0d9a8'); r(c, 5, 6, 1, 6, '#e08a62'); r(c, 6, 15, 4, 1, '#8a4a2c');
  },
  candles(c) {
    r(c, 1, 12, 14, 3, '#c9a24c'); r(c, 1, 12, 14, 1, '#e8c86a'); r(c, 2, 15, 12, 1, '#9a7a2c');
    r(c, 2, 2, 4, 10, '#f4ecd8'); r(c, 2, 2, 1, 10, '#fffaf0'); r(c, 5, 2, 1, 10, '#d9cdb4');
    r(c, 7, 5, 4, 7, '#f0d9a8'); r(c, 7, 5, 1, 7, '#fbecc8'); r(c, 10, 5, 1, 7, '#d4b884');
    r(c, 11, 8, 3, 4, '#f4ecd8'); r(c, 13, 8, 1, 4, '#d9cdb4');
    for (const [x, y] of [[3, 2], [8, 5], [12, 8]]) { r(c, x, y - 4, 2, 3, '#ffb53a'); px(c, x, y - 3, '#fff2b0'); px(c, x, y - 5, '#ffd27a'); px(c, x + 1, y - 1, '#3a2a1a'); }
  },
  monstera(c) {
    r(c, 4, 9, 8, 7, '#efe6d6'); r(c, 4, 9, 2, 7, '#fffaf0'); r(c, 10, 9, 2, 7, '#d9cfbd'); r(c, 3, 8, 10, 2, '#e3d8c4'); r(c, 4, 12, 8, 1, '#c96f4a');
    r(c, 7, 2, 1, 7, '#3d6b2e'); r(c, 5, 0, 1, 5, '#3d6b2e'); r(c, 10, -1, 1, 6, '#3d6b2e');
    const leaf = (x, y, rx, ry, col, hi) => {
      disc(c, x, y, rx, ry, col); r(c, x - rx + 2, y, rx * 2 - 4, 1, hi);
      c.clearRect(x - rx, y - 1, 2, 1); c.clearRect(x + rx - 2, y + 1, 2, 1); c.clearRect(x - rx + 1, y + 2, 1, 1);
    };
    leaf(3, 3, 4, 3, '#2f7a3a', '#5aa842'); leaf(13, 2, 4, 3, '#2f7a3a', '#5aa842');
    leaf(5, -5, 4, 3, '#3f9a45', '#6cc06a'); leaf(12, -7, 4, 3, '#3f9a45', '#6cc06a'); leaf(8, -1, 4, 3, '#43a34c', '#7cd07a');
  },
  pumpkin_deco(c) { pumpkinArt(c, false); },
  jackolantern(c) { pumpkinArt(c, true); },
  cornstalks(c) {
    for (const [x, h, col] of [[3, 20, '#b8963c'], [6, 24, '#d8b65a'], [9, 22, '#c9a24c'], [12, 18, '#a8863a']]) {
      r(c, x, 15 - h, 2, h, col); r(c, x - 2, 15 - h + 6, 2, 1, '#a8863a'); r(c, x + 2, 15 - h + 10, 2, 1, '#c9a24c');
    }
    r(c, 2, 6, 13, 2, '#8a5a2a');
  },
  leafpile(c) {
    disc(c, 8, 11, 7, 4, '#b8562a'); disc(c, 8, 10, 5, 3, '#d6702e');
    for (const [x, y, col] of [[3, 10, '#c8462a'], [7, 8, '#f0ae3a'], [11, 9, '#e8703a'], [5, 12, '#d6861e'], [10, 12, '#9a2e1c'], [8, 10, '#e6cc4a']]) r(c, x, y, 2, 1, col);
  },
  cauldron(c) {
    r(c, 3, 13, 10, 2, '#ff8a2a'); r(c, 5, 13, 6, 1, '#ffd04a');
    disc(c, 8, 7, 7, 6, '#26262c'); r(c, 1, 1, 14, 2, '#3a3a44'); r(c, 2, 1, 12, 1, '#79f26a');
    disc(c, 5, -1, 2, 2, '#b6ff9a'); disc(c, 10, -3, 1, 1, '#d8ffc8'); px(c, 4, 6, '#4a4a56');
  },
  statue(c) {
    r(c, 1, 9, 14, 7, '#a9a294'); r(c, 1, 9, 14, 2, '#d3cdbf'); r(c, 1, 9, 2, 7, '#c5beb0'); r(c, 1, 15, 14, 1, '#7d776b');
    disc(c, 8, -12, 3, 3, '#ece8de'); r(c, 5, -9, 6, 18, '#e3ddd0'); r(c, 5, -9, 2, 18, '#f6f2ea'); r(c, 10, -9, 1, 18, '#bdb6a8');
    r(c, 2, -8, 3, 7, '#e3ddd0'); r(c, 11, -15, 2, 8, '#e3ddd0'); disc(c, 12, -17, 2, 2, '#f5c542');
  },
};

function pumpkinArt(c, carved) {
  disc(c, 8, 9, 7, 6, '#c25e12'); disc(c, 8, 9, 6, 5, '#e8781e'); r(c, 5, 4, 1, 10, '#c25e12'); r(c, 10, 4, 1, 10, '#c25e12'); r(c, 3, 6, 2, 3, '#f39a3a');
  r(c, 7, 0, 2, 4, '#5a6b2a'); r(c, 9, 1, 3, 1, '#6f8f3a');
  if (carved) { r(c, 4, 7, 2, 2, '#ffc23a'); r(c, 10, 7, 2, 2, '#ffc23a'); px(c, 8, 9, '#ffc23a'); r(c, 4, 11, 8, 2, '#ffc23a'); px(c, 6, 11, '#c25e12'); px(c, 9, 12, '#c25e12'); }
}

// Top-down items drawn in their unrotated footprint at (0, 0); rotation turns the drawing.
const TURN = {
  haybale(c) {
    r(c, 1, 2, 30, 13, '#d9b44a'); r(c, 1, 2, 30, 2, '#e8c867'); r(c, 1, 13, 30, 2, '#b8902a');
    for (let x = 3; x < 30; x += 4) r(c, x, 5, 1, 7, '#c9a23e');
    r(c, 8, 2, 2, 13, '#7a4a22'); r(c, 22, 2, 2, 13, '#7a4a22');
  },
  ironfence(c) {
    r(c, 0, 7, 16, 1, '#24242a'); r(c, 0, 11, 16, 1, '#24242a');
    for (const x of [1, 5, 9, 13]) { r(c, x, 4, 1, 10, '#2c2c34'); px(c, x, 3, '#4a4a56'); }
  },
  bed(c) {
    r(c, 0, 0, 16, 32, W8[2]); r(c, 0, -2, 16, 6, W8[3]); r(c, 0, -2, 16, 1, W8[4]); r(c, 2, 0, 12, 3, '#d6a26d');
    r(c, 0, -3, 2, 7, W8[4]); r(c, 14, -3, 2, 7, W8[3]); r(c, 0, 29, 16, 3, W8[3]); r(c, 0, 29, 16, 1, W8[4]);
    r(c, 1, 4, 14, 25, '#f4ecd8');
    r(c, 2, 5, 5, 4, '#ffffff'); r(c, 9, 5, 5, 4, '#ffffff'); r(c, 2, 8, 5, 1, '#d9d4c7'); r(c, 9, 8, 5, 1, '#d9d4c7');
    r(c, 6, 7, 4, 3, '#f5c542'); px(c, 7, 8, '#fbe08a');
    r(c, 1, 11, 14, 18, '#4d79c7'); r(c, 1, 10, 14, 2, '#f4ecd8'); r(c, 1, 28, 14, 1, '#2f5596');
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) if ((i + j) % 2 === 0) r(c, 1 + i * 4 - (i === 3 ? 1 : 0), 12 + j * 4, 3, 3, j % 2 ? '#9cbbf0' : '#7aa2e6');
    r(c, 0, 23, 16, 4, '#e8873a'); r(c, 0, 23, 16, 1, '#f6b26b'); r(c, 0, 25, 16, 1, '#f6b26b');
  },
  table(c) {
    r(c, 0, 1, 32, 14, W8[1]); r(c, 1, 1, 30, 12, W8[3]); r(c, 1, 1, 30, 2, W8[4]); r(c, 1, 12, 30, 1, W8[2]);
    r(c, 4, 5, 6, 5, '#f4f1ea'); r(c, 4, 5, 6, 1, '#ffffff'); r(c, 22, 5, 6, 5, '#f4f1ea'); r(c, 22, 5, 6, 1, '#ffffff');
    disc(c, 16, 7, 2, 2, '#e9668a'); px(c, 15, 6, '#ff9db8'); r(c, 16, 4, 1, 2, '#3f8a35');
  },
  rug(c) {
    r(c, 1, 1, 30, 30, '#c0593e'); r(c, 3, 3, 26, 26, '#f0d9a8'); r(c, 5, 5, 22, 22, '#c0593e'); r(c, 6, 6, 20, 20, '#e8c27a');
    for (let i = 0; i < 8; i++) { r(c, 15 - i, 8 + i, 2 + i * 2, 1, '#2f6d8a'); r(c, 15 - i, 23 - i, 2 + i * 2, 1, '#2f6d8a'); }
    for (let i = 0; i < 4; i++) { r(c, 15 - i, 12 + i, 2 + i * 2, 1, '#f0d9a8'); r(c, 15 - i, 19 - i, 2 + i * 2, 1, '#f0d9a8'); }
    r(c, 15, 15, 2, 2, '#c0593e');
    for (const [x, y] of [[8, 8], [22, 8], [8, 22], [22, 22]]) r(c, x, y, 2, 2, '#2f6d8a');
    for (let i = 2; i < 30; i += 3) { px(c, i, 0, '#f4ecd8'); px(c, i, 31, '#f4ecd8'); }
  },
  bathtub(c) {
    r(c, 3, 14, 2, 2, '#c9a24c'); r(c, 27, 14, 2, 2, '#c9a24c');
    r(c, 1, 2, 30, 13, '#7fa7c9'); r(c, 2, 1, 28, 1, '#ffffff'); r(c, 1, 2, 30, 11, '#ffffff'); r(c, 1, 12, 30, 1, '#d4dbe0'); r(c, 2, 13, 28, 2, '#9cc0dd');
    r(c, 3, 3, 24, 8, '#8fd3ee'); r(c, 3, 3, 24, 2, '#c5ecf8');
    disc(c, 8, 7, 2, 1, '#ffffff'); disc(c, 11, 8, 1, 1, '#ffffff'); px(c, 6, 9, '#ffffff'); disc(c, 22, 8, 1, 1, '#ffffff');
    r(c, 15, 6, 3, 2, '#f5c542'); r(c, 17, 5, 2, 2, '#f5c542'); px(c, 19, 6, '#e8703a');
    r(c, 28, 5, 2, 5, '#c9d2d8'); px(c, 28, 4, '#d9534f'); px(c, 28, 10, '#4a90d9'); r(c, 27, 7, 1, 1, '#e3eaee');
  },
  bench(c) {
    r(c, 1, 2, 30, 12, W8[0]);
    for (let i = 0; i < 3; i++) { r(c, 1, 2 + i * 4, 30, 3, W8[3]); r(c, 1, 2 + i * 4, 30, 1, W8[4]); }
    r(c, 2, 13, 3, 3, '#2f3542'); r(c, 27, 13, 3, 3, '#2f3542');
  },
  bathmat(c) {
    r(c, 2, 4, 12, 9, '#5aa8c0'); r(c, 3, 3, 10, 11, '#5aa8c0'); r(c, 3, 4, 10, 9, '#7fc4d8');
    for (const y of [5, 8, 11]) r(c, 3, y, 10, 1, '#c5ecf8');
    for (const x of [4, 7, 10]) { px(c, x, 2, '#f4f6f7'); px(c, x, 14, '#f4f6f7'); }
  },
  coffeetable(c) {
    r(c, 3, 13, 2, 3, W8[1]); r(c, 27, 13, 2, 3, W8[1]);
    r(c, 1, 2, 30, 12, W8[2]); r(c, 1, 2, 30, 10, W8[3]); r(c, 1, 2, 30, 1, W8[4]); r(c, 2, 3, 12, 1, '#e0b07a');
    r(c, 4, 4, 7, 5, '#d9534f'); r(c, 5, 4, 6, 4, '#3fb5a3'); r(c, 6, 4, 5, 3, '#f5c542'); r(c, 6, 4, 5, 1, '#fbe08a');
    r(c, 14, 6, 3, 3, '#e9668a'); px(c, 17, 7, '#e9668a'); px(c, 14, 6, '#f59ab4');
    r(c, 20, 4, 8, 6, '#c9a24c'); r(c, 21, 5, 2, 3, '#f4ecd8'); r(c, 25, 6, 2, 2, '#f4ecd8'); px(c, 21, 4, '#ffb53a'); px(c, 25, 5, '#ffb53a');
  },
  aquarium(c, now) {
    r(c, 0, 0, 32, 16, '#2c3036'); r(c, 1, 1, 30, 13, '#3fa7d6'); r(c, 1, 1, 30, 3, '#86d2f0');
    r(c, 1, 11, 30, 3, '#e6d39a'); r(c, 6, 10, 3, 2, '#9a9384');
    for (const [kx, kh] of [[5, 6], [8, 4], [23, 7], [26, 5]]) { r(c, kx, 11 - kh, 1, kh, '#2d8a3c'); px(c, kx + 1, 12 - kh, '#4fb05a'); }
    const f = Math.floor(now / 240) % 12;
    r(c, 4 + f * 2, 5, 3, 2, '#f39c12'); px(c, 3 + f * 2, 5, '#f39c12');
    r(c, 26 - f * 2, 8, 3, 2, '#e74c3c'); px(c, 29 - f * 2, 8, '#e74c3c');
    px(c, 12, 3 + (f % 4), '#e2f6ff'); px(c, 20, 2 + ((f + 2) % 5), '#e2f6ff');
  },
};

// Items with front / back / side art. `side` faces left; facing right mirrors it.
const SOFA = ['#2a6458', '#357a6c', '#3f8f7f', '#4fab98', '#7cd0bc'];
const ARM = ['#7a3020', '#a64a33', '#c0593e', '#d8735a', '#f09a7f'];
const FACE = {
  gravestone: {
    down(c) { r(c, 3, 13, 10, 3, '#7d776b'); r(c, 4, 0, 8, 13, '#9a9384'); r(c, 5, -2, 6, 2, '#9a9384'); r(c, 4, 0, 2, 13, '#b6af9f'); r(c, 7, 3, 2, 7, '#5a554c'); r(c, 5, 5, 6, 2, '#5a554c'); px(c, 4, 11, '#5f8a3a'); px(c, 11, 12, '#5f8a3a'); },
    up(c) { r(c, 3, 13, 10, 3, '#7d776b'); r(c, 4, 0, 8, 13, '#8e877a'); r(c, 5, -2, 6, 2, '#8e877a'); },
    side(c) { r(c, 4, 13, 8, 3, '#7d776b'); r(c, 6, -1, 4, 14, '#9a9384'); r(c, 6, -1, 1, 14, '#b6af9f'); },
  },
  chair: {
    down(c) { r(c, 3, 0, 10, 8, W8[2]); r(c, 4, 1, 8, 2, W8[4]); r(c, 5, 3, 1, 5, W8[3]); r(c, 7, 3, 2, 5, W8[3]); r(c, 10, 3, 1, 5, W8[3]); r(c, 2, 8, 12, 4, W8[3]); r(c, 3, 8, 10, 2, '#d8735a'); r(c, 3, 8, 10, 1, '#e8907a'); r(c, 3, 12, 2, 4, W8[1]); r(c, 11, 12, 2, 4, W8[1]); },
    up(c) { r(c, 2, 4, 12, 4, W8[3]); r(c, 3, 12, 2, 4, W8[1]); r(c, 11, 12, 2, 4, W8[1]); r(c, 3, 6, 10, 8, W8[1]); r(c, 4, 6, 8, 1, W8[3]); },
    side(c) { r(c, 10, 0, 3, 12, W8[1]); r(c, 10, 0, 1, 12, W8[3]); r(c, 2, 7, 11, 4, W8[3]); r(c, 2, 7, 11, 1, W8[4]); r(c, 3, 11, 2, 5, W8[1]); r(c, 11, 11, 2, 5, W8[1]); },
  },
  sofa: {
    down(c) {
      const p = SOFA;
      r(c, 0, -2, 32, 12, p[1]); r(c, 0, -2, 32, 2, p[3]);
      r(c, 2, 0, 13, 8, p[2]); r(c, 17, 0, 13, 8, p[2]); r(c, 2, 0, 13, 1, p[4]); r(c, 17, 0, 13, 1, p[4]);
      r(c, 0, 8, 32, 8, p[3]); r(c, 3, 9, 12, 3, p[4]); r(c, 17, 9, 12, 3, p[4]); r(c, 15, 8, 2, 7, p[1]);
      r(c, 0, 2, 4, 14, p[1]); r(c, 28, 2, 4, 14, p[0]); r(c, 0, 2, 4, 1, p[3]); r(c, 0, 15, 32, 1, p[0]);
    },
    up(c) {
      const p = SOFA;
      r(c, 0, 0, 32, 8, p[3]); r(c, 0, 0, 32, 1, p[4]); r(c, 0, 6, 32, 10, p[1]); r(c, 0, 6, 32, 2, p[2]);
      r(c, 0, 0, 4, 15, p[0]); r(c, 28, 0, 4, 15, p[0]);
    },
    side(c) {
      const p = SOFA;
      r(c, 9, -2, 7, 34, p[1]); r(c, 9, -2, 2, 34, p[3]);
      r(c, 1, 2, 9, 28, p[3]); r(c, 2, 3, 6, 12, p[4]); r(c, 2, 17, 6, 12, p[4]); r(c, 1, 15, 9, 2, p[2]);
      r(c, 0, -2, 14, 5, p[1]); r(c, 0, 28, 14, 4, p[0]); r(c, 0, -2, 14, 1, p[3]);
    },
  },
  armchair: {
    down(c) {
      const p = ARM;
      r(c, 1, -2, 14, 11, p[2]); r(c, 1, -2, 14, 2, p[4]); r(c, 2, 7, 12, 8, p[3]); r(c, 3, 8, 10, 2, p[4]);
      r(c, 0, 3, 4, 13, p[1]); r(c, 12, 3, 4, 13, p[0]); r(c, 0, 3, 4, 1, p[3]); r(c, 0, 15, 16, 1, p[0]);
    },
    up(c) { const p = ARM; r(c, 2, 1, 12, 7, p[3]); r(c, 1, 6, 14, 10, p[1]); r(c, 1, 6, 14, 2, p[2]); r(c, 0, 1, 3, 14, p[0]); r(c, 13, 1, 3, 14, p[0]); },
    side(c) { const p = ARM; r(c, 9, -2, 6, 18, p[1]); r(c, 9, -2, 2, 18, p[3]); r(c, 1, 6, 10, 9, p[3]); r(c, 2, 7, 7, 2, p[4]); r(c, 0, 3, 11, 4, p[0]); },
  },
  tv: {
    down(c, now) {
      r(c, 1, 15, 1, 1, W8[0]); r(c, 14, 15, 1, 1, W8[0]);
      r(c, 0, 5, 16, 10, W8[2]); r(c, 0, 4, 16, 2, W8[4]);
      r(c, 1, 7, 7, 7, W8[3]); r(c, 2, 8, 5, 5, '#d6a26d'); px(c, 7, 10, '#f5c542');
      r(c, 9, 7, 6, 7, '#7a5232'); r(c, 10, 11, 4, 2, '#f4f6f7'); r(c, 10, 8, 1, 3, '#d9534f'); r(c, 11, 8, 1, 3, '#f0ad4e'); r(c, 12, 9, 1, 2, '#4a90d9');
      r(c, 6, 2, 4, 2, '#3a3e46'); r(c, 7, 1, 2, 2, '#3a3e46');
      r(c, 0, -9, 16, 10, '#2a2d33'); r(c, 1, -8, 14, 8, Math.floor(now / 700) % 2 ? '#4aa3df' : '#5cc0a8');
      r(c, 2, -7, 4, 2, '#d0f0ff'); r(c, 8, -3, 5, 1, '#8fe0b0'); px(c, 14, 0, '#e05a2a');
    },
    up(c) { r(c, 0, 5, 16, 10, W8[1]); r(c, 0, 4, 16, 2, W8[4]); r(c, 0, -9, 16, 10, '#3a3e46'); r(c, 3, -7, 10, 6, '#4a4e56'); r(c, 6, 1, 4, 3, '#2a2d33'); },
    side(c, now) {
      r(c, 0, 5, 16, 10, W8[2]); r(c, 0, 4, 16, 2, W8[4]); r(c, 0, 5, 3, 10, W8[3]);
      r(c, 6, -9, 3, 11, '#2a2d33'); r(c, 6, -8, 1, 8, Math.floor(now / 700) % 2 ? '#4aa3df' : '#5cc0a8'); r(c, 5, 2, 5, 2, '#3a3e46');
    },
  },
  toilet: {
    down(c) {
      r(c, 3, -6, 10, 9, '#f4f6f7'); r(c, 2, -7, 12, 2, '#ffffff'); r(c, 3, -5, 2, 8, '#ffffff'); r(c, 12, -5, 1, 8, '#d4dbe0'); r(c, 4, -4, 2, 1, '#aab4ba');
      r(c, 4, -1, 8, 5, W8[4]); r(c, 4, -1, 8, 1, '#e0b07a'); r(c, 11, -1, 1, 5, W8[3]);
      disc(c, 8, 9, 5, 3, '#e3eaee'); disc(c, 8, 8, 5, 3, W8[4]); disc(c, 8, 8, 3, 2, '#cfeaf6'); r(c, 5, 12, 6, 4, '#e3eaee'); r(c, 5, 12, 2, 4, '#f4f6f7');
    },
    up(c) { disc(c, 8, 5, 5, 3, W8[4]); r(c, 5, 7, 6, 4, '#e3eaee'); r(c, 3, 8, 10, 8, '#e3eaee'); r(c, 2, 7, 12, 2, '#ffffff'); },
    side(c) { r(c, 9, -5, 5, 13, '#e3eaee'); r(c, 9, -6, 5, 2, '#ffffff'); r(c, 7, -2, 2, 9, W8[4]); r(c, 2, 6, 9, 3, W8[4]); r(c, 2, 9, 9, 2, '#f4f6f7'); r(c, 4, 11, 6, 5, '#d4dbe0'); r(c, 4, 11, 2, 5, '#f4f6f7'); },
  },
  nightstand: {
    down(c) {
      r(c, 2, 13, 2, 3, W8[1]); r(c, 12, 13, 2, 3, W8[1]);
      r(c, 2, 3, 12, 11, W8[2]); r(c, 1, 1, 14, 3, W8[4]); r(c, 1, 3, 14, 1, W8[3]);
      r(c, 3, 5, 10, 4, W8[3]); r(c, 3, 5, 10, 1, W8[4]); r(c, 7, 7, 2, 1, '#f5c542');
      r(c, 3, 10, 10, 3, '#7a5232'); r(c, 4, 11, 6, 2, '#4a90d9'); r(c, 5, 10, 5, 1, '#d9534f');
      r(c, 3, -1, 4, 2, '#e9668a'); r(c, 4, -3, 2, 2, '#c9a24c'); r(c, 1, -8, 8, 5, '#f3dc94'); r(c, 1, -8, 2, 5, '#fff2c4'); r(c, 1, -3, 8, 1, '#d8bd6a');
      r(c, 9, 0, 5, 1, '#3fb5a3'); r(c, 9, -1, 5, 1, '#f4f1ea'); r(c, 12, -3, 2, 2, '#cfe8f2');
    },
    up(c) { r(c, 2, 13, 2, 3, W8[1]); r(c, 12, 13, 2, 3, W8[1]); r(c, 2, 3, 12, 11, W8[1]); r(c, 1, 1, 14, 3, W8[4]); r(c, 8, -8, 8, 5, '#f3dc94'); r(c, 8, -3, 8, 1, '#d8bd6a'); r(c, 10, -1, 4, 2, '#e9668a'); },
    side(c) {
      r(c, 3, 13, 2, 3, W8[1]); r(c, 11, 13, 2, 3, W8[1]); r(c, 3, 3, 10, 11, W8[2]); r(c, 3, 3, 2, 11, W8[3]); r(c, 2, 1, 12, 3, W8[4]);
      r(c, 5, -1, 4, 2, '#e9668a'); r(c, 3, -8, 8, 5, '#f3dc94'); r(c, 3, -8, 2, 5, '#fff2c4'); r(c, 3, -3, 8, 1, '#d8bd6a');
    },
  },
  wardrobe: {
    down(c) {
      r(c, 1, -20, 14, 34, W8[2]); r(c, 0, -23, 16, 3, W8[4]); r(c, 0, -20, 16, 1, W8[3]); r(c, 1, 13, 14, 3, W8[1]);
      r(c, 2, -18, 6, 30, W8[3]); r(c, 8, -18, 6, 30, W8[3]); r(c, 8, -18, 1, 30, W8[1]);
      for (const x of [3, 10]) { r(c, x, -16, 4, 12, '#d6a26d'); r(c, x, -16, 4, 1, W8[4]); r(c, x, -1, 4, 11, '#d6a26d'); r(c, x, -1, 4, 1, W8[4]); }
      r(c, 7, -4, 1, 4, '#f5c542'); r(c, 9, -4, 1, 4, '#f5c542');
      r(c, 3, -28, 6, 5, '#e9668a'); r(c, 2, -29, 8, 2, '#f08aa8'); r(c, 10, -26, 4, 3, '#c9a25a');
    },
    up(c) { r(c, 1, -20, 14, 34, W8[1]); r(c, 0, -23, 16, 3, W8[4]); r(c, 1, 13, 14, 3, W8[0]); r(c, 2, -18, 12, 1, W8[2]); r(c, 3, -28, 6, 5, '#e9668a'); r(c, 2, -29, 8, 2, '#f08aa8'); },
    side(c) {
      r(c, 3, -20, 10, 34, W8[2]); r(c, 3, -20, 2, 34, W8[3]); r(c, 2, -23, 12, 3, W8[4]); r(c, 3, 13, 10, 3, W8[1]);
      r(c, 6, -16, 6, 12, W8[3]); r(c, 6, -1, 6, 11, W8[3]); r(c, 5, -28, 6, 5, '#e9668a'); r(c, 4, -29, 8, 2, '#f08aa8');
    },
  },
  desk: {
    down(c) {
      r(c, 1, 6, 10, 10, W8[2]); for (const y of [7, 10, 13]) { r(c, 2, y, 8, 2, W8[3]); r(c, 2, y, 8, 1, W8[4]); px(c, 6, y + 1, '#f5c542'); }
      r(c, 11, 6, 18, 5, W8[1]); r(c, 29, 6, 2, 10, W8[1]); r(c, 29, 6, 1, 10, W8[2]);
      r(c, 0, -2, 32, 6, W8[3]); r(c, 0, -2, 32, 1, W8[4]); r(c, 0, 4, 32, 2, W8[2]);
      r(c, 3, -3, 4, 1, '#3fb5a3'); r(c, 4, -10, 1, 7, '#3fb5a3'); r(c, 4, -11, 5, 1, '#3fb5a3'); r(c, 6, -11, 4, 3, '#3fb5a3'); r(c, 7, -8, 3, 1, '#fff2b0');
      r(c, 12, -1, 5, 3, '#f4f1ea'); r(c, 17, -1, 5, 3, '#ece6da'); r(c, 13, 0, 3, 1, '#b8b0a0'); r(c, 18, 0, 3, 1, '#b8b0a0');
      r(c, 22, -3, 2, 3, '#e9668a'); px(c, 24, -2, '#e9668a');
      r(c, 24, -4, 6, 2, '#4a90d9'); r(c, 25, -6, 5, 2, '#d9534f'); r(c, 24, -7, 5, 1, '#5cb85c');
      r(c, 27, -9, 3, 3, '#c96f4a'); disc(c, 28, -11, 3, 2, '#3f8a35'); px(c, 27, -12, '#5aa842');
    },
    up(c) { r(c, 0, -2, 32, 6, W8[3]); r(c, 0, -2, 32, 1, W8[4]); r(c, 0, 4, 32, 9, W8[1]); r(c, 1, 13, 2, 3, W8[0]); r(c, 29, 13, 2, 3, W8[0]); r(c, 22, -9, 3, 7, '#3fb5a3'); r(c, 3, -6, 6, 4, '#4a90d9'); },
    side(c) {
      r(c, 2, -2, 12, 34, W8[3]); r(c, 2, -2, 12, 1, W8[4]); r(c, 2, 0, 2, 32, W8[2]);
      r(c, 4, 2, 8, 6, '#3fb5a3'); r(c, 6, -4, 3, 6, '#3fb5a3'); r(c, 5, 20, 7, 6, '#4a90d9'); r(c, 6, 18, 5, 2, '#d9534f');
      r(c, 3, 30, 10, 2, W8[1]);
    },
  },
  shower: {
    down(c) {
      r(c, 0, -21, 16, 34, '#a9d6df');
      for (let j = 0; j < 8; j++) for (let i = 0; i < 4; i++) r(c, i * 4 + 1, -20 + j * 4, 3, 3, (i + j) % 2 ? '#cfe9ee' : '#e1f3f6');
      r(c, 7, -18, 2, 26, '#c9d2d8'); r(c, 4, -19, 8, 2, '#e3eaee'); r(c, 4, -17, 8, 1, '#9aa4ac'); r(c, 6, -4, 4, 3, '#c9d2d8');
      for (const [x, y] of [[5, -14], [9, -12], [6, -9], [10, -7]]) px(c, x, y, '#ffffff');
      r(c, 1, -8, 3, 4, '#e9668a'); r(c, 1, -9, 3, 1, '#ffffff');
      r(c, 0, 12, 16, 4, '#e3eaee'); r(c, 0, 12, 16, 1, '#ffffff');
      c.fillStyle = 'rgba(190,232,246,0.55)'; c.fillRect(8, -19, 8, 31);
      r(c, 8, -20, 1, 33, '#c9d2d8'); r(c, 15, -20, 1, 33, '#c9d2d8'); r(c, 0, -21, 16, 1, '#c9d2d8');
      r(c, 10, -16, 1, 6, '#f2fbff'); r(c, 11, -17, 1, 3, '#f2fbff'); r(c, 9, -2, 1, 4, '#9aa4ac');
    },
    up(c) { r(c, 0, -21, 16, 34, '#e3eaee'); r(c, 0, -21, 16, 1, '#c9d2d8'); r(c, 0, -21, 1, 34, '#c9d2d8'); r(c, 15, -21, 1, 34, '#c9d2d8'); r(c, 0, 12, 16, 4, '#d4dbe0'); },
    side(c) {
      r(c, 10, -21, 6, 34, '#a9d6df'); for (let j = 0; j < 8; j++) r(c, 11, -20 + j * 4, 4, 3, j % 2 ? '#cfe9ee' : '#e1f3f6');
      r(c, 0, 12, 16, 4, '#e3eaee'); r(c, 0, 12, 16, 1, '#ffffff');
      c.fillStyle = 'rgba(190,232,246,0.55)'; c.fillRect(0, -19, 10, 31); r(c, 0, -20, 1, 33, '#c9d2d8'); r(c, 0, -21, 16, 1, '#c9d2d8');
      r(c, 6, -19, 4, 2, '#e3eaee'); r(c, 9, -18, 1, 14, '#c9d2d8');
    },
  },
  sink: {
    down(c) {
      r(c, 3, -15, 10, 13, '#c9a24c'); r(c, 4, -14, 8, 11, '#cfe8f2'); r(c, 5, -13, 2, 4, '#f2fbff'); px(c, 8, -13, '#f2fbff'); r(c, 7, -16, 2, 1, '#c9a24c');
      r(c, 2, 14, 2, 2, W8[1]); r(c, 12, 14, 2, 2, W8[1]);
      r(c, 1, 2, 14, 12, '#6aa597'); r(c, 2, 4, 5, 9, '#94cbbf'); r(c, 9, 4, 5, 9, '#94cbbf'); r(c, 2, 4, 5, 1, '#b4ded4'); r(c, 9, 4, 5, 1, '#b4ded4');
      px(c, 6, 8, '#f5c542'); px(c, 9, 8, '#f5c542');
      r(c, 0, -1, 16, 3, '#f1ede4'); r(c, 0, -1, 16, 1, '#ffffff'); r(c, 0, 2, 16, 1, '#c9c0ae');
      r(c, 4, -1, 8, 2, '#ffffff'); r(c, 5, -1, 6, 1, '#bfe3ee'); r(c, 7, -4, 2, 3, '#c9d2d8'); r(c, 7, -4, 3, 1, '#e3eaee');
      r(c, 1, -4, 2, 3, '#e9668a'); r(c, 13, -3, 2, 2, '#cfe8f2'); px(c, 13, -5, '#4a90d9'); px(c, 14, -4, '#f5c542');
    },
    up(c) { r(c, 3, -15, 10, 13, '#a8703f'); r(c, 1, 2, 14, 12, '#6aa597'); r(c, 0, -1, 16, 3, '#f1ede4'); r(c, 0, -1, 16, 1, '#ffffff'); r(c, 2, 14, 2, 2, W8[1]); r(c, 12, 14, 2, 2, W8[1]); },
    side(c) {
      r(c, 9, -15, 3, 13, '#c9a24c'); r(c, 9, -14, 1, 11, '#cfe8f2');
      r(c, 3, 2, 10, 12, '#7fb9ad'); r(c, 3, 2, 2, 12, '#94cbbf'); r(c, 2, -1, 12, 3, '#f1ede4'); r(c, 2, -1, 12, 1, '#ffffff');
      r(c, 5, -1, 4, 1, '#bfe3ee'); r(c, 8, -4, 2, 3, '#c9d2d8'); r(c, 6, -4, 3, 1, '#e3eaee'); r(c, 4, 14, 2, 2, W8[1]); r(c, 10, 14, 2, 2, W8[1]);
    },
  },
  towelrack: {
    down(c) {
      r(c, 1, 15, 5, 1, W8[1]); r(c, 10, 15, 5, 1, W8[1]);
      r(c, 3, -7, 2, 22, W8[3]); r(c, 11, -7, 2, 22, W8[3]); r(c, 3, -7, 1, 22, W8[4]); r(c, 3, -8, 10, 2, W8[4]);
      r(c, 4, -2, 8, 9, '#e9668a'); r(c, 4, -2, 8, 1, '#f59ab4'); r(c, 4, 4, 8, 1, '#ffffff'); r(c, 4, 5, 8, 1, '#f59ab4'); r(c, 11, -2, 1, 9, '#c94f72');
      r(c, 4, 8, 8, 6, '#7fc4d8'); r(c, 4, 8, 8, 1, '#a8dcea'); r(c, 4, 12, 8, 1, '#ffffff'); r(c, 11, 8, 1, 6, '#5aa8c0');
    },
    up(c) { r(c, 3, -7, 2, 22, W8[2]); r(c, 11, -7, 2, 22, W8[2]); r(c, 3, -8, 10, 2, W8[3]); r(c, 4, -2, 8, 9, '#c94f72'); r(c, 4, 8, 8, 6, '#5aa8c0'); r(c, 1, 15, 5, 1, W8[1]); r(c, 10, 15, 5, 1, W8[1]); },
    side(c) { r(c, 7, -8, 2, 23, W8[3]); r(c, 4, 15, 8, 1, W8[1]); r(c, 5, -2, 6, 9, '#e9668a'); r(c, 5, -2, 6, 1, '#f59ab4'); r(c, 6, 8, 4, 6, '#7fc4d8'); },
  },
  piano: {
    down(c) {
      r(c, 0, -8, 32, 20, '#15161a'); r(c, 2, -10, 24, 3, '#15161a'); r(c, 3, -7, 22, 10, '#2c2e35'); r(c, 3, -7, 22, 1, '#4a4d57');
      r(c, 4, -6, 6, 2, '#5a5e6a');
      r(c, 1, 11, 30, 5, '#f4f1ea'); for (let i = 0; i < 10; i++) r(c, 3 + i * 3, 11, 2, 3, '#15161a');
      r(c, 10, 16, 12, 1, '#5a3a1e');
    },
    up(c) {
      r(c, 0, 0, 32, 16, '#15161a'); r(c, 1, 1, 30, 5, '#f4f1ea'); for (let i = 0; i < 10; i++) r(c, 3 + i * 3, 3, 2, 3, '#15161a');
      r(c, 5, 7, 22, 7, '#2c2e35'); r(c, 5, 7, 22, 1, '#4a4d57');
    },
    side(c) {
      r(c, 2, -2, 14, 34, '#15161a'); r(c, 5, 1, 9, 24, '#2c2e35'); r(c, 5, 1, 1, 24, '#4a4d57');
      r(c, 0, 1, 5, 30, '#f4f1ea'); for (let i = 0; i < 10; i++) r(c, 0, 3 + i * 3, 3, 2, '#15161a');
    },
  },
  fireplace: {
    down(c, now) {
      r(c, 8, -26, 16, 12, '#7d776b'); r(c, 8, -26, 16, 2, '#a9a294'); bricks(c, 8, -24, 16, 10);
      r(c, 0, -16, 32, 32, '#9a9384'); r(c, 0, -16, 32, 2, '#c5beb0'); r(c, 0, -16, 2, 32, '#b6af9f'); bricks(c, 0, -14, 32, 14);
      r(c, -1, 0, 34, 4, W8[2]); r(c, -1, 0, 34, 1, W8[4]); px(c, 6, -2, '#e9668a'); r(c, 24, -3, 3, 3, '#f5c542');
      r(c, 6, 4, 20, 12, '#2a1a10'); r(c, 6, 4, 20, 1, '#120a05');
      const f = Math.floor(now / 150) % 3;
      disc(c, 16, 12 - f, 7, 4 + f, '#e2571e'); disc(c, 16, 13 - f, 5, 3 + f, '#f39c12'); disc(c, 16, 14, 3, 2, '#ffe58a');
      r(c, 9, 14, 14, 2, '#5a391f'); r(c, 9, 14, 14, 1, '#7a5030');
    },
    up(c) { r(c, 8, -18, 16, 10, '#7d776b'); r(c, 0, -10, 32, 26, '#9a9384'); r(c, 0, -10, 32, 2, '#c5beb0'); bricks(c, 0, -8, 32, 24); },
    side(c, now) {
      r(c, 6, -18, 10, 50, '#9a9384'); r(c, 6, -18, 2, 50, '#c5beb0'); bricks(c, 6, -16, 10, 48);
      r(c, 0, 8, 7, 18, '#5a5e66'); r(c, 1, 11, 5, 12, '#2a1a10');
      const f = Math.floor(now / 150) % 3; disc(c, 3, 18 - f, 2, 3 + f, '#f39c12'); px(c, 3, 19, '#ffe58a');
    },
  },
};

// ---------- more furniture & decorations ----------
const REC = ['#1f5f6b', '#256a78', '#2f7f8f', '#4aa8b8', '#7cd0dc'];
const MUST = ['#9a6c10', '#c68f1c', '#e0a526', '#f0bf4a', '#fbe08a'];
const PURP = ['#2e2058', '#43307a', '#5b3fa0', '#7656c2', '#9a80e0'];
const PINK = ['#b0647a', '#d0849a', '#e9a3b8', '#f5c3d2', '#fde3ea'];
const STN = ['#5f5a50', '#7d776b', '#9a9384', '#b6af9f', '#d3cdbf'];
const MINT = ['#4f7e5a', '#6a9a76', '#7fae8a', '#94c49f', '#b4dcbe'];
const RED = ['#7a1f16', '#8f2a20', '#c0392b', '#d9534f', '#f08a7a'];
// Front-loading laundry machine; `door` paints what's behind the glass.
function laundry(c, door, top) {
  r(c, 1, -4, 14, 20, '#f4f6f7'); r(c, 1, -4, 14, 4, '#e3eaee'); r(c, 1, -4, 14, 1, '#ffffff'); r(c, 13, -4, 2, 20, '#d4dbe0'); r(c, 1, 15, 14, 1, '#9aa4ac');
  disc(c, 4, -2, 1, 1, '#c9d2d8');
  disc(c, 8, 7, 5, 5, '#c9d2d8'); disc(c, 8, 7, 4, 4, '#3a3e46'); door(c); px(c, 6, 4, '#f2fbff'); px(c, 5, 5, '#f2fbff');
  top(c);
}
function laundryBack(c) { r(c, 1, -4, 14, 20, '#e3eaee'); r(c, 1, -4, 14, 1, '#ffffff'); r(c, 3, -1, 10, 1, '#c9d2d8'); r(c, 3, 1, 10, 1, '#c9d2d8'); r(c, 5, 9, 6, 4, '#c9d2d8'); r(c, 1, 15, 14, 1, '#9aa4ac'); }
function laundrySide(c) { r(c, 2, -4, 13, 20, '#e3eaee'); r(c, 2, -4, 13, 1, '#ffffff'); r(c, 2, -4, 2, 20, '#f4f6f7'); r(c, 1, 2, 1, 8, '#c9d2d8'); r(c, 2, 15, 13, 1, '#9aa4ac'); }
// Counter-height cabinet with a top; `front` paints the doors.
function cabinet(c, body, front) {
  r(c, 0, 1, 16, 15, body[2]); front(c);
  r(c, 0, 1, 16, 5, '#e6e1d6'); r(c, 0, 1, 16, 1, '#fffbf2'); r(c, 0, 5, 16, 1, '#a39d90'); r(c, 0, 15, 16, 1, W8[0]);
}
const cabinetBack = (body) => (c) => { r(c, 0, 1, 16, 15, body[1]); r(c, 0, 1, 16, 4, '#e6e1d6'); r(c, 0, 1, 16, 1, '#fffbf2'); r(c, 0, 15, 16, 1, W8[0]); };
const cabinetSide = (body) => (c) => { r(c, 2, 1, 14, 15, body[1]); r(c, 2, 1, 2, 15, body[2]); r(c, 0, 1, 16, 4, '#e6e1d6'); r(c, 0, 1, 16, 1, '#fffbf2'); r(c, 2, 15, 14, 1, W8[0]); };

Object.assign(OBJ, {
  pouf(c) {
    disc(c, 8, 12, 7, 3, '#a83a58'); r(c, 1, 5, 14, 7, '#e05f82'); r(c, 1, 5, 2, 7, '#ec7c9a'); r(c, 13, 5, 2, 7, '#c84a6a');
    for (const x of [4, 7, 10]) r(c, x, 7, 1, 6, '#f59ab4');
    disc(c, 8, 5, 7, 3, '#ec7c9a'); disc(c, 6, 4, 3, 1, '#f59ab4'); r(c, 7, 4, 2, 2, '#c84a6a');
  },
  cattree(c) {
    const p = ['#6e5698', '#9b7fc4', '#b9a0e0'];
    r(c, 0, 12, 16, 4, p[1]); r(c, 0, 12, 16, 1, p[2]);
    r(c, 2, -16, 3, 28, '#c9ad72'); r(c, 2, -16, 1, 28, '#e6d2a0'); for (let y = -14; y < 12; y += 3) r(c, 2, y, 3, 1, '#b8985a');
    r(c, 11, -8, 3, 20, '#c9ad72'); r(c, 11, -8, 1, 20, '#e6d2a0'); for (let y = -6; y < 12; y += 3) r(c, 11, y, 3, 1, '#b8985a');
    r(c, 6, 3, 10, 9, p[1]); r(c, 6, 3, 10, 1, p[2]); disc(c, 11, 8, 2, 3, '#3a2a5a');
    r(c, 0, -18, 8, 3, p[1]); r(c, 0, -18, 8, 1, p[2]);
    r(c, 8, -12, 8, 4, p[1]); r(c, 8, -13, 2, 2, p[2]); r(c, 14, -13, 2, 2, p[2]); r(c, 8, -12, 8, 1, p[2]);
    r(c, 7, -15, 1, 6, '#e9668a'); r(c, 6, -9, 3, 3, '#f5c542');
  },
  barstool(c) {
    disc(c, 8, 14, 5, 1, '#2f3542'); r(c, 7, 2, 2, 12, '#c9d2d8'); r(c, 7, 2, 1, 12, '#eef3f6'); r(c, 4, 9, 8, 1, '#c9d2d8');
    r(c, 2, 0, 12, 3, '#b8441e'); disc(c, 8, 0, 6, 2, '#e05a2a'); r(c, 4, -1, 5, 1, '#f08050');
  },
  cactus(c) {
    r(c, 4, 9, 8, 7, '#c96f4a'); r(c, 4, 9, 2, 7, '#e08a62'); r(c, 3, 8, 10, 2, '#d8875f'); r(c, 5, 15, 6, 1, '#8a4a2c');
    r(c, 6, -12, 4, 21, '#4f9e3a'); r(c, 7, -12, 1, 21, '#7cc457'); r(c, 9, -12, 1, 21, '#3f8a35');
    r(c, 2, -3, 4, 2, '#4f9e3a'); r(c, 2, -8, 2, 6, '#4f9e3a'); px(c, 2, -8, '#7cc457');
    r(c, 10, -5, 4, 2, '#4f9e3a'); r(c, 12, -10, 2, 6, '#3f8a35'); px(c, 12, -10, '#7cc457');
    r(c, 6, -14, 4, 2, '#f06aa0'); px(c, 7, -15, '#ffd0e4'); px(c, 8, -14, '#ffd0e4');
  },
  succulents(c) {
    const pot = (x, y, w, col, lip) => { r(c, x, y, w, 4, col); r(c, x - 1, y - 1, w + 2, 2, lip); };
    const rose = (x, y, rr) => { disc(c, x, y, rr, 2, '#6fae8a'); disc(c, x, y - 1, rr - 1, 1, '#8fc7a2'); px(c, x, y - 2, '#b8e0c4'); };
    pot(1, 6, 5, '#efe6d6', '#e3d8c4'); rose(3, 4, 3); px(c, 1, 3, '#e9668a');
    pot(9, 5, 6, '#c96f4a', '#d8875f'); rose(12, 3, 4);
    pot(5, 11, 5, '#7fb9ad', '#a8dccf'); rose(7, 9, 3); px(c, 9, 8, '#e9668a');
  },
  globe(c) {
    r(c, 3, 14, 10, 2, W8[1]); r(c, 4, 7, 1, 7, W8[2]); r(c, 11, 7, 1, 7, W8[2]); r(c, 7, 7, 2, 8, W8[3]);
    r(c, 1, 5, 14, 3, W8[3]); r(c, 1, 5, 14, 1, W8[4]);
    disc(c, 8, -3, 6, 6, '#3f9fc4'); disc(c, 7, -4, 5, 5, '#5cc0e0'); disc(c, 5, -6, 2, 1, '#9fe0f0');
    r(c, 4, -4, 3, 3, '#5aa842'); r(c, 5, -1, 2, 2, '#5aa842'); r(c, 9, -7, 3, 2, '#5aa842'); r(c, 10, -2, 2, 3, '#3f8a35'); px(c, 8, 1, '#e6d2a8');
    r(c, 1, -6, 1, 8, '#c9a24c'); r(c, 2, -9, 1, 3, '#c9a24c'); r(c, 3, -10, 2, 1, '#c9a24c'); r(c, 7, -10, 2, 1, '#c9a24c'); r(c, 2, 2, 2, 2, '#c9a24c');
  },
  fishbowl(c) {
    r(c, 4, 14, 8, 2, W8[1]); r(c, 7, 6, 2, 8, W8[2]); r(c, 7, 6, 1, 8, W8[3]);
    disc(c, 8, 5, 7, 2, W8[2]); disc(c, 8, 4, 7, 2, W8[4]);
    disc(c, 8, -2, 6, 5, '#8fd3ee'); r(c, 3, -6, 10, 2, '#cfe8f2'); r(c, 4, -7, 8, 1, '#e8f6fb'); disc(c, 8, 1, 4, 1, '#e6d2a8');
    r(c, 8, -2, 3, 2, '#f39c12'); px(c, 11, -2, '#f5b041'); px(c, 11, -1, '#f5b041'); px(c, 8, -2, '#1c1c22');
    r(c, 5, -3, 1, 4, '#3f8a35'); px(c, 4, -2, '#5aa842'); px(c, 4, -5, '#f2fbff'); px(c, 4, -4, '#f2fbff');
  },
  lantern(c) {
    r(c, 3, 13, 10, 3, '#2f3542'); r(c, 3, 13, 10, 1, '#4f5866');
    r(c, 4, 3, 8, 10, '#ffe8a3'); r(c, 4, 3, 3, 10, '#fff6cf'); r(c, 6, 8, 4, 5, '#f4ecd8'); r(c, 7, 5, 2, 3, '#ffb53a'); px(c, 7, 5, '#fff2b0');
    r(c, 3, 3, 1, 10, '#2f3542'); r(c, 12, 3, 1, 10, '#2f3542'); r(c, 2, 1, 12, 2, '#2f3542'); r(c, 4, -1, 8, 2, '#3c4452'); r(c, 6, -3, 4, 2, '#3c4452');
    r(c, 6, -6, 4, 1, '#2f3542'); r(c, 5, -5, 1, 2, '#2f3542'); r(c, 10, -5, 1, 2, '#2f3542');
  },
  birdbath(c) {
    r(c, 3, 13, 10, 3, STN[1]); r(c, 3, 13, 10, 1, STN[3]); r(c, 6, 4, 4, 9, STN[2]); r(c, 6, 4, 1, 9, STN[3]);
    disc(c, 8, 3, 8, 3, STN[1]); disc(c, 8, 2, 8, 3, STN[3]); disc(c, 8, 2, 6, 2, '#8fd3ee'); r(c, 4, 1, 3, 1, '#c5ecf8');
    r(c, 11, -3, 4, 3, '#4a90d9'); r(c, 13, -5, 2, 2, '#4a90d9'); px(c, 15, -4, '#f0ad4e'); px(c, 13, -5, '#1c1c22'); r(c, 11, -1, 3, 1, '#f5e6c8'); px(c, 10, -3, '#3a6fb0');
  },
  firepit(c, now) {
    disc(c, 8, 11, 8, 4, STN[1]); disc(c, 8, 10, 6, 3, '#3a2a1e'); disc(c, 8, 10, 4, 2, '#ff7a3a');
    for (const [x, y] of [[0, 9], [3, 7], [7, 6], [11, 7], [14, 9], [12, 12], [8, 13], [3, 12]]) { r(c, x, y, 3, 2, STN[2]); r(c, x, y, 3, 1, STN[3]); }
    r(c, 3, 9, 10, 2, W8[1]); r(c, 6, 8, 4, 4, W8[0]);
    const f = Math.floor(now / 150) % 3;
    disc(c, 8, 4 - f, 4, 4 + f, '#e2571e'); disc(c, 8, 5 - f, 3, 3 + f, '#f39c12'); disc(c, 8, 7, 2, 2, '#ffe58a'); px(c, 5 + f, -2 - f, '#ffb53a'); px(c, 11 - f, -3, '#ffe58a');
  },
  stonelantern(c) {
    r(c, 3, 13, 10, 3, STN[1]); r(c, 3, 13, 10, 1, STN[3]); r(c, 6, 3, 4, 10, STN[2]); r(c, 6, 3, 1, 10, STN[3]);
    r(c, 3, 1, 10, 2, STN[3]); r(c, 4, -6, 8, 7, STN[2]); r(c, 4, -6, 1, 7, STN[3]); r(c, 6, -5, 4, 4, '#ffe8a3'); r(c, 6, -5, 2, 2, '#fff6cf');
    r(c, 0, -8, 16, 2, STN[3]); px(c, 0, -9, STN[3]); px(c, 15, -9, STN[3]); r(c, 2, -10, 12, 2, STN[2]); r(c, 5, -12, 6, 2, STN[2]); r(c, 7, -14, 2, 2, STN[3]);
    r(c, 6, -10, 3, 1, '#5aa842'); px(c, 4, 13, '#3f8a35');
  },
});

Object.assign(TURN, {
  bunkbed(c) {
    r(c, 0, -4, 16, 36, W8[2]); r(c, 0, -4, 2, 36, W8[4]); r(c, 14, -4, 2, 36, W8[3]);
    r(c, 0, -5, 3, 4, W8[4]); r(c, 13, -5, 3, 4, W8[4]); r(c, 0, 29, 3, 3, W8[4]); r(c, 13, 29, 3, 3, W8[4]); r(c, 2, -3, 12, 3, '#d6a26d');
    r(c, 2, 0, 12, 28, '#f4ecd8'); r(c, 3, 1, 10, 4, '#ffffff'); r(c, 3, 4, 10, 1, '#d9d4c7');
    r(c, 2, 8, 12, 20, '#d9534f'); r(c, 2, 7, 12, 2, '#f4ecd8'); r(c, 2, 12, 12, 1, '#f08a7a'); r(c, 2, 20, 12, 1, '#f08a7a'); r(c, 2, 27, 12, 1, '#a83a30');
    r(c, 5, 5, 3, 3, '#c08a4a'); px(c, 5, 4, '#c08a4a'); px(c, 7, 4, '#c08a4a');
    r(c, 13, 6, 3, 12, W8[4]); r(c, 15, 20, 1, 9, W8[1]); for (const y of [21, 24, 27]) r(c, 13, y, 3, 1, W8[3]);
  },
  island(c) {
    r(c, 1, 12, 30, 4, '#5f8fbf'); r(c, 1, 12, 30, 1, '#78a6d4'); for (const x of [8, 16, 24]) r(c, x, 13, 1, 3, '#4a78a6');
    r(c, 0, 0, 32, 13, W8[3]); r(c, 0, 0, 32, 1, W8[4]); r(c, 0, 12, 32, 1, W8[2]); for (const x of [5, 11, 17, 23, 29]) r(c, x, 1, 1, 11, '#b98a5a');
    disc(c, 7, 6, 4, 3, '#f4f6f7'); px(c, 6, 5, '#d9534f'); px(c, 8, 6, '#f0ad4e'); px(c, 7, 7, '#7fb35a'); px(c, 5, 6, '#d9534f');
    r(c, 13, 3, 8, 6, W8[2]); r(c, 15, 5, 2, 2, '#e67e22'); r(c, 18, 5, 2, 1, '#7fb35a');
    r(c, 25, 4, 4, 4, '#c96f4a'); disc(c, 27, 3, 3, 2, '#3f8a35'); px(c, 26, 2, '#5aa842');
  },
  picnic(c) {
    r(c, 0, 0, 32, 3, W8[3]); r(c, 0, 0, 32, 1, W8[4]); r(c, 0, 13, 32, 3, W8[3]); r(c, 0, 13, 32, 1, W8[4]);
    r(c, 1, 3, 30, 10, W8[3]); for (const y of [5, 8, 10]) r(c, 1, y, 30, 1, W8[2]); r(c, 1, 3, 30, 1, W8[4]);
    r(c, 9, 4, 13, 8, '#e2574c'); for (let i = 0; i < 7; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2) r(c, 9 + i * 2, 4 + j * 2, 2, 2, '#f8e8e4');
    r(c, 12, 5, 5, 4, '#c9a25a'); r(c, 12, 5, 5, 1, '#dcb874'); r(c, 14, 3, 1, 3, W8[1]);
    r(c, 24, 6, 2, 3, '#fff3a6'); r(c, 24, 6, 2, 1, '#ffffff'); r(c, 27, 5, 2, 2, '#cfe8f2'); r(c, 27, 9, 2, 2, '#cfe8f2');
  },
  hammock(c) {
    r(c, 0, 1, 3, 14, W8[2]); r(c, 0, 1, 3, 1, W8[4]); r(c, 29, 1, 3, 14, W8[2]); r(c, 29, 1, 3, 1, W8[4]); r(c, 3, 7, 26, 2, W8[1]);
    r(c, 3, 7, 3, 2, '#d8c08a'); r(c, 26, 7, 3, 2, '#d8c08a');
    r(c, 6, 3, 20, 10, '#3fb5a3'); r(c, 6, 6, 20, 3, '#f5e6c8'); r(c, 6, 9, 20, 4, '#e9668a'); r(c, 5, 4, 1, 8, '#2f9583'); r(c, 26, 4, 1, 8, '#2f9583');
    r(c, 7, 4, 4, 8, '#ffffff'); r(c, 7, 11, 4, 1, '#d9d4c7'); r(c, 18, 5, 4, 3, '#4a90d9'); r(c, 18, 5, 4, 1, '#f4f1ea');
  },
});

Object.assign(FACE, {
  recliner: {
    down(c) {
      const p = REC;
      r(c, 1, -3, 14, 12, p[2]); r(c, 1, -3, 14, 2, p[4]); r(c, 3, -1, 10, 6, p[3]); r(c, 2, 7, 12, 6, p[3]); r(c, 3, 8, 10, 2, p[4]);
      r(c, 0, 2, 4, 12, p[1]); r(c, 12, 2, 4, 12, p[0]); r(c, 0, 2, 4, 1, p[3]); r(c, 3, 13, 10, 2, p[2]); r(c, 0, 15, 16, 1, W8[0]);
      r(c, 6, 4, 4, 3, '#f5c542'); px(c, 7, 5, '#fbe08a'); r(c, 1, 5, 2, 6, '#f4ecd8');
    },
    up(c) { const p = REC; r(c, 1, -3, 14, 10, p[3]); r(c, 1, -3, 14, 1, p[4]); r(c, 1, 5, 14, 11, p[1]); r(c, 0, 2, 3, 13, p[0]); r(c, 13, 2, 3, 13, p[0]); },
    side(c) { const p = REC; r(c, 9, -3, 6, 18, p[1]); r(c, 9, -3, 2, 18, p[3]); r(c, 1, 6, 10, 8, p[3]); r(c, 2, 7, 7, 2, p[4]); r(c, 0, 2, 11, 4, p[0]); r(c, 0, 10, 3, 5, p[2]); r(c, 4, 4, 1, 4, '#c9d2d8'); r(c, 1, 15, 14, 1, W8[0]); },
  },
  loveseat: {
    down(c) {
      const p = MUST;
      r(c, 0, -8, 32, 2, W8[4]); r(c, 0, -8, 2, 24, W8[3]); r(c, 30, -8, 2, 24, W8[2]);
      for (let x = 4; x < 29; x += 3) r(c, x, -6, 1, 8, W8[2]);
      r(c, 3, -3, 12, 7, p[2]); r(c, 17, -3, 12, 7, p[2]); r(c, 3, -3, 12, 1, p[3]); r(c, 17, -3, 12, 1, p[3]);
      r(c, 2, 4, 28, 6, p[2]); r(c, 2, 4, 28, 1, p[4]); r(c, 15, 4, 1, 6, p[1]); r(c, 1, 10, 30, 2, W8[3]);
      r(c, 0, 1, 4, 2, W8[4]); r(c, 28, 1, 4, 2, W8[4]);
      r(c, 4, 0, 5, 4, '#3a7fc2'); px(c, 5, 1, '#7fb2e8'); r(c, 23, 0, 5, 4, '#e9668a'); px(c, 24, 1, '#f59ab4');
      r(c, 2, 12, 2, 4, W8[1]); r(c, 28, 12, 2, 4, W8[1]);
    },
    up(c) {
      const p = MUST;
      r(c, 2, 2, 28, 7, p[1]); r(c, 2, 2, 28, 1, p[3]);
      r(c, 0, -8, 32, 2, W8[4]); r(c, 0, -8, 2, 24, W8[2]); r(c, 30, -8, 2, 24, W8[2]); for (let x = 4; x < 29; x += 3) r(c, x, -6, 1, 10, W8[2]);
      r(c, 1, 9, 30, 2, W8[3]); r(c, 2, 11, 2, 5, W8[1]); r(c, 28, 11, 2, 5, W8[1]);
    },
    side(c) {
      const p = MUST;
      r(c, 11, -6, 3, 36, W8[3]); r(c, 11, -6, 1, 36, W8[4]); r(c, 2, 2, 9, 28, p[2]); r(c, 3, 3, 6, 12, p[3]); r(c, 3, 17, 6, 12, p[3]); r(c, 2, 15, 9, 2, p[1]);
      r(c, 0, -1, 14, 2, W8[4]); r(c, 0, 29, 14, 2, W8[3]); r(c, 1, 31, 2, 1, W8[1]); r(c, 11, 31, 2, 1, W8[1]);
    },
  },
  lowshelf: {
    down(c) {
      r(c, 0, 0, 32, 16, W8[2]); r(c, 0, -1, 32, 2, W8[4]); r(c, 15, 1, 2, 15, W8[1]); r(c, 1, 7, 30, 1, W8[3]);
      const cols = ['#d9534f', '#4a90d9', '#5cb85c', '#f0ad4e', '#9b59b6', '#3fb5a3'];
      for (let i = 0; i < 6; i++) r(c, 2 + i * 2, 9 - (i % 2), 2, 6 + (i % 2), cols[i]);
      r(c, 2, 4, 6, 1, '#3fb5a3'); r(c, 2, 5, 6, 1, '#d9534f'); r(c, 2, 6, 6, 1, '#f5c542'); r(c, 10, 3, 3, 4, '#9fd6ee');
      r(c, 18, 9, 12, 6, '#c9a25a'); r(c, 18, 9, 12, 1, '#dcb874'); r(c, 18, 2, 4, 5, '#4a90d9'); r(c, 22, 3, 3, 4, '#f0ad4e'); r(c, 26, 3, 4, 4, '#e9668a');
      r(c, 2, -4, 4, 3, '#c96f4a'); disc(c, 4, -5, 3, 2, '#3f8a35'); r(c, 1, -3, 1, 6, '#3f8a35');
      r(c, 13, -7, 6, 6, '#c9a24c'); r(c, 14, -6, 4, 4, '#9fd6ee'); r(c, 14, -4, 4, 2, '#5aa842');
      r(c, 23, -3, 5, 2, '#3a7fc2'); px(c, 24, -4, '#f0ad4e'); px(c, 26, -4, '#d9534f');
    },
    up(c) { r(c, 0, 0, 32, 16, W8[1]); r(c, 0, -1, 32, 2, W8[4]); r(c, 1, 2, 30, 1, W8[2]); r(c, 2, -4, 4, 3, '#c96f4a'); disc(c, 4, -5, 3, 2, '#3f8a35'); r(c, 13, -7, 6, 6, '#c9a24c'); },
    side(c) {
      r(c, 4, -1, 9, 33, W8[2]); r(c, 3, -2, 11, 2, W8[4]); r(c, 4, -1, 2, 33, W8[3]);
      r(c, 5, 2, 4, 3, '#c96f4a'); disc(c, 7, 1, 3, 2, '#3f8a35'); r(c, 6, 14, 6, 4, '#c9a24c'); r(c, 6, 24, 6, 4, '#e9668a');
    },
  },
  recordplayer: {
    down(c) {
      r(c, 2, 13, 1, 3, W8[1]); r(c, 13, 13, 1, 3, W8[1]);
      r(c, 1, 3, 14, 10, W8[2]); r(c, 1, 2, 14, 2, W8[4]); r(c, 2, 5, 6, 7, '#d6a26d'); r(c, 9, 5, 5, 7, '#7a5232'); px(c, 7, 8, '#c9a24c');
      for (const [x, col] of [[9, '#d9534f'], [10, '#2a2d33'], [11, '#f5c542'], [12, '#3fb5a3']]) r(c, x, 6, 1, 6, col);
      r(c, 1, -6, 14, 7, '#d7eef6'); r(c, 1, -6, 14, 1, '#ffffff');
      r(c, 1, 0, 14, 3, '#3a2a1e'); disc(c, 6, 0, 4, 1, '#1c1c22'); px(c, 6, 0, '#e05a2a'); r(c, 11, -1, 1, 2, '#c9d2d8'); r(c, 10, 1, 2, 1, '#c9d2d8');
    },
    up(c) { r(c, 2, 13, 1, 3, W8[1]); r(c, 13, 13, 1, 3, W8[1]); r(c, 1, 3, 14, 10, W8[1]); r(c, 1, 2, 14, 2, W8[4]); r(c, 1, -6, 14, 8, '#d7eef6'); r(c, 1, -6, 14, 1, '#ffffff'); r(c, 1, 1, 14, 2, '#3a2a1e'); },
    side(c) {
      r(c, 3, 13, 1, 3, W8[1]); r(c, 12, 13, 1, 3, W8[1]); r(c, 2, 3, 12, 10, W8[2]); r(c, 2, 2, 12, 2, W8[4]); r(c, 2, 3, 2, 10, W8[3]);
      r(c, 2, 0, 12, 2, '#3a2a1e'); r(c, 3, -1, 8, 1, '#1c1c22'); r(c, 12, -9, 2, 9, '#d7eef6');
    },
  },
  arcade: {
    down(c) {
      const p = PURP;
      r(c, 1, -22, 14, 38, p[2]); r(c, 0, -23, 16, 2, p[1]); r(c, 1, -22, 1, 38, p[3]); r(c, 14, -22, 1, 38, p[1]); r(c, 1, 15, 14, 1, '#2a2d33');
      r(c, 2, -21, 12, 4, '#ff7ab8'); r(c, 4, -20, 8, 2, '#ffe8f2');
      r(c, 2, -16, 12, 10, '#1c1c22'); r(c, 3, -15, 10, 8, '#5cc0e0'); r(c, 4, -14, 3, 2, '#bdeeff'); r(c, 9, -11, 3, 2, '#8fe0b0'); px(c, 7, -10, '#ffe58a');
      r(c, 0, -5, 16, 3, '#2a2d33'); r(c, 0, -5, 16, 1, '#4a4e56'); r(c, 3, -7, 1, 3, '#2f3542'); r(c, 2, -8, 3, 2, '#e74c3c');
      px(c, 8, -4, '#f5c542'); px(c, 10, -4, '#4a90d9'); px(c, 12, -4, '#5cb85c');
      r(c, 5, 4, 6, 5, '#2a2d33'); px(c, 6, 6, '#ff7a3a'); px(c, 9, 6, '#ff7a3a'); r(c, 2, 0, 1, 12, '#ff7ab8'); r(c, 13, 0, 1, 12, '#5cc0e0');
    },
    up(c) { const p = PURP; r(c, 1, -22, 14, 38, p[1]); r(c, 0, -23, 16, 2, p[2]); r(c, 1, 15, 14, 1, '#2a2d33'); for (let y = -18; y < -8; y += 3) r(c, 4, y, 8, 1, p[0]); r(c, 5, 6, 6, 4, p[0]); },
    side(c) {
      const p = PURP;
      r(c, 4, -22, 10, 38, p[1]); r(c, 4, -22, 10, 1, p[3]); r(c, 2, -21, 4, 4, p[2]); r(c, 3, -16, 3, 10, '#1c1c22');
      r(c, 1, -5, 6, 3, '#2a2d33'); r(c, 2, -8, 2, 3, '#e74c3c'); r(c, 3, -2, 3, 17, p[2]); r(c, 7, -12, 6, 1, '#ff7ab8'); r(c, 7, -10, 6, 1, '#5cc0e0'); r(c, 1, 15, 13, 1, '#2a2d33');
    },
  },
  arclamp: {
    down(c) {
      r(c, 1, 12, 7, 4, '#d9d4c7'); r(c, 1, 12, 7, 1, '#f1ede4'); r(c, 4, -14, 1, 26, '#c9a24c');
      r(c, 5, -17, 1, 3, '#c9a24c'); r(c, 6, -19, 2, 2, '#c9a24c'); r(c, 8, -20, 3, 1, '#c9a24c'); r(c, 11, -19, 1, 2, '#c9a24c'); r(c, 12, -17, 1, 4, '#c9a24c');
      r(c, 10, -13, 5, 2, '#e2574c'); r(c, 9, -11, 7, 3, '#e2574c'); r(c, 9, -11, 2, 3, '#f08070'); r(c, 9, -8, 7, 1, '#c9433a'); r(c, 10, -7, 5, 1, '#fff2b0');
    },
    up(c) {
      r(c, 8, 12, 7, 4, '#d9d4c7'); r(c, 8, 12, 7, 1, '#f1ede4'); r(c, 11, -14, 1, 26, '#c9a24c');
      r(c, 10, -17, 1, 3, '#c9a24c'); r(c, 8, -19, 2, 2, '#c9a24c'); r(c, 5, -20, 3, 1, '#c9a24c'); r(c, 4, -19, 1, 2, '#c9a24c'); r(c, 3, -17, 1, 4, '#c9a24c');
      r(c, 1, -13, 5, 2, '#c9433a'); r(c, 0, -11, 7, 3, '#c9433a');
    },
    side(c) {
      r(c, 9, 12, 6, 4, '#d9d4c7'); r(c, 9, 12, 6, 1, '#f1ede4'); r(c, 12, -14, 1, 26, '#c9a24c');
      r(c, 11, -17, 1, 3, '#c9a24c'); r(c, 9, -19, 2, 2, '#c9a24c'); r(c, 6, -20, 3, 1, '#c9a24c'); r(c, 5, -19, 1, 2, '#c9a24c'); r(c, 4, -17, 1, 4, '#c9a24c');
      r(c, 2, -13, 5, 2, '#e2574c'); r(c, 1, -11, 7, 3, '#e2574c'); r(c, 1, -11, 2, 3, '#f08070'); r(c, 1, -8, 7, 1, '#c9433a'); r(c, 2, -7, 5, 1, '#fff2b0');
    },
  },
  rockingchair: {
    down(c) {
      r(c, 2, -10, 12, 2, W8[4]); r(c, 2, -8, 2, 16, W8[2]); r(c, 12, -8, 2, 16, W8[2]); for (const x of [5, 7, 9]) r(c, x, -8, 1, 14, W8[3]);
      r(c, 5, -8, 6, 7, '#e8873a'); r(c, 5, -6, 6, 1, '#f6b26b'); r(c, 5, -3, 6, 1, '#f6b26b');
      r(c, 1, 2, 3, 1, W8[4]); r(c, 12, 2, 3, 1, W8[4]);
      r(c, 2, 6, 12, 4, W8[3]); r(c, 3, 6, 10, 2, '#4a7fc4'); r(c, 3, 6, 10, 1, '#6f9fe0');
      r(c, 3, 10, 2, 5, W8[1]); r(c, 11, 10, 2, 5, W8[1]); r(c, 1, 15, 4, 1, W8[0]); r(c, 11, 15, 4, 1, W8[0]);
    },
    up(c) { r(c, 2, -10, 12, 2, W8[4]); r(c, 2, -8, 12, 16, W8[2]); r(c, 3, -7, 10, 1, W8[3]); r(c, 5, -8, 6, 7, '#e8873a'); r(c, 3, 10, 2, 5, W8[1]); r(c, 11, 10, 2, 5, W8[1]); r(c, 1, 15, 4, 1, W8[0]); r(c, 11, 15, 4, 1, W8[0]); },
    side(c) {
      r(c, 11, -10, 3, 18, W8[2]); r(c, 11, -10, 1, 18, W8[4]); r(c, 12, -8, 3, 8, '#e8873a');
      r(c, 2, 6, 11, 3, W8[3]); r(c, 2, 5, 10, 1, '#4a7fc4'); r(c, 2, 1, 10, 1, W8[4]);
      r(c, 3, 9, 2, 5, W8[1]); r(c, 10, 9, 2, 5, W8[1]); r(c, 1, 14, 14, 1, W8[1]); px(c, 0, 13, W8[1]); px(c, 15, 13, W8[1]);
    },
  },
  vanity: {
    down(c) {
      const p = PINK;
      r(c, 3, -15, 10, 14, p[2]); r(c, 5, -17, 6, 2, p[2]); r(c, 4, -13, 8, 12, '#cfe8f2'); r(c, 6, -15, 4, 2, '#cfe8f2'); r(c, 5, -11, 1, 4, '#f2fbff'); r(c, 7, -12, 1, 2, '#f2fbff');
      r(c, 0, -1, 16, 6, p[2]); r(c, 0, -1, 16, 1, p[3]); r(c, 2, 2, 5, 2, p[3]); r(c, 9, 2, 5, 2, p[3]); px(c, 4, 3, '#c9a24c'); px(c, 11, 3, '#c9a24c');
      r(c, 1, -4, 2, 3, '#c39bd3'); r(c, 12, -3, 3, 2, '#3fb5a3');
      r(c, 1, 5, 1, 11, W8[4]); r(c, 14, 5, 1, 11, W8[4]);
      r(c, 4, 9, 8, 3, p[2]); r(c, 4, 9, 8, 1, p[4]); r(c, 5, 12, 1, 4, W8[4]); r(c, 10, 12, 1, 4, W8[4]);
    },
    up(c) { const p = PINK; r(c, 3, -15, 10, 14, p[1]); r(c, 5, -17, 6, 2, p[1]); r(c, 0, -1, 16, 6, p[1]); r(c, 0, -1, 16, 1, p[3]); r(c, 1, 5, 1, 11, W8[4]); r(c, 14, 5, 1, 11, W8[4]); r(c, 4, 6, 8, 3, p[2]); },
    side(c) {
      const p = PINK;
      r(c, 10, -17, 3, 16, p[2]); r(c, 9, -15, 1, 13, '#cfe8f2'); r(c, 6, -1, 9, 6, p[2]); r(c, 6, -1, 9, 1, p[3]); r(c, 7, 5, 1, 11, W8[4]); r(c, 13, 5, 1, 11, W8[4]);
      r(c, 0, 9, 6, 3, p[2]); r(c, 0, 9, 6, 1, p[4]); r(c, 1, 12, 1, 4, W8[4]); r(c, 4, 12, 1, 4, W8[4]);
    },
  },
  kitchensink: {
    down(c) {
      cabinet(c, MINT, (cc) => { r(cc, 1, 7, 6, 8, MINT[3]); r(cc, 9, 7, 6, 8, MINT[3]); r(cc, 6, 9, 1, 3, '#d6be6c'); r(cc, 9, 9, 1, 3, '#d6be6c'); });
      r(c, 3, 2, 9, 3, '#9aa4ac'); r(c, 4, 3, 7, 2, '#8fd3ee'); px(c, 5, 3, '#c5ecf8');
      r(c, 7, -5, 2, 7, '#c9d2d8'); r(c, 7, -5, 4, 1, '#e3eaee'); px(c, 10, -4, '#c9d2d8');
      r(c, 12, -2, 3, 4, '#c9d2d8'); r(c, 12, -4, 1, 4, '#f4f6f7'); r(c, 14, -4, 1, 4, '#f4f6f7'); r(c, 1, -1, 2, 3, '#5cb85c');
    },
    up: cabinetBack(MINT),
    side(c) { cabinetSide(MINT)(c); r(c, 5, -5, 2, 6, '#c9d2d8'); r(c, 3, -5, 4, 1, '#e3eaee'); },
  },
  dishwasher: {
    down(c) {
      cabinet(c, ['#9aa4ac', '#aab4ba', '#c3ccd3'], (cc) => {
        r(cc, 1, 6, 14, 9, '#d7dee3'); r(cc, 1, 6, 14, 1, '#eef3f6'); r(cc, 3, 8, 10, 1, '#e3eaee'); r(cc, 3, 8, 10, 1, '#c9d2d8');
        r(cc, 3, 7, 10, 1, '#eef3f6');
      });
      r(c, 1, 5, 14, 2, '#3a3e46'); px(c, 3, 5, '#ff7a3a'); px(c, 11, 5, '#8fe0b0'); px(c, 13, 5, '#5cc0e0');
      r(c, 3, 8, 10, 1, '#c9d2d8'); r(c, 4, 1, 8, 2, '#e9668a'); r(c, 5, -1, 2, 3, '#3fb5a3'); r(c, 9, -1, 2, 3, '#f5c542');
    },
    up: cabinetBack(['#9aa4ac', '#aab4ba', '#c3ccd3']),
    side: cabinetSide(['#9aa4ac', '#aab4ba', '#c3ccd3']),
  },
  washer: {
    down(c) {
      laundry(c, (cc) => { disc(cc, 8, 8, 4, 2, '#4fa8e0'); disc(cc, 8, 5, 3, 1, '#c5ecf8'); px(cc, 9, 9, '#f2fbff'); },
        (cc) => { r(cc, 7, -3, 3, 2, '#2c3036'); px(cc, 8, -3, '#8fe0b0'); px(cc, 11, -2, '#4fa8e0'); px(cc, 12, -2, '#4fa8e0'); r(cc, 3, -9, 3, 5, '#4fa8e0'); r(cc, 4, -10, 1, 1, '#ffffff'); r(cc, 8, -6, 6, 2, '#e9668a'); r(cc, 8, -7, 6, 1, '#f5c542'); });
    },
    up: laundryBack,
    side(c) { laundrySide(c); r(c, 4, -9, 4, 5, '#4fa8e0'); r(c, 8, -6, 6, 2, '#e9668a'); },
  },
  dryer: {
    down(c) {
      laundry(c, (cc) => { r(cc, 6, 5, 3, 2, '#e9668a'); r(cc, 9, 7, 3, 2, '#e8873a'); r(cc, 6, 8, 2, 2, '#5cb85c'); px(cc, 10, 5, '#4a90d9'); },
        (cc) => { r(cc, 7, -3, 6, 1, '#e8873a'); px(cc, 8, -3, '#ffcf5a'); r(cc, 3, -10, 10, 6, '#c9a25a'); r(cc, 2, -10, 12, 1, '#dcb874'); r(cc, 4, -12, 3, 2, '#4a90d9'); r(cc, 7, -12, 4, 2, '#ffffff'); r(cc, 10, -11, 2, 1, '#e9668a'); });
    },
    up: laundryBack,
    side(c) { laundrySide(c); r(c, 4, -10, 9, 6, '#c9a25a'); r(c, 3, -10, 11, 1, '#dcb874'); r(c, 6, -12, 4, 2, '#ffffff'); },
  },
  pedestalsink: {
    down(c) {
      r(c, 13, -12, 1, 28, '#c9d2d8'); r(c, 11, -12, 4, 1, '#c9d2d8'); r(c, 12, -9, 3, 7, '#7fc4d8'); r(c, 12, -9, 3, 1, '#a8dcea');
      r(c, 5, 13, 6, 3, '#e3eaee'); r(c, 6, 4, 4, 10, '#f4f6f7'); r(c, 6, 4, 1, 10, '#ffffff'); r(c, 9, 4, 1, 10, '#d4dbe0');
      r(c, 1, -1, 12, 6, '#f4f6f7'); r(c, 1, -1, 12, 1, '#ffffff'); r(c, 2, 4, 10, 1, '#d4dbe0'); r(c, 3, 0, 8, 2, '#bfe3ee');
      r(c, 6, -4, 2, 4, '#c9d2d8'); r(c, 6, -4, 3, 1, '#e3eaee'); px(c, 4, -1, '#c9d2d8'); px(c, 9, -1, '#c9d2d8'); r(c, 1, -2, 2, 1, '#e9668a');
    },
    up(c) { r(c, 2, -12, 1, 28, '#c9d2d8'); r(c, 1, -9, 3, 7, '#5aa8c0'); r(c, 5, 13, 6, 3, '#e3eaee'); r(c, 6, 4, 4, 10, '#e3eaee'); r(c, 3, -1, 12, 6, '#e3eaee'); r(c, 3, -1, 12, 1, '#ffffff'); },
    side(c) {
      r(c, 13, -12, 1, 28, '#c9d2d8'); r(c, 12, -9, 3, 7, '#7fc4d8');
      r(c, 5, 13, 6, 3, '#e3eaee'); r(c, 6, 4, 4, 10, '#f4f6f7'); r(c, 6, 4, 1, 10, '#ffffff'); r(c, 2, -1, 11, 6, '#f4f6f7'); r(c, 2, -1, 11, 1, '#ffffff'); r(c, 9, -4, 2, 3, '#c9d2d8'); r(c, 7, -4, 3, 1, '#e3eaee');
    },
  },
  easel: {
    down(c) {
      r(c, 1, 2, 1, 14, W8[2]); r(c, 2, -6, 1, 8, W8[2]); r(c, 14, 2, 1, 14, W8[2]); r(c, 13, -6, 1, 8, W8[2]); r(c, 7, -18, 2, 4, W8[3]);
      r(c, 2, -15, 12, 14, '#f4ecd8'); r(c, 3, -14, 10, 5, '#f7a76a'); r(c, 3, -14, 10, 2, '#9b8ad8'); r(c, 3, -12, 10, 1, '#f08a7a');
      disc(c, 8, -9, 2, 1, '#ffe58a'); r(c, 3, -8, 10, 6, '#5aa842'); r(c, 3, -9, 5, 2, '#3f8a35'); r(c, 9, -8, 4, 1, '#7fb35a');
      r(c, 0, -1, 16, 2, W8[3]); r(c, 0, -1, 16, 1, W8[4]); r(c, 10, -2, 4, 1, W8[4]); px(c, 10, -3, '#d9534f'); px(c, 12, -3, '#4a90d9');
      r(c, 2, 12, 3, 3, '#d9534f'); r(c, 6, 13, 3, 2, '#4a90d9'); r(c, 7, 9, 1, 4, W8[4]);
    },
    up(c) { r(c, 1, 2, 1, 14, W8[2]); r(c, 14, 2, 1, 14, W8[2]); r(c, 2, -15, 12, 14, '#d9cfbd'); r(c, 2, -15, 12, 1, '#efe6d6'); r(c, 3, -14, 1, 12, W8[3]); r(c, 12, -14, 1, 12, W8[3]); r(c, 7, -18, 2, 34, W8[1]); },
    side(c) {
      r(c, 6, -18, 2, 34, W8[2]); r(c, 11, 0, 1, 16, W8[1]); r(c, 10, -6, 1, 6, W8[1]);
      r(c, 4, -15, 2, 14, '#f4ecd8'); r(c, 3, -15, 1, 14, '#5aa842'); r(c, 1, -1, 6, 2, W8[3]); r(c, 2, 12, 3, 3, '#d9534f');
    },
  },
  grill: {
    down(c) {
      const p = RED;
      r(c, 2, -9, 12, 8, p[2]); r(c, 2, -9, 12, 1, p[4]); r(c, 3, -8, 3, 6, p[3]); r(c, 6, -6, 4, 1, '#c9d2d8');
      r(c, 2, -1, 12, 3, '#2f3542'); r(c, 3, -1, 10, 1, '#ff7a3a'); r(c, 3, 0, 4, 1, '#a0522d'); r(c, 8, 0, 4, 1, '#a0522d');
      r(c, 2, 2, 12, 5, p[2]); r(c, 2, 2, 12, 1, p[3]); r(c, 4, 4, 8, 1, '#c9d2d8');
      r(c, 14, 1, 2, 2, W8[3]); r(c, 0, 1, 2, 2, W8[3]);
      r(c, 3, 7, 1, 8, '#2f3542'); r(c, 12, 7, 1, 8, '#2f3542'); r(c, 3, 11, 10, 1, '#3a3e46'); r(c, 5, 9, 4, 2, '#c9a25a');
      r(c, 2, 13, 3, 3, '#1c1c22'); r(c, 11, 13, 3, 3, '#1c1c22');
      disc(c, 7, -12, 2, 1, '#e0e0e0'); disc(c, 9, -14, 2, 1, '#ececec');
    },
    up(c) { const p = RED; r(c, 2, -9, 12, 11, p[1]); r(c, 2, -9, 12, 1, p[3]); r(c, 2, 2, 12, 5, p[1]); r(c, 3, 7, 1, 8, '#2f3542'); r(c, 12, 7, 1, 8, '#2f3542'); r(c, 2, 13, 3, 3, '#1c1c22'); r(c, 11, 13, 3, 3, '#1c1c22'); },
    side(c) {
      const p = RED;
      r(c, 11, -9, 3, 11, p[2]); r(c, 11, -9, 1, 11, p[4]); r(c, 2, 0, 10, 2, '#ff7a3a'); r(c, 2, 2, 10, 5, p[2]); r(c, 2, 2, 10, 1, p[3]);
      r(c, 3, 7, 1, 8, '#2f3542'); r(c, 10, 7, 1, 8, '#2f3542'); r(c, 1, 13, 3, 3, '#1c1c22'); r(c, 0, 1, 2, 2, W8[3]); disc(c, 6, -4, 2, 1, '#e0e0e0');
    },
  },
  gnome: {
    down(c) {
      r(c, 4, 14, 8, 2, STN[2]); r(c, 4, 12, 3, 2, '#5a3a1e'); r(c, 9, 12, 3, 2, '#5a3a1e');
      r(c, 4, 4, 8, 8, '#3a6fb0'); r(c, 4, 4, 2, 8, '#5585cc'); r(c, 4, 8, 8, 1, '#2a1a10'); px(c, 8, 8, '#c9a24c'); r(c, 2, 5, 2, 4, '#3a6fb0'); r(c, 12, 5, 2, 4, '#3a6fb0');
      r(c, 13, 2, 1, 12, W8[3]); r(c, 12, 13, 3, 2, '#c9d2d8');
      r(c, 5, 0, 6, 3, '#f2c9a0'); px(c, 6, 1, '#1c1c22'); px(c, 9, 1, '#1c1c22'); r(c, 7, 2, 2, 2, '#e89a80');
      r(c, 5, 3, 6, 4, '#ffffff'); r(c, 6, 7, 4, 1, '#ffffff'); r(c, 6, 4, 1, 2, '#e3eaee');
      r(c, 4, -1, 8, 2, '#d9342b'); r(c, 5, -3, 6, 2, '#d9342b'); r(c, 6, -5, 4, 2, '#d9342b'); r(c, 7, -7, 2, 2, '#d9342b'); px(c, 8, -8, '#e85a4a'); r(c, 5, -3, 1, 2, '#e85a4a');
    },
    up(c) {
      r(c, 4, 14, 8, 2, STN[2]); r(c, 4, 12, 3, 2, '#5a3a1e'); r(c, 9, 12, 3, 2, '#5a3a1e'); r(c, 4, 3, 8, 9, '#2c5590'); r(c, 2, 5, 2, 4, '#2c5590'); r(c, 12, 5, 2, 4, '#2c5590');
      r(c, 4, -1, 8, 4, '#c02a22'); r(c, 5, -3, 6, 2, '#c02a22'); r(c, 6, -5, 4, 2, '#c02a22'); r(c, 7, -7, 2, 2, '#c02a22');
    },
    side(c) {
      r(c, 4, 14, 8, 2, STN[2]); r(c, 4, 12, 6, 2, '#5a3a1e'); r(c, 5, 4, 7, 8, '#3a6fb0'); r(c, 5, 8, 7, 1, '#2a1a10'); r(c, 6, 5, 3, 4, '#5585cc');
      r(c, 6, 0, 5, 3, '#f2c9a0'); px(c, 7, 1, '#1c1c22'); r(c, 4, 2, 2, 2, '#e89a80'); r(c, 4, 3, 4, 4, '#ffffff');
      r(c, 5, -1, 7, 2, '#d9342b'); r(c, 6, -3, 6, 2, '#d9342b'); r(c, 7, -5, 4, 2, '#d9342b'); r(c, 9, -7, 2, 2, '#d9342b'); px(c, 11, -8, '#e85a4a');
    },
  },
  trellis: {
    down(c) {
      r(c, 0, -13, 3, 29, '#f4f6f7'); r(c, 13, -13, 3, 29, '#f4f6f7'); r(c, 2, -13, 1, 29, '#d4dbe0'); r(c, 15, -13, 1, 29, '#d4dbe0');
      r(c, 1, -16, 4, 3, '#f4f6f7'); r(c, 11, -16, 4, 3, '#f4f6f7'); r(c, 3, -18, 10, 2, '#f4f6f7'); r(c, 5, -19, 6, 1, '#f4f6f7');
      for (const y of [-8, -2, 4, 10]) { r(c, 0, y, 3, 1, '#d4dbe0'); r(c, 13, y, 3, 1, '#d4dbe0'); }
      for (const [x, y] of [[0, 11], [12, 6], [-1, 1], [13, -4], [0, -10], [11, -14], [3, -19], [8, -20], [13, -10]]) {
        disc(c, x + 2, y, 2, 2, '#3f8a35'); px(c, x + 1, y - 1, '#5aa842'); px(c, x + 2, y, '#e9446a'); px(c, x + 3, y - 1, '#f590a8');
      }
    },
    up(c) { FACE.trellis.down(c); },
    side(c) {
      r(c, 6, -19, 4, 35, '#f4f6f7'); r(c, 6, -19, 1, 35, '#ffffff'); r(c, 9, -19, 1, 35, '#d4dbe0');
      for (const [x, y] of [[5, 11], [8, 4], [5, -3], [8, -10], [6, -18]]) { disc(c, x + 1, y, 2, 2, '#3f8a35'); px(c, x, y - 1, '#5aa842'); px(c, x + 1, y, '#e9446a'); px(c, x + 2, y - 1, '#f590a8'); }
    },
  },
});

export function paintObject(c, t, rot, W, H, now) {
  if (TURN[t]) {
    const [w0, h0] = footprint(t, 0);
    c.save();
    c.translate(W / 2, H / 2);
    c.rotate((rot * Math.PI) / 2);
    c.translate((-w0 * TILE) / 2, (-h0 * TILE) / 2);
    TURN[t](c, now);
    c.restore();
    return;
  }
  const f = FACE[t];
  if (f) {
    if (rot === 0) f.down(c, now);
    else if (rot === 2) f.up(c, now);
    else if (rot === 1) f.side(c, now);
    else { c.save(); c.translate(W, 0); c.scale(-1, 1); f.side(c, now); c.restore(); }
    return;
  }
  (OBJ[t] || OBJ.lamp)(c, now);
}

// Animation frames, expressed as a synthetic `now` so each frame is baked once.
export function frameNow(t, now) {
  if (t === 'tv') return (Math.floor(now / 700) % 2) * 700;
  if (t === 'fireplace' || t === 'firepit') return (Math.floor(now / 150) % 3) * 150;
  if (t === 'aquarium') return (Math.floor(now / 240) % 12) * 240;
  if (t === 'grandclock') return (Math.floor(now / 200) % 13) * 200;
  return 0;
}

export function objectSprite(t, rot, now) {
  const [w, h] = footprint(t, rot);
  const W = w * TILE, H = h * TILE;
  const fnow = frameNow(t, now);
  return bake(`obj|${t}|${rot}|${fnow}`, 4, 34, W + 8, H + 38, (cc) => paintObject(cc, t, rot, W, H, fnow));
}

// (x, y) = top-left of the item's anchor tile.
// opts.short draws walls cut away (Sims-style); opts.nb = { l, r } wall neighbours.
export function drawObject(c, o, x, y, now, opts = {}) {
  const def = ITEMS[o.t];
  if (!def) return;
  if (def.wall) return drawWall(c, o.t, x, y, opts.short, opts.nb);
  if (def.crop) return drawCrop(c, o, x, y, now);
  const rot = o.r || 0;
  const [w, h] = footprint(o.t, rot);
  const W = w * TILE, H = h * TILE;
  if (!def.flat) shadow(c, x + W / 2, y + H - 2, W / 2 - 1, Math.min(4, H / 5));
  blit(c, objectSprite(o.t, rot, now), x, y);
}

// Characters live in people.js.

// ---------- shops ----------
function paintShop(c, shop) {
  const W = shop.w * TILE, H = shop.h * TILE;
  const roof = ramp(shop.roof);
  const wall = shop.id === 'rosa' ? ['#b99a62', '#d7b97e', '#ecd39a', '#fae9bd'] : ['#7a5030', '#9b6436', '#b07a46', '#c99363'];
  r(c, 0, 6, W, H - 6, wall[2]);
  for (let yy = 8; yy < H - 4; yy += 4) { r(c, 0, yy, W, 1, wall[1]); r(c, 0, yy + 1, W, 1, wall[3]); }
  r(c, 0, 6, 3, H - 6, wall[3]); r(c, W - 3, 6, 3, H - 6, wall[0]);
  r(c, 0, H - 4, W, 4, '#8e877a'); r(c, 0, H - 4, W, 1, '#b6af9f');
  for (let i = 0; i < W; i += 6) r(c, i, H - 3, 1, 3, '#6f6a5f');
  const top = -30;
  for (let row = 0; row < 8; row++) {
    const yy = top + row * 5, inset = Math.max(0, 6 - row * 2);
    r(c, -3 + inset, yy, W + 6 - inset * 2, 5, roof[2]);
    for (let sx = -3 + inset + (row % 2 ? 3 : 0); sx < W + 3 - inset; sx += 6) {
      r(c, sx, yy + 4, 6, 1, roof[0]); r(c, sx, yy, 1, 4, roof[1]); r(c, sx + 1, yy, 4, 1, roof[3]);
    }
  }
  r(c, 4, top - 2, W - 8, 3, roof[1]); r(c, 4, top - 2, W - 8, 1, roof[3]);
  r(c, -3, top + 40, W + 6, 2, roof[0]);
  if (shop.id === 'otto') { r(c, W - 22, top - 12, 9, 18, '#8e877a'); r(c, W - 22, top - 12, 9, 2, '#b6af9f'); bricks(c, W - 22, top - 10, 9, 14); }
  r(c, W / 2 - 25, 10, 50, 11, W8[0]); r(c, W / 2 - 24, 11, 48, 9, W8[3]); r(c, W / 2 - 24, 11, 48, 1, W8[4]);
  const aw = shop.awning;
  for (const ax of [3, W - 27]) {
    for (let i = 0; i < 24; i += 4) { r(c, ax + i, 22, 4, 5, aw[(i / 4) % 2]); r(c, ax + i, 27, 3, 1, aw[(i / 4) % 2]); }
    r(c, ax, 22, 24, 1, lt(aw[0], 0.3));
    r(c, ax + 2, 29, 20, 11, W8[1]); r(c, ax + 3, 30, 18, 9, '#9fd8ef'); r(c, ax + 3, 30, 18, 2, '#d7f1fb');
    for (let i = 0; i < 4; i++) px(c, ax + 5 + i, 35 - i, '#e2f6ff');
    r(c, ax + 12, 30, 1, 9, W8[1]);
    if (shop.id === 'rosa') { disc(c, ax + 7, 37, 2, 1, '#e33b4a'); disc(c, ax + 17, 37, 2, 1, '#f28a2e'); }
    else { r(c, ax + 6, 34, 4, 5, W8[3]); r(c, ax + 15, 33, 3, 6, '#c9a227'); }
    r(c, ax + 1, 40, 22, 2, W8[3]); r(c, ax + 1, 40, 22, 1, W8[4]);
  }
  const dx = W / 2 - 8;
  r(c, dx - 1, 22, 18, H - 26, W8[0]); r(c, dx, 23, 16, H - 27, '#8a5a32'); r(c, dx, 23, 2, H - 27, '#a8703f');
  r(c, dx + 3, 26, 10, 7, '#9fd8ef'); r(c, dx + 3, 26, 10, 1, '#6aa8c8'); r(c, dx + 12, 36, 2, 2, '#f5c542');
  r(c, dx - 2, H - 4, 20, 2, '#b6af9f');
  if (shop.id === 'rosa') {
    for (const [cx, col] of [[3, '#f28a2e'], [W - 19, '#e33b4a']]) {
      r(c, cx, H - 11, 16, 9, W8[2]); r(c, cx, H - 11, 16, 2, W8[4]); r(c, cx + 7, H - 9, 1, 7, W8[1]);
      for (let i = 0; i < 5; i++) { disc(c, cx + 2 + i * 3, H - 12, 1, 1, col); px(c, cx + 2 + i * 3, H - 13, lt(col, 0.4)); }
    }
  } else {
    r(c, 4, H - 12, 14, 10, W8[3]); r(c, 4, H - 12, 14, 2, W8[4]); r(c, 6, H - 2, 2, 2, W8[1]); r(c, 14, H - 2, 2, 2, W8[1]);
    r(c, W - 17, H - 18, 9, 8, W8[2]); r(c, W - 18, H - 10, 11, 3, W8[4]); r(c, W - 17, H - 7, 1, 7, W8[1]); r(c, W - 9, H - 7, 1, 7, W8[1]);
  }
}

export function drawShop(c, shop) {
  const x = shop.x * TILE, y = shop.y * TILE;
  r(c, x + 2, y + shop.h * TILE - 2, shop.w * TILE - 4, 4, 'rgba(24,16,8,0.2)');
  blit(c, bake(`shop|${shop.id}`, 6, 46, shop.w * TILE + 12, shop.h * TILE + 50, (cc) => paintShop(cc, shop)), x, y);
}
// Where the shop's name should be printed (world px, text baseline).
export const shopSignY = (shop) => shop.y * TILE + 19;

// ---------- icons ----------
// How far tall items reach above their tile (px), so the icon fits them in.
const ICON_TOP = { fireplace: 28, grandclock: 23, wardrobe: 30, shower: 22, fridge: 20, floorvase: 20,
  arcade: 24, arclamp: 21, trellis: 21, cattree: 19, easel: 19, vanity: 18, cactus: 16, pedestalsink: 13, lantern: 7 };
export function itemIcon(itemId, size = 44) {
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const c = cv.getContext('2d');
  c.imageSmoothingEnabled = false;
  const def = ITEMS[itemId];
  c.scale(size / 32, size / 32);
  if (def.layer === 'floor') { c.translate(4, 4); c.scale(1.5, 1.5); drawFloor(c, itemId, 0, 0, 0, 0); return cv; }
  if (def.crop) { c.translate(4, 4); c.scale(1.5, 1.5); drawFloor(c, 'soil', 0, 0); drawObject(c, { t: itemId, p: 0 }, 0, 0, 1e15); return cv; }
  const [w, h] = footprint(itemId, 0);
  const W = w * TILE, H = h * TILE, top = def.wall ? 16 : ICON_TOP[itemId] || 16;
  const s = Math.min(30 / W, 30 / (H + top), 1.25);
  c.translate((32 - W * s) / 2, (32 - (H + top) * s) / 2 + top * s);
  c.scale(s, s);
  drawObject(c, { t: itemId }, 0, 0, 0, { short: false });
  return cv;
}

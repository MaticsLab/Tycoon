// Pixel-art textures for the 3D world. Everything is painted with the same
// fillRect painters as the 2D sprites, then sampled with nearest-neighbour
// filtering so texels stay crisp, chunky pixels.
import * as THREE from 'three';
import { r, px, disc, dk, lt, ramp, mix, FLOOR } from '../sprites.js';
import { tileHash } from '@shared/world.js';
import { ITEMS } from '@shared/catalog.js';

export const TEXEL = 16; // texels per world unit (one tile)

// Magnified texels stay crisp (nearest); minified ones are mip-mapped so a zoomed-out,
// moving camera doesn't turn fine pixel detail into shimmering "static".
export function canvasTex(cv, repeat = false) {
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; }
  return t;
}

const cache = new Map();
export function paintTex(id, w, h, paint, repeat = true) {
  let t = cache.get(id);
  if (!t) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    paint(cv.getContext('2d'), w, h);
    t = canvasTex(cv, repeat);
    cache.set(id, t);
  }
  return t;
}

// ---------- walls (one segment = 16 x 40 texels: 1 unit wide, 2.5 units tall) ----------
export const WALL_H = 2.5;
const WH = WALL_H * TEXEL;

function siding(c, base, board = 4) {
  const [s, sh, b, l] = ramp(base);
  r(c, 0, 0, 16, WH, b);
  for (let y = 0; y < WH; y += board) { r(c, 0, y, 16, 1, l); r(c, 0, y + board - 1, 16, 1, sh); }
  for (let i = 0; i < 6; i++) px(c, Math.floor(tileHash(i, 3) * 16), Math.floor(tileHash(3, i) * WH), s);
}

const WALL_PAINT = {
  wall_wood(c) {
    const p = ['#5a3519', '#7a4c27', '#9b6436', '#bb8250', '#d6a26d'];
    r(c, 0, 0, 16, WH, p[2]);
    for (let y = 0; y < WH; y += 5) {
      r(c, 0, y, 16, 1, p[4]); r(c, 0, y + 1, 16, 2, p[3]); r(c, 0, y + 3, 16, 1, p[2]); r(c, 0, y + 4, 16, 1, p[0]);
      const k = Math.floor(tileHash(y, 7) * 14);
      if (tileHash(7, y) > 0.6) { px(c, k, y + 2, p[1]); px(c, k + 1, y + 2, p[0]); }
    }
  },
  wall_white(c) {
    const p = ['#c9bea6', '#ddd3bd', '#ece4d2', '#f8f2e4'];
    r(c, 0, 0, 16, WH, p[2]);
    for (let y = 0; y < WH; y++) for (let x = 0; x < 16; x++) {
      const h = tileHash(x * 5 + 11, y * 3 + 7);
      if (h < 0.06) px(c, x, y, p[1]); else if (h > 0.95) px(c, x, y, p[3]);
    }
    r(c, 0, WH - 3, 16, 3, '#9b6436'); r(c, 0, WH - 3, 16, 1, '#bb8250');
  },
  wall_brick(c) {
    const p = ['#6e2c20', '#93402e', '#b0533c', '#cc7357'];
    r(c, 0, 0, 16, WH, '#8e8578');
    for (let row = 0; row * 4 < WH; row++) {
      for (let bx = row % 2 ? -4 : 0; bx < 16; bx += 8) {
        const col = p[1 + Math.floor(tileHash(bx + 9, row) * 3)];
        r(c, bx, row * 4, 7, 3, col); r(c, bx, row * 4, 7, 1, lt(col, 0.2)); px(c, bx + 6, row * 4 + 2, dk(col, 0.2));
      }
    }
  },
  wall_stone(c) {
    const p = ['#6f6a5f', '#8e877a', '#a9a294', '#c5beb0', '#ddd7cb'];
    r(c, 0, 0, 16, WH, p[0]);
    let y = 0;
    while (y < WH) {
      const rh = 5 + Math.floor(tileHash(y, 1) * 3);
      let x = -Math.floor(tileHash(y, 2) * 6);
      while (x < 16) {
        const w = 5 + Math.floor(tileHash(x + 20, y) * 5);
        const col = p[1 + Math.floor(tileHash(x, y + 5) * 3)];
        r(c, x + 1, y + 1, w - 1, rh - 1, col); r(c, x + 1, y + 1, w - 1, 1, lt(col, 0.25)); r(c, x + 1, y + rh - 1, w - 1, 1, dk(col, 0.15));
        x += w;
      }
      y += rh;
    }
  },
  wall_blue(c) { siding(c, '#7fa7c9'); r(c, 0, WH - 3, 16, 3, '#f2efe6'); },
  wall_sage(c) { siding(c, '#9cb88a'); r(c, 0, WH - 3, 16, 3, '#f2efe6'); },
};

export function wallTex(m) {
  return paintTex(`wall|${m}`, 16, WH, (c) => (WALL_PAINT[m] || WALL_PAINT.wall_white)(c));
}

// ---------- floors: 4x4 tile atlas per floor type, so neighbouring tiles vary ----------
export function floorTex(type) {
  return paintTex(`floor|${type}`, 64, 64, (c) => {
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) (FLOOR[type] || FLOOR.floor_wood)(c, i * 16, j * 16, i, j);
  }, false);
}

// ---------- roofs ----------
export function roofTex(m) {
  const col = ITEMS[m]?.color || '#b2412f';
  return paintTex(`roof|${m}`, 16, 16, (c) => {
    const [s, sh, b, l] = ramp(col);
    if (m === 'roof_thatch') {
      r(c, 0, 0, 16, 16, b);
      for (let x = 0; x < 16; x++) { const h = tileHash(x, 4); r(c, x, 0, 1, 16, h > 0.6 ? l : h < 0.25 ? sh : b); }
      r(c, 0, 7, 16, 1, s); r(c, 0, 15, 16, 1, s);
      return;
    }
    for (let row = 0; row < 4; row++) {
      const y = row * 4;
      r(c, 0, y, 16, 4, b); r(c, 0, y + 3, 16, 1, s);
      for (let x = row % 2 ? 2 : 0; x < 16; x += 4) { r(c, x, y, 1, 3, sh); px(c, x + 1, y, l); }
    }
  });
}

// ---------- generic materials ----------
export const woodTex = () => paintTex('wood', 16, 16, (c) => {
  const p = ['#5a3519', '#7a4c27', '#9b6436', '#bb8250'];
  for (let y = 0; y < 16; y += 4) { r(c, 0, y, 16, 4, p[2]); r(c, 0, y, 16, 1, p[3]); r(c, 0, y + 3, 16, 1, p[0]); r(c, Math.floor(tileHash(y, 2) * 14), y + 1, 1, 2, p[1]); }
});
export const stoneTex = () => paintTex('stone', 16, 16, (c) => {
  const p = ['#7d776b', '#9a9384', '#b6af9f', '#d3cdbf'];
  r(c, 0, 0, 16, 16, p[0]);
  for (const [x, y, w, h] of [[0, 0, 7, 5], [8, 0, 8, 5], [0, 6, 4, 4], [5, 6, 7, 4], [13, 6, 3, 4], [0, 11, 9, 5], [10, 11, 6, 5]]) {
    const col = p[1 + Math.floor(tileHash(x, y) * 2)];
    r(c, x, y, w - 1, h - 1, col); r(c, x, y, w - 1, 1, p[3]);
  }
});
// Subtle dithered grain multiplied over flat-coloured furniture so it reads as pixel art.
export const grainTex = () => paintTex('grain', 16, 16, (c) => {
  r(c, 0, 0, 16, 16, '#ffffff');
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const h = tileHash(x * 3 + 1, y * 7 + 2);
    if (h < 0.18) px(c, x, y, '#e6e1d8'); else if (h > 0.9) px(c, x, y, '#f3efe8');
  }
  r(c, 0, 0, 16, 1, '#f7f4ee'); r(c, 0, 15, 16, 1, '#d8d2c6');
});

// Soft round blob shadow for billboards.
export const blobTex = () => paintTex('blob', 16, 16, (c) => disc(c, 8, 8, 7, 5, 'rgba(20,12,6,0.32)'), false);

// Pixel text on a plank (shop signs).
export function signTex(text, w = 96, h = 18) {
  return paintTex(`sign|${text}`, w, h, (c) => {
    r(c, 0, 0, w, h, '#4a2e18'); r(c, 1, 1, w - 2, h - 2, '#a8703f'); r(c, 1, 1, w - 2, 1, '#c99363');
    c.font = 'bold 11px "Trebuchet MS", sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#3a2716';
    c.fillText(text, w / 2, h / 2 + 1);
  }, false);
}

export { mix };

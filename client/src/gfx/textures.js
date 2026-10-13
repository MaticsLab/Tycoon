// Pixel-art textures for the 3D world. Everything is painted with the same
// fillRect painters as the 2D sprites, then sampled with nearest-neighbour
// filtering so texels stay crisp, chunky pixels.
import { canvasTexture } from './bjs.js';
import { r, px, disc, dk, lt, ramp, mix, FLOOR } from '../sprites.js';
import { tileHash } from '@shared/world.js';
import { ITEMS } from '@shared/catalog.js';

export const TEXEL = 16; // texels per world unit (one tile)

// Magnified texels stay crisp (nearest); minified ones are mip-mapped so a zoomed-out,
// moving camera doesn't turn fine pixel detail into shimmering "static".
export function canvasTex(cv, repeat = false) {
  return canvasTexture(cv, repeat);
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
  // Wide white boards with deep shadow lines.
  wall_shiplap(c) {
    r(c, 0, 0, 16, WH, '#f2efe6');
    for (let y = 0; y < WH; y += 5) { r(c, 0, y, 16, 1, '#c9c3b4'); r(c, 0, y + 1, 16, 1, '#fbf9f3'); if (tileHash(y, 9) > 0.5) px(c, Math.floor(tileHash(9, y) * 16), y + 3, '#e2ddd1'); }
  },
  // Sun-warmed plaster with a speckle and a darker plinth.
  wall_stucco(c) {
    const p = ['#c9a37a', '#dbb88f', '#e8c9a0', '#f3dbb8'];
    r(c, 0, 0, 16, WH, p[2]);
    for (let y = 0; y < WH; y++) for (let x = 0; x < 16; x++) { const h = tileHash(x * 7 + 3, y * 5 + 1); if (h < 0.1) px(c, x, y, p[1]); else if (h > 0.93) px(c, x, y, p[3]); else if (h > 0.9) px(c, x, y, p[0]); }
    r(c, 0, WH - 4, 16, 4, '#a98563'); r(c, 0, WH - 4, 16, 1, '#c29d78');
  },
  // Overlapping cedar shingles, staggered rows with ragged ends.
  wall_shingle(c) {
    const p = ['#6e3f1f', '#8a522b', '#a8683a', '#c28150', '#d79a68'];
    r(c, 0, 0, 16, WH, p[0]);
    for (let row = 0; row * 4 < WH; row++) {
      for (let x = row % 2 ? -2 : 0; x < 16; x += 4) {
        const col = p[1 + Math.floor(tileHash(x + 30, row) * 3)];
        const h = 4 + (tileHash(x, row + 7) > 0.6 ? 1 : 0);
        r(c, x, row * 4, 3, h, col); px(c, x, row * 4, p[4]); px(c, x + 2, row * 4 + h - 1, p[0]);
      }
    }
  },
  // Vertical boards with battens over the joins (painted forest green).
  wall_board(c) {
    const [s0, sh, b, l] = ramp('#4f7a5a');
    r(c, 0, 0, 16, WH, b);
    for (const x of [0, 8]) { r(c, x, 0, 2, WH, l); r(c, x + 2, 0, 1, WH, sh); }
    for (let i = 0; i < 5; i++) px(c, Math.floor(tileHash(i, 11) * 16), Math.floor(tileHash(11, i) * WH), s0);
  },
  // Bricks under a coat of chalky white paint (some brick peeking through).
  wall_paintbrick(c) {
    r(c, 0, 0, 16, WH, '#cfc8bb');
    for (let row = 0; row * 4 < WH; row++) {
      for (let bx = row % 2 ? -4 : 0; bx < 16; bx += 8) {
        const worn = tileHash(bx + 3, row * 3) > 0.86;
        const col = worn ? '#c47f66' : tileHash(bx, row) > 0.5 ? '#eeeae1' : '#e5e0d5';
        r(c, bx, row * 4, 7, 3, col); r(c, bx, row * 4, 7, 1, worn ? '#d89a82' : '#f8f6f0');
      }
    }
  },
  // Dark slate stone, chunky blocks.
  wall_darkstone(c) {
    const p = ['#3c424b', '#4d545f', '#5d6470', '#707886', '#8a92a0'];
    r(c, 0, 0, 16, WH, p[0]);
    let y = 0;
    while (y < WH) {
      const rh = 4 + Math.floor(tileHash(y, 3) * 3);
      let x = -Math.floor(tileHash(y, 5) * 6);
      while (x < 16) { const w = 6 + Math.floor(tileHash(x + 40, y) * 5); const col = p[1 + Math.floor(tileHash(x, y + 9) * 3)]; r(c, x, y, w - 1, rh - 1, col); r(c, x, y, w - 1, 1, p[4]); x += w; }
      y += rh;
    }
  },
  // Painted shopfront panelling: raised panels, a moulded cornice and a kick plate.
  wall_shopfront(c) {
    const [s0, sh, b, l] = ramp('#2f4f6a');
    r(c, 0, 0, 16, WH, b);
    r(c, 0, 0, 16, 3, l); r(c, 0, 3, 16, 1, s0);                     // cornice
    for (const [y, h] of [[6, 14], [23, 12]]) { r(c, 2, y, 12, h, sh); r(c, 3, y + 1, 10, h - 2, b); r(c, 3, y + 1, 10, 1, l); r(c, 2, y + h - 1, 12, 1, s0); }
    r(c, 0, WH - 4, 16, 4, s0); r(c, 0, WH - 4, 16, 1, sh);            // kick plate
    for (const x of [0, 15]) r(c, x, 4, 1, WH - 8, l);
  },
  // Glossy white subway tile with grey grout (kitchens and bathrooms).
  wall_subway(c) {
    r(c, 0, 0, 16, WH, '#c5cbd0');
    for (let row = 0; row * 3 < WH; row++) for (let bx = row % 2 ? -4 : 0; bx < 16; bx += 8) { r(c, bx, row * 3, 7, 2, '#f4f6f7'); r(c, bx, row * 3, 7, 1, '#ffffff'); }
  },
  // Pink floral wallpaper over a white skirting board.
  wall_paper(c) {
    r(c, 0, 0, 16, WH, '#e8c3c9');
    for (let y = 2; y < WH - 4; y += 6) for (let x = (y / 6) % 2 ? 4 : 0; x < 16; x += 8) {
      px(c, x + 1, y, '#c4566c'); px(c, x, y + 1, '#c4566c'); px(c, x + 2, y + 1, '#c4566c'); px(c, x + 1, y + 2, '#c4566c'); px(c, x + 1, y + 1, '#f5d36b'); px(c, x + 2, y + 3, '#6f9a5a');
    }
    r(c, 0, WH - 3, 16, 3, '#f2efe6'); r(c, 0, WH - 3, 16, 1, '#ffffff');
  },
  // Sage paint above, white panelled wainscot below a chair rail.
  wall_wainscot(c) {
    r(c, 0, 0, 16, WH, '#c9dcc4');
    for (let y = 0; y < 20; y++) for (let x = 0; x < 16; x++) if (tileHash(x * 3, y * 11) < 0.05) px(c, x, y, '#b7cbb1');
    r(c, 0, 20, 16, 2, '#ffffff'); r(c, 0, 22, 16, 1, '#c8c2b5');     // chair rail
    r(c, 0, 23, 16, WH - 23, '#f2efe6');
    for (const x of [1, 9]) { r(c, x, 25, 6, WH - 30, '#e2ddd1'); r(c, x + 1, 26, 4, WH - 32, '#f8f6f0'); }
    r(c, 0, WH - 3, 16, 3, '#ddd7cb');
  },
  wall_sage(c) { siding(c, '#9cb88a'); r(c, 0, WH - 3, 16, 3, '#f2efe6'); },
};

// Doors: 16 × 32 texels, painted `col`. style 'panel' = four raised panels;
// 'french' = a low panel with the top left clear (the glass is a separate pane).
export function doorTex(col, style = 'panel') {
  return paintTex(`door|${col}|${style}`, 16, 32, (c) => {
    const [s0, sh, b, l] = ramp(col);
    r(c, 0, 0, 16, 32, b);
    r(c, 0, 0, 16, 1, l); r(c, 0, 0, 1, 32, l); r(c, 15, 0, 1, 32, s0); r(c, 0, 31, 16, 1, s0);
    const panel = (x, y, w, h) => { r(c, x, y, w, h, sh); r(c, x + 1, y + 1, w - 2, h - 2, b); r(c, x + 1, y + 1, w - 2, 1, l); r(c, x + 1, y + h - 2, w - 2, 1, sh); };
    if (style === 'panel') { panel(2, 2, 5, 12); panel(9, 2, 5, 12); panel(2, 17, 5, 12); panel(9, 17, 5, 12); }
    else { panel(2, 20, 12, 9); r(c, 2, 2, 12, 15, s0); r(c, 3, 3, 10, 13, sh); }
    if (col === '#9b6436') for (let i = 0; i < 8; i++) px(c, 1 + Math.floor(tileHash(i, 21) * 14), Math.floor(tileHash(21, i) * 31), s0); // wood grain
  }, false);
}

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
    if (m === 'roof_glass') {
      // Greenhouse panes in white frames.
      r(c, 0, 0, 16, 16, '#9fd0e2');
      r(c, 1, 1, 6, 6, '#c6e8f2'); r(c, 9, 1, 6, 6, '#b4dfec'); r(c, 1, 9, 6, 6, '#b4dfec'); r(c, 9, 9, 6, 6, '#c6e8f2');
      r(c, 2, 2, 2, 1, '#eef9fc'); r(c, 10, 10, 2, 1, '#eef9fc');
      r(c, 0, 0, 16, 1, '#f4f4ee'); r(c, 0, 8, 16, 1, '#f4f4ee'); r(c, 0, 0, 1, 16, '#f4f4ee'); r(c, 8, 0, 1, 16, '#f4f4ee');
      return;
    }
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
// Striped canvas for awnings, with a scalloped edge (alpha) along the bottom.
export function awningTex(a, b) {
  return paintTex(`awning2|${a}|${b}`, 32, 16, (c) => {
    for (let i = 0; i < 32; i += 4) r(c, i, 0, 4, 13, (i / 4) % 2 ? b : a);
    for (let i = 0; i < 32; i += 4) { r(c, i, 13, 4, 1, (i / 4) % 2 ? b : a); r(c, i + 1, 14, 2, 1, (i / 4) % 2 ? b : a); }
    r(c, 0, 0, 32, 1, 'rgba(255,255,255,.55)'); r(c, 0, 12, 32, 1, 'rgba(0,0,0,.18)');
  }, false);
}

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

// Procedural pixel art. Everything is drawn with fillRect at 1 unit = 1 world px,
// so it stays crisp when the canvas is scaled up with smoothing disabled.
import { T, TILE, MAP_W, MAP_H, tileHash } from '@shared/world.js';
import { ITEMS, cropStage } from '@shared/catalog.js';

const r = (c, x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };

const GRASS = ['#71b54a', '#68ab43', '#7cc055'];
const LAWN = ['#7cc65a', '#86cf63'];

function grass(c, x, y, tx, ty) {
  r(c, x, y, TILE, TILE, GRASS[0]);
  for (let i = 0; i < 6; i++) {
    const h = tileHash(tx * 7 + i, ty * 13 + i);
    const px = Math.floor(h * 16), py = Math.floor(tileHash(ty + i * 3, tx - i) * 15);
    r(c, x + px, y + py, 1, 2, i % 2 ? GRASS[1] : GRASS[2]);
  }
}

function drawTile(c, tiles, tx, ty) {
  const t = tiles[ty * MAP_W + tx];
  const x = tx * TILE, y = ty * TILE;
  const at = (dx, dy) => {
    const nx = tx + dx, ny = ty + dy;
    return nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H ? -1 : tiles[ny * MAP_W + nx];
  };
  switch (t) {
    case T.GRASS: case T.TREE: grass(c, x, y, tx, ty); break;
    case T.TALLGRASS:
      grass(c, x, y, tx, ty);
      for (const [px, py] of [[3, 8], [8, 5], [11, 10]]) {
        r(c, x + px, y + py, 1, 5, '#4f8f34'); r(c, x + px + 1, y + py + 1, 1, 4, '#5ea13c'); r(c, x + px - 1, y + py + 2, 1, 3, '#5ea13c');
      }
      break;
    case T.FLOWERS: {
      grass(c, x, y, tx, ty);
      const cols = ['#f7f3e3', '#f5d547', '#e9748f', '#9b8cf2'];
      for (let i = 0; i < 4; i++) {
        const px = 2 + Math.floor(tileHash(tx + i, ty * 3) * 12), py = 2 + Math.floor(tileHash(ty + i, tx * 5) * 12);
        r(c, x + px, y + py + 1, 1, 2, '#4f8f34');
        r(c, x + px - 1, y + py, 3, 1, cols[(tx + ty + i) % 4]); r(c, x + px, y + py - 1, 1, 3, cols[(tx + ty + i) % 4]);
        r(c, x + px, y + py, 1, 1, '#f5c542');
      }
      break;
    }
    case T.ROCK:
      grass(c, x, y, tx, ty);
      r(c, x + 3, y + 7, 10, 7, '#8a8f98'); r(c, x + 4, y + 6, 8, 1, '#9da3ac'); r(c, x + 4, y + 7, 5, 3, '#aab0b8'); r(c, x + 3, y + 13, 10, 1, '#6c7079');
      break;
    case T.PATH: case T.GATE: {
      r(c, x, y, TILE, TILE, '#d2ad74');
      for (let i = 0; i < 4; i++) {
        const px = Math.floor(tileHash(tx * 3 + i, ty) * 15), py = Math.floor(tileHash(ty * 5 + i, tx) * 15);
        r(c, x + px, y + py, 2, 1, i % 2 ? '#b9945c' : '#e2c08d');
      }
      // Soften edges into grass.
      const g = (n) => n === T.GRASS || n === T.FLOWERS || n === T.TALLGRASS || n === T.ROCK || n === T.TREE;
      if (g(at(0, -1))) r(c, x, y, TILE, 1, '#a9c25a');
      if (g(at(0, 1))) r(c, x, y + 15, TILE, 1, '#a9c25a');
      if (g(at(-1, 0))) r(c, x, y, 1, TILE, '#a9c25a');
      if (g(at(1, 0))) r(c, x + 15, y, 1, TILE, '#a9c25a');
      if (t === T.GATE) {
        const left = at(-1, 0) === T.FENCE;
        if (left) { r(c, x, y + 2, 3, 12, '#8a5a32'); r(c, x, y + 2, 3, 2, '#a8713f'); }
        else { r(c, x + 13, y + 2, 3, 12, '#8a5a32'); r(c, x + 13, y + 2, 3, 2, '#a8713f'); }
      }
      break;
    }
    case T.WATER: {
      r(c, x, y, TILE, TILE, '#4f9fd8');
      for (let i = 0; i < 2; i++) {
        const px = Math.floor(tileHash(tx + i * 9, ty) * 11), py = 3 + i * 7;
        r(c, x + px, y + py, 5, 1, '#79bde8');
      }
      if (at(0, -1) !== T.WATER) r(c, x, y, TILE, 2, '#3c84b8');
      break;
    }
    case T.SAND:
      r(c, x, y, TILE, TILE, '#ead6a0');
      r(c, x + Math.floor(tileHash(tx, ty) * 14), y + Math.floor(tileHash(ty, tx) * 14), 1, 1, '#d4bd82');
      break;
    case T.PLAZA: case T.FOUNTAIN:
      r(c, x, y, TILE, TILE, (tx + ty) % 2 ? '#cfc8b8' : '#c7c0ae');
      r(c, x, y + 15, TILE, 1, '#b3ab98'); r(c, x + 15, y, 1, TILE, '#b3ab98');
      break;
    case T.LAWN: {
      r(c, x, y, TILE, TILE, LAWN[tx % 2]);
      const h = tileHash(tx, ty);
      r(c, x + Math.floor(h * 14), y + Math.floor(tileHash(ty, tx) * 14), 1, 2, '#6fb54f');
      break;
    }
    case T.FENCE: {
      const inner = LAWN[tx % 2];
      r(c, x, y, TILE, TILE, inner);
      const horiz = at(-1, 0) === T.FENCE || at(1, 0) === T.FENCE || at(-1, 0) === T.GATE || at(1, 0) === T.GATE;
      const vert = at(0, -1) === T.FENCE || at(0, 1) === T.FENCE;
      if (horiz) { r(c, x, y + 5, TILE, 2, '#b07a46'); r(c, x, y + 10, TILE, 2, '#b07a46'); r(c, x, y + 12, TILE, 1, '#7a4f2b'); }
      if (vert) { r(c, x + 6, y, 2, TILE, '#b07a46'); r(c, x + 8, y, 1, TILE, '#7a4f2b'); }
      r(c, x + 5, y + 2, 4, 12, '#8a5a32'); r(c, x + 5, y + 2, 4, 2, '#c08850');
      break;
    }
  }
}

export function renderGround(world) {
  const cv = document.createElement('canvas');
  cv.width = MAP_W * TILE; cv.height = MAP_H * TILE;
  const c = cv.getContext('2d');
  for (let ty = 0; ty < MAP_H; ty++) for (let tx = 0; tx < MAP_W; tx++) drawTile(c, world.tiles, tx, ty);
  // Fountain basin (4x4 tiles at 40,24).
  const fx = 40 * TILE, fy = 24 * TILE;
  r(c, fx + 2, fy + 4, 60, 58, '#8e8a80'); r(c, fx + 4, fy + 2, 56, 58, '#a9a397');
  r(c, fx + 8, fy + 8, 48, 46, '#4f9fd8'); r(c, fx + 10, fy + 10, 44, 3, '#3c84b8');
  r(c, fx + 26, fy + 22, 12, 16, '#bdb6a8'); r(c, fx + 28, fy + 18, 8, 6, '#d6d0c3');
  return cv;
}

export function drawTree(c, x, y, variant) {
  // x, y = tile top-left. Canopy extends a tile and a half upward.
  r(c, x + 2, y + 13, 12, 3, 'rgba(0,0,0,0.18)');
  r(c, x + 6, y + 6, 4, 9, '#7a4f2b'); r(c, x + 6, y + 6, 1, 9, '#946238');
  const dark = variant > 0.5 ? '#2f7a3b' : '#3a8a3c', mid = variant > 0.5 ? '#3f9447' : '#4ea04a', lite = '#6cbf5a';
  r(c, x - 1, y - 8, 18, 14, dark);
  r(c, x + 1, y - 12, 14, 4, dark);
  r(c, x + 1, y - 10, 14, 13, mid);
  r(c, x + 3, y - 12, 10, 3, mid);
  r(c, x + 3, y - 9, 5, 3, lite); r(c, x + 9, y - 4, 3, 2, lite);
  if (variant > 0.8) { r(c, x + 4, y - 2, 2, 2, '#e05050'); r(c, x + 11, y - 7, 2, 2, '#e05050'); }
}

const FLOOR = {
  floor_wood(c, x, y, lx, ly) {
    r(c, x, y, TILE, TILE, '#b98552');
    for (let i = 0; i < 4; i++) r(c, x, y + i * 4 + 3, TILE, 1, '#9c6b3e');
    r(c, x + ((lx * 5 + ly * 3) % 12) + 2, y, 1, 4, '#9c6b3e');
    r(c, x + ((lx * 3 + ly * 7) % 12) + 2, y + 8, 1, 4, '#9c6b3e');
  },
  floor_tile(c, x, y) {
    r(c, x, y, TILE, TILE, '#e8eef0');
    r(c, x, y + 7, TILE, 1, '#c4ccd0'); r(c, x + 7, y, 1, TILE, '#c4ccd0');
    r(c, x, y + 15, TILE, 1, '#c4ccd0'); r(c, x + 15, y, 1, TILE, '#c4ccd0');
  },
  floor_checker(c, x, y, lx, ly) {
    r(c, x, y, TILE, TILE, (lx + ly) % 2 ? '#2f3542' : '#f1f2f6');
  },
  floor_red(c, x, y, lx, ly) {
    r(c, x, y, TILE, TILE, '#b33b44');
    r(c, x + ((lx + ly) % 2) * 8, y + 4, 4, 1, '#c95560'); r(c, x + 6, y + 11, 4, 1, '#9a2f38');
  },
  floor_blue(c, x, y, lx, ly) {
    r(c, x, y, TILE, TILE, '#3d5a98');
    r(c, x + ((lx + ly) % 2) * 8, y + 4, 4, 1, '#5574b5'); r(c, x + 6, y + 11, 4, 1, '#2f4880');
  },
  floor_stone(c, x, y, lx, ly) {
    r(c, x, y, TILE, TILE, '#7ec25b');
    const o = (lx + ly) % 2 ? 1 : 0;
    r(c, x + 1, y + 1 + o, 7, 6, '#b8b2a5'); r(c, x + 9, y + 3 - o, 6, 5, '#aaa396'); r(c, x + 3, y + 9, 8, 6, '#b8b2a5');
  },
  soil(c, x, y) {
    r(c, x, y, TILE, TILE, '#6e4a2c');
    for (let i = 0; i < 4; i++) r(c, x + 1, y + i * 4 + 2, 14, 1, '#5a3a21');
    r(c, x, y, TILE, 1, '#82593a');
  },
};

export function drawFloor(c, type, x, y, lx = 0, ly = 0) {
  (FLOOR[type] || FLOOR.floor_wood)(c, x, y, lx, ly);
}

const WALL = {
  wall_wood: ['#a8703f', '#8a5a32', '#c99363'],
  wall_brick: ['#b4533e', '#8f3d2c', '#d8c6b0'],
  wall_white: ['#ece4d4', '#cfc4ae', '#fbf7ef'],
  window: ['#ece4d4', '#cfc4ae', '#fbf7ef'],
  door: ['#ece4d4', '#cfc4ae', '#fbf7ef'],
};

function wall(c, t, x, y, short) {
  const [face, shade, cap] = WALL[t];
  if (short) {
    r(c, x, y + 8, TILE, 8, face); r(c, x, y + 6, TILE, 3, cap); r(c, x, y + 15, TILE, 1, shade);
    if (t === 'door') { r(c, x + 3, y + 8, 10, 8, '#8a5a32'); }
    if (t === 'window') r(c, x + 4, y + 10, 8, 3, '#8fd0f0');
    return;
  }
  r(c, x, y - 12, TILE, 28, face);
  r(c, x, y - 14, TILE, 5, cap);
  r(c, x, y + 15, TILE, 1, shade);
  if (t === 'wall_brick') {
    for (let i = 0; i < 6; i++) { r(c, x, y - 8 + i * 4, TILE, 1, shade); r(c, x + (i % 2 ? 4 : 11), y - 8 + i * 4, 1, 4, shade); }
  } else if (t === 'wall_wood') {
    for (let i = 0; i < 3; i++) r(c, x + 3 + i * 5, y - 9, 1, 24, shade);
  } else {
    r(c, x, y + 10, TILE, 2, shade);
  }
  if (t === 'window') {
    r(c, x + 3, y - 6, 10, 12, '#6b5640'); r(c, x + 4, y - 5, 8, 10, '#8fd0f0');
    r(c, x + 4, y - 5, 3, 3, '#d7f1fb'); r(c, x + 7, y - 5, 1, 10, '#6b5640'); r(c, x + 4, y, 8, 1, '#6b5640');
  }
  if (t === 'door') {
    r(c, x + 2, y - 7, 12, 23, '#6b4a2b'); r(c, x + 3, y - 6, 10, 22, '#9c6b3e');
    r(c, x + 4, y - 4, 8, 6, '#ae7d4e'); r(c, x + 4, y + 4, 8, 8, '#ae7d4e'); r(c, x + 11, y + 3, 1, 2, '#f5d547');
  }
}

const CROP_COL = { turnip: '#f0e6f0', carrot: '#f28a2e', berry: '#e33b4a', pumpkin: '#f0882a' };

function crop(c, o, x, y, now) {
  const type = ITEMS[o.t].crop;
  const s = cropStage(o, now);
  const g = '#4f9e3a', g2 = '#6cc04a';
  if (s === 0) { r(c, x + 7, y + 9, 1, 3, g); r(c, x + 6, y + 9, 1, 1, g2); r(c, x + 8, y + 8, 1, 1, g2); return; }
  if (s === 1) { r(c, x + 7, y + 6, 2, 7, g); r(c, x + 5, y + 7, 2, 2, g2); r(c, x + 9, y + 6, 2, 2, g2); return; }
  if (s === 2) {
    r(c, x + 7, y + 3, 2, 10, g); r(c, x + 4, y + 4, 3, 3, g2); r(c, x + 9, y + 3, 3, 3, g2); r(c, x + 5, y + 8, 6, 2, g);
    return;
  }
  const col = CROP_COL[type];
  if (type === 'pumpkin') {
    r(c, x + 2, y + 5, 12, 9, col); r(c, x + 3, y + 4, 10, 11, col); r(c, x + 7, y + 4, 2, 11, '#c96a1a');
    r(c, x + 4, y + 6, 2, 3, '#f7a95a'); r(c, x + 7, y + 1, 2, 4, '#4f7a2a');
  } else if (type === 'berry') {
    r(c, x + 3, y + 4, 10, 8, g); r(c, x + 4, y + 3, 8, 2, g2);
    for (const [px, py] of [[4, 8], [9, 6], [7, 10], [11, 9]]) { r(c, x + px, y + py, 2, 3, col); r(c, x + px, y + py, 1, 1, '#ff8a95'); }
  } else {
    r(c, x + 5, y + 2, 2, 5, g2); r(c, x + 8, y + 1, 2, 6, g); r(c, x + 10, y + 3, 2, 4, g2);
    r(c, x + 5, y + 7, 6, 6, col); r(c, x + 6, y + 13, 4, 1, col);
    if (type === 'turnip') r(c, x + 5, y + 7, 6, 2, '#a35ab5');
  }
  // Sparkle so ripe crops are easy to spot.
  if (Math.floor(now / 400) % 3 === 0) { r(c, x + 13, y + 1, 1, 3, '#fff'); r(c, x + 12, y + 2, 3, 1, '#fff'); }
}

const OBJ = {
  bed(c, x, y) {
    r(c, x + 1, y - 4, 14, 20, '#6b4a2b'); r(c, x + 2, y - 3, 12, 18, '#f4f1ea');
    r(c, x + 3, y - 2, 10, 4, '#ffffff'); r(c, x + 2, y + 4, 12, 11, '#4d79c7'); r(c, x + 2, y + 4, 12, 2, '#6b95dd');
  },
  table(c, x, y) {
    r(c, x + 2, y + 8, 2, 7, '#6b4a2b'); r(c, x + 12, y + 8, 2, 7, '#6b4a2b');
    r(c, x + 1, y + 1, 14, 8, '#a8703f'); r(c, x + 1, y + 1, 14, 2, '#c99363'); r(c, x + 1, y + 8, 14, 1, '#7a4f2b');
    r(c, x + 6, y + 3, 4, 3, '#f4f1ea');
  },
  chair(c, x, y) {
    r(c, x + 4, y + 1, 8, 7, '#8a5a32'); r(c, x + 5, y + 2, 6, 5, '#a8703f');
    r(c, x + 3, y + 8, 10, 3, '#c99363'); r(c, x + 4, y + 11, 1, 4, '#6b4a2b'); r(c, x + 11, y + 11, 1, 4, '#6b4a2b');
  },
  sofa(c, x, y) {
    r(c, x, y + 1, 16, 9, '#3f8f7f'); r(c, x, y + 8, 16, 7, '#4fab98'); r(c, x, y + 4, 3, 11, '#357a6c'); r(c, x + 13, y + 4, 3, 11, '#357a6c');
    r(c, x + 3, y + 9, 10, 2, '#66c2ae');
  },
  armchair(c, x, y) {
    r(c, x + 2, y + 1, 12, 9, '#c0593e'); r(c, x + 2, y + 8, 12, 7, '#d8735a'); r(c, x + 1, y + 5, 3, 10, '#a64a33'); r(c, x + 12, y + 5, 3, 10, '#a64a33');
  },
  rug(c, x, y) {
    r(c, x + 1, y + 3, 14, 10, '#c9a227'); r(c, x + 2, y + 4, 12, 8, '#8e3b5e'); r(c, x + 5, y + 6, 6, 4, '#c9a227');
  },
  lamp(c, x, y) {
    r(c, x + 5, y + 13, 6, 2, '#5a4632'); r(c, x + 7, y + 2, 2, 11, '#5a4632');
    r(c, x + 3, y - 4, 10, 7, '#f6e3a1'); r(c, x + 4, y - 5, 8, 1, '#f6e3a1'); r(c, x + 3, y + 2, 10, 1, '#d6be6c');
  },
  bookshelf(c, x, y) {
    r(c, x + 1, y - 10, 14, 26, '#6b4a2b'); r(c, x + 2, y - 9, 12, 24, '#4a321d');
    const cols = ['#c0392b', '#2980b9', '#27ae60', '#f39c12', '#8e44ad', '#ecf0f1'];
    for (let s = 0; s < 3; s++) {
      r(c, x + 2, y - 2 + s * 8, 12, 1, '#8a5a32');
      for (let b = 0; b < 5; b++) r(c, x + 2 + b * 2 + (b > 2 ? 1 : 0), y - 8 + s * 8, 2, 6, cols[(b + s * 2) % 6]);
    }
  },
  tv(c, x, y, now) {
    r(c, x + 1, y + 8, 14, 7, '#6b4a2b'); r(c, x + 1, y + 8, 14, 1, '#8a5a32');
    r(c, x + 1, y - 3, 14, 11, '#22252b'); r(c, x + 2, y - 2, 12, 9, Math.floor(now / 700) % 2 ? '#4aa3df' : '#5cc0a8');
    r(c, x + 3, y - 1, 4, 2, '#cdeffd');
  },
  fridge(c, x, y) {
    r(c, x + 2, y - 10, 12, 26, '#dfe6ea'); r(c, x + 2, y - 10, 12, 1, '#fff'); r(c, x + 2, y - 1, 12, 1, '#aab4ba');
    r(c, x + 11, y - 7, 1, 4, '#8a949a'); r(c, x + 11, y + 2, 1, 6, '#8a949a'); r(c, x + 13, y - 10, 1, 26, '#c3ccd1');
  },
  stove(c, x, y) {
    r(c, x + 1, y, 14, 16, '#e7e9ea'); r(c, x + 1, y, 14, 6, '#3b3f45');
    for (const [px, py] of [[3, 1], [9, 1]]) { r(c, x + px, y + py, 4, 2, '#7f858c'); }
    r(c, x + 3, y + 8, 10, 6, '#2a2d31'); r(c, x + 3, y + 8, 10, 1, '#9aa1a8');
  },
  counter(c, x, y) {
    r(c, x, y + 1, 16, 15, '#8a5a32'); r(c, x, y + 1, 16, 5, '#e2ddd3'); r(c, x, y + 5, 16, 1, '#b6afa2');
    r(c, x + 7, y + 7, 2, 7, '#6b4a2b'); r(c, x + 5, y + 9, 1, 2, '#d6be6c'); r(c, x + 10, y + 9, 1, 2, '#d6be6c');
  },
  dresser(c, x, y) {
    r(c, x + 1, y - 2, 14, 18, '#8a5a32'); r(c, x + 1, y - 2, 14, 2, '#a8703f');
    for (let i = 0; i < 3; i++) { r(c, x + 2, y + 1 + i * 5, 12, 4, '#a8703f'); r(c, x + 7, y + 2 + i * 5, 2, 1, '#f5d547'); }
  },
  bathtub(c, x, y) {
    r(c, x, y + 1, 16, 14, '#f4f6f7'); r(c, x + 2, y + 3, 12, 9, '#9bd3ee'); r(c, x + 2, y + 3, 12, 2, '#c7e8f7');
    r(c, x, y + 14, 16, 1, '#c3ccd1'); r(c, x + 12, y + 1, 2, 2, '#aab4ba');
  },
  toilet(c, x, y) {
    r(c, x + 4, y - 2, 8, 7, '#f4f6f7'); r(c, x + 4, y + 4, 8, 1, '#c3ccd1');
    r(c, x + 3, y + 5, 10, 8, '#f4f6f7'); r(c, x + 5, y + 6, 6, 5, '#c7e8f7'); r(c, x + 5, y + 13, 6, 2, '#dfe6ea');
  },
  houseplant(c, x, y) {
    r(c, x + 4, y + 9, 8, 7, '#b5603c'); r(c, x + 4, y + 9, 8, 2, '#cf7a52');
    r(c, x + 3, y + 1, 10, 9, '#3f9447'); r(c, x + 5, y - 2, 6, 4, '#4ea04a'); r(c, x + 5, y + 2, 3, 3, '#6cbf5a');
  },
  flowerbed(c, x, y) {
    r(c, x + 1, y + 3, 14, 11, '#6e4a2c');
    const cols = ['#e9748f', '#f5d547', '#9b8cf2', '#f7f3e3'];
    for (let i = 0; i < 6; i++) {
      const px = 2 + (i % 3) * 4 + (i > 2 ? 2 : 0), py = 4 + (i > 2 ? 5 : 0);
      r(c, x + px + 1, y + py + 2, 1, 2, '#4f9e3a'); r(c, x + px, y + py, 3, 2, cols[i % 4]);
    }
  },
  bush(c, x, y) {
    r(c, x + 1, y + 13, 14, 3, 'rgba(0,0,0,0.18)');
    r(c, x, y + 2, 16, 12, '#3f9447'); r(c, x + 2, y, 12, 3, '#3f9447'); r(c, x + 2, y + 2, 7, 5, '#5aae4f'); r(c, x + 10, y + 7, 2, 2, '#e05050');
  },
  sapling(c, x, y) { drawTree(c, x, y, 0.3); },
  picket(c, x, y) {
    r(c, x, y + 5, 16, 2, '#f4f1ea'); r(c, x, y + 10, 16, 2, '#f4f1ea');
    for (const px of [1, 6, 11]) { r(c, x + px, y + 1, 4, 13, '#fbf9f4'); r(c, x + px + 1, y, 2, 1, '#fbf9f4'); r(c, x + px + 3, y + 1, 1, 13, '#d9d4c7'); }
  },
  lamppost(c, x, y) {
    r(c, x + 5, y + 13, 6, 3, '#2f3542'); r(c, x + 7, y - 6, 2, 19, '#2f3542');
    r(c, x + 4, y - 12, 8, 7, '#2f3542'); r(c, x + 5, y - 11, 6, 5, '#ffe8a3');
  },
  bench(c, x, y) {
    r(c, x, y + 2, 16, 3, '#a8703f'); r(c, x, y + 6, 16, 2, '#a8703f'); r(c, x, y + 9, 16, 3, '#c99363');
    r(c, x + 1, y + 12, 2, 4, '#2f3542'); r(c, x + 13, y + 12, 2, 4, '#2f3542');
  },
  mailbox(c, x, y) {
    r(c, x + 7, y + 6, 2, 10, '#6b4a2b'); r(c, x + 3, y - 1, 10, 8, '#3d6fb5'); r(c, x + 3, y - 2, 10, 2, '#5585cc');
    r(c, x + 12, y - 4, 1, 5, '#e74c3c'); r(c, x + 12, y - 4, 3, 2, '#e74c3c');
  },
  scarecrow(c, x, y) {
    r(c, x + 7, y - 6, 2, 22, '#7a4f2b'); r(c, x + 1, y - 1, 14, 2, '#7a4f2b');
    r(c, x + 4, y - 2, 8, 9, '#3d6fb5'); r(c, x + 5, y - 11, 6, 6, '#e8c97a'); r(c, x + 3, y - 12, 10, 2, '#a8703f'); r(c, x + 5, y - 14, 6, 2, '#a8703f');
    r(c, x + 6, y - 9, 1, 1, '#222'); r(c, x + 9, y - 9, 1, 1, '#222');
  },
};

// opts.short: draw walls cut away (Sims-style) so interiors are visible.
export function drawObject(c, o, x, y, now, opts = {}) {
  const def = ITEMS[o.t];
  if (!def) return;
  if (def.wall) return wall(c, o.t, x, y, opts.short);
  if (def.crop) return crop(c, o, x, y, now);
  (OBJ[o.t] || OBJ.table)(c, x, y, now);
}

// Little chibi villager. (x, y) = feet centre. dir: 0 down, 1 up, 2 left, 3 right.
export function drawPlayer(c, p, now) {
  const x = Math.round(p.x) - 8, y = Math.round(p.y) - 22;
  const step = p.moving ? Math.floor(now / 140) % 4 : 0;
  const bob = step % 2 ? -1 : 0;
  r(c, x + 3, y + 20, 10, 3, 'rgba(0,0,0,0.22)');
  // Legs
  const l = step === 1 ? 1 : 0, rr = step === 3 ? 1 : 0;
  r(c, x + 5, y + 16 - l, 2, 5 + l, '#3a3f58'); r(c, x + 9, y + 16 - rr, 2, 5 + rr, '#3a3f58');
  r(c, x + 5, y + 20, 3, 1, '#2a1e14'); r(c, x + 8, y + 20, 3, 1, '#2a1e14');
  // Body
  r(c, x + 4, y + 10 + bob, 8, 7, p.color); r(c, x + 4, y + 16 + bob, 8, 1, 'rgba(0,0,0,0.25)');
  r(c, x + 3, y + 11 + bob, 1, 4, p.color); r(c, x + 12, y + 11 + bob, 1, 4, p.color);
  r(c, x + 3, y + 15 + bob, 1, 1, '#f2c79a'); r(c, x + 12, y + 15 + bob, 1, 1, '#f2c79a');
  // Head
  r(c, x + 3, y + 2 + bob, 10, 9, '#f2c79a');
  r(c, x + 3, y + 1 + bob, 10, 3, '#5a3a21');
  if (p.dir === 1) r(c, x + 3, y + 2 + bob, 10, 7, '#5a3a21');
  else if (p.dir === 2) { r(c, x + 9, y + 2 + bob, 4, 6, '#5a3a21'); r(c, x + 5, y + 6 + bob, 1, 2, '#2a1e14'); }
  else if (p.dir === 3) { r(c, x + 3, y + 2 + bob, 4, 6, '#5a3a21'); r(c, x + 10, y + 6 + bob, 1, 2, '#2a1e14'); }
  else {
    r(c, x + 3, y + 2 + bob, 1, 5, '#5a3a21'); r(c, x + 12, y + 2 + bob, 1, 5, '#5a3a21');
    r(c, x + 5, y + 6 + bob, 1, 2, '#2a1e14'); r(c, x + 10, y + 6 + bob, 1, 2, '#2a1e14');
    r(c, x + 4, y + 8 + bob, 1, 1, '#f09a8a'); r(c, x + 11, y + 8 + bob, 1, 1, '#f09a8a');
  }
}

// Small icon for the build tray.
export function itemIcon(itemId, size = 44) {
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const c = cv.getContext('2d');
  c.imageSmoothingEnabled = false;
  const def = ITEMS[itemId];
  c.scale(size / 32, size / 32);
  if (def.layer === 'floor') { c.translate(4, 4); c.scale(1.5, 1.5); drawFloor(c, itemId, 0, 0, 0, 0); }
  else if (def.crop) { c.translate(4, 4); c.scale(1.5, 1.5); drawFloor(c, 'soil', 0, 0); drawObject(c, { t: itemId, p: 0 }, 0, 0, 1e15); }
  else drawObject(c, { t: itemId }, 8, 15, 0, { short: false });
  return cv;
}

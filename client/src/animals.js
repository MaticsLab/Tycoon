// Farm animals: hens, cows and sheep that potter about near their coop or barn.
// Painted with fillRect like the pets (see pets.js). Local (0, 0) = on the ground
// under the middle of the animal. dir: 0 down (front), 1 up (back), 2 left, 3 right
// (left is the right-facing side view mirrored). frame 0..3 walk cycle; pose 'sit'
// (or true) = lying down, resting.
import { r, px, disc, bake } from './sprites.js';

const EYE = '#1d1a1a';

// ---------- chicken ----------
const HEN = ['#c9c2b4', '#e3ddd0', '#f7f4ec', '#ffffff'];   // shadow, shade, base, light
const COMB = '#d9302a', COMB_L = '#f05a4a', BEAK = '#f0a020', LEG = '#e88a1a';

function henSide(c, frame, sit) {
  const bob = sit ? 0 : [0, -1, 0, -1][frame], peck = !sit && frame === 2 ? 1 : 0;
  const y = sit ? 2 : 0;
  if (!sit) {
    const step = [0, 1, 0, -1][frame];
    r(c, -1 + step, -3, 1, 3, LEG); px(c, step, -1, LEG);
    r(c, 1 - step, -3, 1, 3, LEG); px(c, 2 - step, -1, LEG);
  }
  // tail feathers up at the back
  r(c, -5, -9 + y, 2, 4, HEN[2]); px(c, -6, -10 + y, HEN[2]); px(c, -5, -10 + y, HEN[3]); px(c, -6, -9 + y, HEN[1]);
  // round body, wing
  disc(c, -1, -5 + y + bob, 4, 2, HEN[2]); r(c, -4, -5 + y + bob, 7, 2, HEN[2]);
  r(c, -3, -3 + y + bob, 6, 1, HEN[1]);
  r(c, -2, -6 + y + bob, 4, 2, HEN[1]); r(c, -2, -6 + y + bob, 3, 1, HEN[3]); px(c, 1, -5 + y + bob, HEN[0]);
  // neck, head, comb, beak, wattle
  const hx = 2 + peck, hy = -10 + y + bob + peck * 2;
  r(c, 1, -7 + y + bob, 3, 3, HEN[2]);
  r(c, hx, hy, 3, 3, HEN[2]); px(c, hx, hy, HEN[3]);
  px(c, hx, hy - 1, COMB); px(c, hx + 1, hy - 2, COMB_L); px(c, hx + 1, hy - 1, COMB); px(c, hx + 2, hy - 1, COMB);
  px(c, hx + 3, hy + 1, BEAK); px(c, hx + 2, hy + 3, COMB); px(c, hx + 2, hy + 2, COMB);
  px(c, hx + 1, hy + 1, EYE);
}
function henFront(c, frame, sit) {
  const bob = sit ? 0 : [0, -1, 0, -1][frame], y = sit ? 2 : 0;
  if (!sit) {
    const step = [0, 1, 0, -1][frame];
    r(c, -2, -3 - (step > 0 ? 1 : 0), 1, 3, LEG); r(c, 1, -3 - (step < 0 ? 1 : 0), 1, 3, LEG);
    px(c, -3, -1, LEG); px(c, 2, -1, LEG);
  }
  disc(c, 0, -5 + y + bob, 4, 2, HEN[2]); r(c, -4, -5 + y + bob, 8, 2, HEN[2]); r(c, -3, -3 + y + bob, 6, 1, HEN[1]);
  r(c, -4, -6 + y + bob, 1, 3, HEN[1]); r(c, 3, -6 + y + bob, 1, 3, HEN[1]);   // wings at the sides
  const hy = -10 + y + bob;
  r(c, -2, hy, 4, 4, HEN[2]); r(c, -2, hy, 4, 1, HEN[3]);
  r(c, -1, hy - 2, 2, 2, COMB); px(c, -1, hy - 2, COMB_L);
  px(c, -2, hy + 1, EYE); px(c, 1, hy + 1, EYE);
  r(c, -1, hy + 2, 2, 1, BEAK); r(c, -1, hy + 3, 2, 1, COMB);
}
function henBack(c, frame, sit) {
  const bob = sit ? 0 : [0, -1, 0, -1][frame], y = sit ? 2 : 0;
  if (!sit) {
    const step = [0, 1, 0, -1][frame];
    r(c, -2, -3 - (step > 0 ? 1 : 0), 1, 3, LEG); r(c, 1, -3 - (step < 0 ? 1 : 0), 1, 3, LEG);
  }
  disc(c, 0, -5 + y + bob, 4, 2, HEN[2]); r(c, -4, -5 + y + bob, 8, 2, HEN[2]); r(c, -3, -3 + y + bob, 6, 1, HEN[1]);
  r(c, -2, -9 + y, 4, 3, HEN[3]); r(c, -1, -10 + y, 2, 1, HEN[2]); px(c, 0, -7 + y, HEN[1]);   // tail fan
  const hy = -10 + y + bob;
  r(c, -2, hy - 1, 4, 3, HEN[1]); r(c, -1, hy - 3, 2, 2, COMB);
}

// ---------- cow ----------
const COW = ['#b9b2a4', '#ddd6c8', '#f6f2ea', '#ffffff'];
const SPOT = '#2a2522', SPOT_L = '#433a35', PINK = '#f2a6a6', PINK_D = '#d97f86', HORN = '#efe3c2', HOOF = '#3a3330';

function cowSide(c, frame, sit) {
  const step = sit ? 0 : [0, 1, 0, -1][frame], y = sit ? 5 : 0, swish = frame % 2;
  // tail with a dark tuft
  r(c, -12, -15 + y, 1, 7 - (sit ? 2 : 0), COW[1]); r(c, -13 + swish, -9 + y - (sit ? 2 : 0), 2, 3, SPOT);
  if (!sit) {
    // legs: far pair darker, hooves
    for (const [x, o, far] of [[-9, step, false], [-7, -step, true], [3, -step, false], [5, step, true]]) {
      r(c, x + o, -6, 2, 6, far ? COW[1] : COW[2]); r(c, x + o, -1, 2, 1, HOOF);
    }
    r(c, -6, -6, 4, 2, PINK); px(c, -5, -4, PINK_D); px(c, -3, -4, PINK_D);   // udder
  } else {
    r(c, -9, -2, 5, 2, COW[1]); r(c, 2, -2, 5, 2, COW[1]); px(c, 6, -1, HOOF); px(c, -5, -1, HOOF);
  }
  // barrel body
  r(c, -11, -16 + y, 17, 10, COW[2]); r(c, -10, -17 + y, 15, 1, COW[2]); r(c, -11, -7 + y, 17, 1, COW[1]);
  r(c, -10, -16 + y, 14, 1, COW[3]);
  // black patches
  r(c, -9, -15 + y, 5, 4, SPOT); r(c, -8, -11 + y, 3, 2, SPOT); px(c, -9, -16 + y, SPOT);
  r(c, -2, -13 + y, 4, 5, SPOT); r(c, -1, -14 + y, 3, 1, SPOT); r(c, 1, -9 + y, 2, 1, SPOT);
  px(c, -8, -14 + y, SPOT_L); px(c, -1, -12 + y, SPOT_L);
  // head
  const hy = -19 + y + (sit ? 1 : frame === 2 ? 1 : 0);
  r(c, 5, hy + 2, 3, 6, COW[2]);                                        // neck
  r(c, 7, hy, 5, 7, COW[2]); r(c, 7, hy, 5, 1, COW[3]);
  r(c, 7, hy, 3, 3, SPOT);                                              // patch round the ear
  r(c, 10, hy + 4, 4, 4, PINK); r(c, 10, hy + 7, 4, 1, PINK_D); px(c, 13, hy + 5, PINK_D);
  px(c, 10, hy + 2, EYE);
  r(c, 5, hy + 1, 2, 2, SPOT_L); px(c, 4, hy + 2, SPOT);                // ear
  r(c, 8, hy - 2, 1, 2, HORN); px(c, 9, hy - 2, HORN);                   // horn
  if (frame === 3 && !sit) px(c, 12, hy + 8, '#8fcf6a');                // a bit of grass
}
function cowFront(c, frame, sit) {
  const step = sit ? 0 : [0, 1, 0, -1][frame], y = sit ? 5 : 0;
  if (!sit) {
    r(c, -5, -7 - (step > 0 ? 1 : 0), 3, 7, COW[2]); r(c, 2, -7 - (step < 0 ? 1 : 0), 3, 7, COW[2]);
    r(c, -5, -1 - (step > 0 ? 1 : 0), 3, 1, HOOF); r(c, 2, -1 - (step < 0 ? 1 : 0), 3, 1, HOOF);
  } else { r(c, -6, -2, 4, 2, COW[1]); r(c, 2, -2, 4, 2, COW[1]); }
  // chest and shoulders behind the head
  r(c, -7, -15 + y, 14, 9, COW[2]); r(c, -7, -15 + y, 14, 1, COW[3]); r(c, -7, -7 + y, 14, 1, COW[1]);
  r(c, -7, -14 + y, 3, 5, SPOT); r(c, 5, -12 + y, 2, 4, SPOT);
  // head
  const hy = -20 + y + (frame === 2 && !sit ? 1 : 0);
  r(c, -4, hy, 8, 9, COW[2]); r(c, -4, hy, 8, 1, COW[3]);
  r(c, -4, hy, 4, 4, SPOT); px(c, -3, hy + 1, SPOT_L);
  r(c, -7, hy + 2, 3, 2, COW[1]); r(c, 4, hy + 2, 3, 2, COW[1]); px(c, -7, hy + 2, SPOT); px(c, 6, hy + 2, PINK_D);   // ears
  r(c, -3, hy - 2, 1, 2, HORN); r(c, 2, hy - 2, 1, 2, HORN); px(c, -4, hy - 2, HORN); px(c, 3, hy - 2, HORN);
  px(c, -2, hy + 4, EYE); px(c, 1, hy + 4, EYE);
  r(c, -3, hy + 6, 6, 4, PINK); r(c, -3, hy + 9, 6, 1, PINK_D); px(c, -2, hy + 7, PINK_D); px(c, 1, hy + 7, PINK_D);
}
function cowBack(c, frame, sit) {
  const step = sit ? 0 : [0, 1, 0, -1][frame], y = sit ? 5 : 0;
  if (!sit) {
    r(c, -5, -7 - (step > 0 ? 1 : 0), 3, 7, COW[1]); r(c, 2, -7 - (step < 0 ? 1 : 0), 3, 7, COW[1]);
    r(c, -5, -1 - (step > 0 ? 1 : 0), 3, 1, HOOF); r(c, 2, -1 - (step < 0 ? 1 : 0), 3, 1, HOOF);
    r(c, -2, -7, 4, 2, PINK);
  } else { r(c, -6, -2, 4, 2, COW[1]); r(c, 2, -2, 4, 2, COW[1]); }
  r(c, -7, -17 + y, 14, 11, COW[2]); r(c, -6, -18 + y, 12, 1, COW[2]); r(c, -7, -17 + y, 14, 1, COW[3]); r(c, -7, -7 + y, 14, 1, COW[1]);
  r(c, -6, -16 + y, 5, 5, SPOT); r(c, 2, -12 + y, 4, 3, SPOT);
  const sw = frame % 2 ? 1 : 0;
  r(c, 0, -16 + y, 1, 8, COW[1]); r(c, -1 + sw, -9 + y, 2, 3, SPOT);   // tail
  // head peeking over: ears and horns
  r(c, -3, -21 + y, 6, 3, COW[1]); r(c, -6, -20 + y, 3, 2, COW[1]); r(c, 3, -20 + y, 3, 2, COW[1]);
  px(c, -3, -23 + y, HORN); px(c, 2, -23 + y, HORN); px(c, -3, -22 + y, HORN); px(c, 2, -22 + y, HORN);
}

// ---------- sheep ----------
const WOOL = ['#cfc6b6', '#e6dfd0', '#f6f1e6', '#ffffff'];
const FACE = ['#2a2524', '#3a3432', '#4f4744'];

// Lumpy fleece: overlapping puffs with highlights.
function fleece(c, puffs) {
  for (const [x, y, rx, ry] of puffs) disc(c, x, y + 1, rx, ry, WOOL[1]);
  for (const [x, y, rx, ry] of puffs) disc(c, x, y, rx, ry, WOOL[2]);
  for (const [x, y, rx] of puffs) { px(c, x - Math.ceil(rx / 2), y - 1, WOOL[3]); px(c, x - Math.ceil(rx / 2) + 1, y - 1, WOOL[3]); }
}
function sheepSide(c, frame, sit) {
  const step = sit ? 0 : [0, 1, 0, -1][frame], y = sit ? 3 : 0;
  if (!sit) for (const [x, o, far] of [[-5, step, false], [-3, -step, true], [2, -step, false], [4, step, true]]) r(c, x + o, -4, 1, 4, far ? FACE[0] : FACE[1]);
  fleece(c, [[-5, -8 + y, 3, 3], [-1, -9 + y, 3, 3], [3, -8 + y, 3, 3], [-3, -6 + y, 4, 2], [2, -6 + y, 3, 2], [-1, -11 + y, 2, 2]]);
  px(c, -8, -9 + y, WOOL[2]);                                          // tail
  // dark face with a woolly topknot, floppy ear
  const hy = -12 + y + (frame === 2 && !sit ? 1 : 0);
  r(c, 5, hy + 1, 3, 4, FACE[1]); r(c, 6, hy + 2, 3, 3, FACE[1]); r(c, 5, hy + 1, 3, 1, FACE[2]);
  px(c, 7, hy + 2, '#f4ecd8'); px(c, 8, hy + 4, FACE[0]);
  r(c, 4, hy + 2, 1, 2, FACE[0]); px(c, 3, hy + 3, FACE[0]);
  disc(c, 5, hy, 2, 1, WOOL[2]); px(c, 4, hy - 1, WOOL[3]);
}
function sheepFront(c, frame, sit) {
  const step = sit ? 0 : [0, 1, 0, -1][frame], y = sit ? 3 : 0;
  if (!sit) { r(c, -3, -4 - (step > 0 ? 1 : 0), 1, 4, FACE[1]); r(c, 2, -4 - (step < 0 ? 1 : 0), 1, 4, FACE[1]); }
  fleece(c, [[-3, -7 + y, 3, 3], [3, -7 + y, 3, 3], [0, -9 + y, 4, 3], [0, -5 + y, 4, 2]]);
  const hy = -13 + y + (frame === 2 && !sit ? 1 : 0);
  r(c, -2, hy + 1, 4, 5, FACE[1]); r(c, -1, hy + 6, 2, 1, FACE[1]); r(c, -2, hy + 1, 1, 4, FACE[2]);
  r(c, -5, hy + 2, 3, 1, FACE[0]); r(c, 2, hy + 2, 3, 1, FACE[0]); px(c, -5, hy + 3, FACE[0]); px(c, 4, hy + 3, FACE[0]);   // ears
  px(c, -2, hy + 3, '#f4ecd8'); px(c, 1, hy + 3, '#f4ecd8');
  px(c, -1, hy + 5, FACE[0]); px(c, 0, hy + 5, FACE[0]);
  disc(c, 0, hy, 3, 1, WOOL[2]); px(c, -1, hy - 1, WOOL[3]);
}
function sheepBack(c, frame, sit) {
  const step = sit ? 0 : [0, 1, 0, -1][frame], y = sit ? 3 : 0;
  if (!sit) { r(c, -3, -4 - (step > 0 ? 1 : 0), 1, 4, FACE[0]); r(c, 2, -4 - (step < 0 ? 1 : 0), 1, 4, FACE[0]); }
  r(c, -5, -13 + y, 3, 1, FACE[0]); r(c, 2, -13 + y, 3, 1, FACE[0]);
  disc(c, 0, -13 + y, 3, 2, WOOL[2]);
  fleece(c, [[-3, -7 + y, 3, 3], [3, -7 + y, 3, 3], [0, -9 + y, 4, 3], [0, -5 + y, 4, 2]]);
  r(c, -1, -6 + y, 2, 2, WOOL[3]); px(c, 0, -4 + y, WOOL[1]);                 // little tail
}

const KINDS = {
  chicken: { box: [8, 15, 16, 17], side: henSide, front: henFront, back: henBack },
  cow: { box: [15, 25, 30, 27], side: cowSide, front: cowFront, back: cowBack },
  sheep: { box: [10, 16, 20, 18], side: sheepSide, front: sheepFront, back: sheepBack },
};

// Sprite for an animal of `kind` ('chicken' | 'cow' | 'sheep'): { cv, dx, dy } like petSprite.
export function animalSprite(kind, dir, frame, pose) {
  const K = KINDS[kind] || KINDS.chicken;
  const sit = pose === true || pose === 'sit' || pose === 'sleep';
  frame = ((frame | 0) % 4 + 4) % 4;
  const key = `animal|${kind}|${dir}|${sit ? 's' : frame}`;
  const [left, top, w, h] = K.box;
  return bake(key, left, top, w, h, (c) => {
    if (dir === 2) { c.scale(-1, 1); dir = 3; }
    if (dir === 0) K.front(c, frame, sit);
    else if (dir === 1) K.back(c, frame, sit);
    else K.side(c, frame, sit);
  });
}

// An animal drawn large on a canvas (shop buttons, the coop/barn panel).
export function drawAnimal(canvas, kind, { dir = 3, sit = false } = {}) {
  const spr = animalSprite(kind, dir, 0, sit);
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, canvas.width, canvas.height);
  const s = Math.max(1, Math.floor(Math.min(canvas.width / spr.cv.width, canvas.height / spr.cv.height)));
  g.drawImage(spr.cv, Math.round((canvas.width - spr.cv.width * s) / 2), Math.round((canvas.height - spr.cv.height * s) / 2), spr.cv.width * s, spr.cv.height * s);
}

// Pets: little pixel cats and dogs that follow their owner around, Stardew-style.
// Painted with fillRect like the villagers. Local (0, 0) = between the front paws.
// dir: 0 down (front), 1 up (back), 2 left, 3 right. frame 0..3 walk, sit = resting.
import { r, px, ramp, lt, dk, bake } from './sprites.js';
import { PETS } from '@shared/look.js';

const NOSE = '#e07a8a', EYE = '#1d1a1a';

function catSide(c, P, frame) {
  const A = ramp(P.a), B = P.b;
  const step = [0, 1, 0, -1][frame];
  // tail curling up behind
  r(c, -7, -7, 1, 3, A[1]); r(c, -8, -10, 1, 4, A[2]); px(c, -7, -11, A[2]); px(c, -8, -10, A[3]);
  // legs (back pair, front pair)
  for (const [x, o] of [[-5, step], [-3, -step], [1, -step], [3, step]]) r(c, x + o, -3, 1, 3, x === -3 || x === 3 ? A[1] : A[2]);
  // body
  r(c, -6, -7, 10, 4, A[2]); r(c, -5, -8, 8, 1, A[2]); r(c, -6, -4, 10, 1, A[1]); r(c, -5, -8, 6, 1, A[3]);
  r(c, -1, -4, 4, 1, B);
  // head
  r(c, 2, -12, 6, 6, A[2]); r(c, 3, -13, 4, 1, A[2]); r(c, 2, -12, 1, 5, A[3]);
  r(c, 3, -15, 2, 2, A[2]); px(c, 3, -14, NOSE); r(c, 6, -15, 2, 2, A[1]);   // ears
  r(c, 5, -9, 3, 3, B);                                                    // muzzle
  px(c, 6, -11, EYE); px(c, 7, -11, '#7cc45a');
  px(c, 8, -9, NOSE);
  pattern(c, P, 'side');
}

function catFront(c, P, frame, sit) {
  const A = ramp(P.a), B = P.b;
  const step = sit ? 0 : [0, 1, 0, -1][frame];
  // tail to the side
  r(c, 4, -4, 1, 3, A[1]); r(c, 5, -6, 1, 3, A[2]); px(c, 5, -7, A[3]);
  // body / haunches
  if (sit) { r(c, -4, -7, 8, 7, A[2]); r(c, -4, -7, 1, 7, A[3]); r(c, 3, -7, 1, 7, A[1]); }
  else { r(c, -3, -7, 6, 5, A[2]); r(c, -3, -7, 1, 5, A[3]); r(c, 2, -7, 1, 5, A[1]); }
  r(c, -2, -6, 4, 4, B);
  r(c, -3, -2 - (step > 0 ? 1 : 0), 2, 2, B); r(c, 1, -2 - (step < 0 ? 1 : 0), 2, 2, B);   // paws
  // head
  r(c, -4, -13, 8, 6, A[2]); r(c, -3, -14, 6, 1, A[2]); r(c, -4, -13, 1, 5, A[3]); r(c, 3, -13, 1, 6, A[1]);
  r(c, -4, -16, 2, 2, A[2]); px(c, -3, -15, NOSE); r(c, 2, -16, 2, 2, A[2]); px(c, 2, -15, NOSE);
  r(c, -2, -10, 4, 3, B);
  px(c, -2, -11, EYE); px(c, 1, -11, EYE); px(c, -3, -11, '#7cc45a'); px(c, 2, -11, '#7cc45a');
  r(c, -1, -9, 2, 1, NOSE); px(c, -1, -8, A[0]); px(c, 0, -8, A[0]);
  pattern(c, P, 'front');
}

function catBack(c, P, frame) {
  const A = ramp(P.a);
  const step = [0, 1, 0, -1][frame];
  r(c, -3, -2 - (step > 0 ? 1 : 0), 2, 2, A[1]); r(c, 1, -2 - (step < 0 ? 1 : 0), 2, 2, A[1]);
  r(c, -3, -7, 6, 5, A[2]); r(c, -3, -7, 1, 5, A[3]);
  r(c, -4, -13, 8, 6, A[2]); r(c, -3, -14, 6, 1, A[2]); r(c, -4, -13, 1, 5, A[3]); r(c, 3, -13, 1, 6, A[1]);
  r(c, -4, -16, 2, 2, A[2]); r(c, 2, -16, 2, 2, A[2]);
  r(c, -1, -9, 1, 6, A[1]); r(c, 0, -12, 1, 4, A[2]); px(c, 0, -12, A[3]);   // tail up
  pattern(c, P, 'back');
}

function dogSide(c, P, frame) {
  const A = ramp(P.a), B = P.b;
  const step = [0, 1, 0, -1][frame];
  const wag = frame % 2;
  r(c, -8, -10 + wag, 1, 3, A[2]); r(c, -7, -8, 1, 2, A[2]); px(c, -8, -10 + wag, A[3]);   // tail
  for (const [x, o] of [[-5, step], [-3, -step], [1, -step], [3, step]]) r(c, x + o, -4, 1, 4, x === -3 || x === 3 ? A[1] : A[2]);
  r(c, -6, -9, 10, 5, A[2]); r(c, -5, -10, 8, 1, A[2]); r(c, -6, -5, 10, 1, A[1]); r(c, -5, -10, 6, 1, A[3]);
  r(c, -1, -5, 4, 1, B);
  // head with a snout and a floppy ear
  r(c, 2, -14, 5, 6, A[2]); r(c, 3, -15, 3, 1, A[2]); r(c, 2, -14, 1, 5, A[3]);
  r(c, 6, -11, 3, 3, B); px(c, 8, -11, EYE);                                 // snout + nose
  px(c, 5, -13, EYE); px(c, 5, -14, A[3]);
  r(c, 2, -14, 2, 5, A[0]); r(c, 2, -14, 1, 4, A[1]);                         // ear
  if (frame % 2) px(c, 7, -8, NOSE);                                          // tongue
  pattern(c, P, 'side', true);
}

function dogFront(c, P, frame, sit) {
  const A = ramp(P.a), B = P.b;
  const step = sit ? 0 : [0, 1, 0, -1][frame];
  r(c, 4, -8 + (frame % 2), 1, 3, A[2]);                                       // tail
  if (sit) { r(c, -4, -8, 8, 8, A[2]); r(c, -4, -8, 1, 8, A[3]); r(c, 3, -8, 1, 8, A[1]); }
  else { r(c, -3, -8, 6, 6, A[2]); r(c, -3, -8, 1, 6, A[3]); r(c, 2, -8, 1, 6, A[1]); }
  r(c, -2, -7, 4, 4, B);
  r(c, -3, -3 - (step > 0 ? 1 : 0), 2, 3, A[2]); r(c, 1, -3 - (step < 0 ? 1 : 0), 2, 3, A[2]);
  r(c, -3, -1, 2, 1, B); r(c, 1, -1, 2, 1, B);
  r(c, -4, -15, 8, 7, A[2]); r(c, -3, -16, 6, 1, A[2]); r(c, -4, -15, 1, 6, A[3]); r(c, 3, -15, 1, 7, A[1]);
  r(c, -6, -14, 2, 5, A[0]); r(c, 4, -14, 2, 5, A[0]); px(c, -6, -14, A[1]); px(c, 5, -14, A[1]);   // floppy ears
  r(c, -2, -11, 4, 3, B);
  px(c, -2, -13, EYE); px(c, 1, -13, EYE); px(c, -2, -14, lt(P.a, 0.4)); px(c, 1, -14, lt(P.a, 0.4));
  r(c, -1, -11, 2, 1, EYE);
  if (!sit || frame % 2) { r(c, -1, -8, 2, 2, NOSE); px(c, -1, -7, dk(NOSE, 0.2)); }
  pattern(c, P, 'front', true);
}

function dogBack(c, P, frame) {
  const A = ramp(P.a);
  const step = [0, 1, 0, -1][frame];
  r(c, -3, -3 - (step > 0 ? 1 : 0), 2, 3, A[1]); r(c, 1, -3 - (step < 0 ? 1 : 0), 2, 3, A[1]);
  r(c, -3, -8, 6, 6, A[2]); r(c, -3, -8, 1, 6, A[3]);
  r(c, -4, -15, 8, 7, A[2]); r(c, -3, -16, 6, 1, A[2]); r(c, -4, -15, 1, 6, A[3]); r(c, 3, -15, 1, 7, A[1]);
  r(c, -6, -14, 2, 5, A[0]); r(c, 4, -14, 2, 5, A[0]);
  const wag = frame % 2 ? 1 : -1;
  r(c, 0 + wag, -12, 1, 4, A[2]); px(c, wag, -12, A[3]);
  pattern(c, P, 'back', true);
}

// Markings drawn over the base coat.
function pattern(c, P, view, dog = false) {
  const A = ramp(P.a), B = P.b;
  if (P.pattern === 'tabby') {
    const s = A[0];
    if (view === 'side') { for (const x of [-4, -2, 0]) r(c, x, -8, 1, 3, s); px(c, 4, -12, s); px(c, 5, -13, s); }
    else if (view === 'front') { r(c, -1, -14, 2, 1, s); px(c, -3, -12, s); px(c, 2, -12, s); }
    else { for (const y of [-12, -10]) r(c, -3, y, 6, 1, s); for (const y of [-6, -4]) r(c, -2, y, 4, 1, s); }
  } else if (P.pattern === 'tux') {
    if (view === 'front') { r(c, -1, -9, 2, 2, B); }
    if (view === 'side') { r(c, 2, -5, 2, 2, B); r(c, 1, -1, 1, 1, B); r(c, 3, -1, 1, 1, B); }
  } else if (P.pattern === 'spots') {
    const s = B;
    if (view === 'side') { r(c, -4, -9, 2, 2, s); r(c, 0, -8, 2, 2, s); r(c, 2, -14, 2, 3, s); }
    else if (view === 'front') { r(c, -4, -15, 2, 3, s); r(c, 2, -6, 1, 2, s); }
    else { r(c, -3, -13, 3, 3, s); r(c, 1, -6, 2, 2, s); }
  } else if (P.pattern === 'mask' && dog) {
    if (view === 'front') { r(c, -3, -13, 6, 2, B); r(c, -1, -15, 2, 2, B); }
    if (view === 'side') { r(c, 4, -13, 3, 2, B); }
  }
}

// Sprite for pet type `idx` (index into PETS).
export function petSprite(idx, dir, frame, sit) {
  const P = PETS[idx] || PETS[0];
  const key = `pet|${idx}|${dir}|${sit ? 's' : frame}`;
  return bake(key, 10, 18, 20, 20, (c) => {
    if (dir === 2) { c.scale(-1, 1); dir = 3; }
    const dog = P.kind === 'dog';
    if (sit || dir === 0) (dog ? dogFront : catFront)(c, P, frame, sit);
    else if (dir === 1) (dog ? dogBack : catBack)(c, P, frame);
    else (dog ? dogSide : catSide)(c, P, frame);
  });
}

// A pet drawn large on a canvas (the character creator's animal buttons).
export function drawPet(canvas, idx, { dir = 3, sit = false } = {}) {
  const spr = petSprite(idx, dir, 0, sit);
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, canvas.width, canvas.height);
  const s = Math.floor(Math.min(canvas.width / spr.cv.width, canvas.height / spr.cv.height));
  g.drawImage(spr.cv, Math.round((canvas.width - spr.cv.width * s) / 2), Math.round((canvas.height - spr.cv.height * s) / 2), spr.cv.width * s, spr.cv.height * s);
}

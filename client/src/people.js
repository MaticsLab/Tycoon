// Villager sprites in the Stardew style: 16 px wide, ~32 px tall, big heads, two-tone
// shading and a dark outline. Painted from a look (shared/look.js) with fillRect only.
// Local (0, 0) = between the feet. dir: 0 down (front), 1 up (back), 2 left, 3 right.
import { r, px, ramp, dk, lt, mix, bake } from './sprites.js';
import { SKINS, HAIR, SHIRTS, ACCESSORIES, hsvHex, sanitizeLook, lookKey } from '@shared/look.js';

const SHOE = ['#3a2414', '#5a3a22', '#7a5234'];
const EYE_W = '#fbfbf4';

// Resolve indices and HSV triples into colours and definitions once per look.
function resolve(l) {
  const shirt = SHIRTS[l.shirt];
  return {
    body: l.body,
    K: ramp(SKINS[l.skin]),
    H: ramp(hsvHex(l.hairColor)),
    E: ramp(hsvHex(l.eyes)),
    P: shirt.kind === 'overalls' ? ramp(shirt.a) : ramp(hsvHex(l.pants)),
    S: ramp(shirt.a), B: ramp(shirt.b), shirt,
    hair: HAIR[l.hair],
    acc: ACCESSORIES[l.acc],
  };
}

// ---------- legs ----------
function legs(c, L, dir, frame) {
  const { P } = L;
  const dress = L.shirt.kind === 'dress';
  const step = frame === 1 ? 1 : frame === 3 ? -1 : 0; // which foot is lifted
  if (dir === 0 || dir === 1) {
    const up = (side) => (side < 0 ? (step === 1 ? 1 : 0) : (step === -1 ? 1 : 0));
    for (const side of [-1, 1]) {
      const x0 = side < 0 ? -4 : 1, u = up(side);
      if (dress) { r(c, x0 + (side < 0 ? 1 : 0), -4 - u, 2, 2, L.K[1]); }
      else {
        r(c, x0, -7 - u, 3, 5, P[2]);
        r(c, side < 0 ? x0 : x0 + 2, -7 - u, 1, 5, side < 0 ? P[3] : P[1]);
      }
      r(c, x0, -2 - u, 3, 2, SHOE[1]); r(c, x0, -2 - u, 3, 1, SHOE[2]); px(c, side < 0 ? x0 : x0 + 2, -1 - u, SHOE[0]);
    }
    if (!dress) { r(c, -4, -9, 8, 3, P[2]); r(c, -4, -9, 1, 3, P[3]); r(c, 3, -9, 1, 3, P[1]); r(c, -1, -7, 2, 1, P[1]); }
    return;
  }
  // side view (facing right; left is mirrored): back leg, then front leg
  const swing = [0, 2, 0, -2][frame];
  for (const [dx, col] of [[-swing, 1], [swing, 2]]) {
    const x0 = -2 + dx;
    if (dress) r(c, x0 + 1, -4, 2, 2, L.K[col === 1 ? 0 : 1]);
    else r(c, x0, -7, 3, 5, P[col]);
    r(c, x0, -2, 4, 2, SHOE[col]); r(c, x0, -2, 4, 1, SHOE[col + (col < 2 ? 1 : 0)]);
  }
  if (!dress) { r(c, -3, -9, 6, 3, P[2]); r(c, -3, -9, 6, 1, P[3]); }
}

// ---------- torso & arms ----------
function sleeveColor(L) {
  const k = L.shirt.kind;
  if (k === 'tank' || k === 'dress') return null; // bare arms below a short sleeve
  if (k === 'vest' || k === 'overalls' || k === 'apron' && L.shirt.name === 'Gardening smock') return L.B;
  return L.S;
}

function skirt(c, L, y0, side) {
  if (L.shirt.kind !== 'dress') return;
  const S = L.S;
  const xl = side ? -4 : -5, w = side ? 8 : 10;
  r(c, -4, y0 + 8, 8, 2, S[2]);
  r(c, xl, y0 + 10, w, 4, S[2]); r(c, xl, y0 + 10, 1, 4, S[3]); r(c, xl + w - 1, y0 + 10, 1, 4, S[1]);
  r(c, xl, y0 + 13, w, 1, S[0]);
  if (!side) { r(c, -2, y0 + 10, 1, 3, S[1]); r(c, 1, y0 + 10, 1, 3, S[1]); }
}

function torsoFront(c, L, y0, back) {
  const { S, B, K, shirt } = L;
  const k = shirt.kind;
  const w = L.body === 0 ? 10 : 8, x0 = -w / 2;
  // base block
  r(c, -4, y0, 8, 8, S[2]);
  if (L.body === 0) r(c, -5, y0, 10, 3, S[2]);
  else r(c, -4, y0 + 4, 1, 3, S[1]), r(c, 3, y0 + 4, 1, 3, S[1]);
  r(c, -4, y0 + 1, 1, 6, S[3]); r(c, 3, y0 + 1, 1, 6, S[1]); r(c, -4, y0 + 7, 8, 1, S[0]);
  if (back) {
    if (k === 'overalls') { r(c, -4, y0, 8, 8, B[2]); r(c, -3, y0 + 4, 6, 4, S[2]); r(c, -3, y0, 1, 4, S[2]); r(c, 2, y0, 1, 4, S[2]); }
    if (k === 'stripes') for (let j = 1; j < 8; j += 2) r(c, -4, y0 + j, 8, 1, B[2]);
    if (k === 'flannel') plaid(c, L, y0);
    if (k === 'hoodie') { r(c, -3, y0 - 1, 6, 3, S[1]); r(c, -2, y0 - 1, 4, 2, S[0]); }
    if (k === 'sailor') { r(c, -4, y0, 8, 3, B[2]); r(c, -4, y0 + 2, 8, 1, '#f2efe6'); }
    if (k === 'apron') { r(c, -1, y0 + 5, 2, 1, B[2]); r(c, -3, y0 + 1, 1, 4, B[1]); r(c, 2, y0 + 1, 1, 4, B[1]); }
    if (k === 'dress') { r(c, -4, y0 + 6, 8, 1, B[2]); }
    if (k === 'tank') { r(c, -4, y0, 2, 2, K[2]); r(c, 2, y0, 2, 2, K[2]); }
    return;
  }
  switch (k) {
    case 'tee': r(c, -1, y0, 2, 1, K[1]); break;
    case 'stripes': for (let j = 1; j < 8; j += 2) r(c, -4, y0 + j, 8, 1, B[2]); r(c, -1, y0, 2, 1, K[1]); break;
    case 'polo': case 'collar':
      r(c, -2, y0, 1, 2, B[3]); r(c, 1, y0, 1, 2, B[3]); r(c, -1, y0, 2, 1, K[1]);
      r(c, -1, y0 + 1, 1, 3, S[1]); px(c, -1, y0 + 2, B[3]);
      if (k === 'collar') { r(c, 1, y0 + 3, 2, 2, S[1]); r(c, 1, y0 + 3, 2, 1, S[3]); }
      break;
    case 'jacket':
      r(c, -1, y0, 2, 8, B[2]); r(c, -1, y0, 2, 1, K[1]); px(c, 0, y0 + 2, B[1]);
      r(c, -2, y0, 1, 4, S[3]); r(c, 1, y0, 1, 4, S[1]); r(c, -2, y0 + 4, 1, 4, S[1]); r(c, 1, y0 + 4, 1, 4, S[0]);
      r(c, -4, y0 + 5, 2, 1, S[1]); r(c, 2, y0 + 5, 2, 1, S[0]);
      break;
    case 'hoodie':
      r(c, -3, y0 - 1, 6, 2, S[1]); r(c, -1, y0, 2, 1, K[1]);
      r(c, -2, y0 + 1, 1, 3, B[2]); r(c, 1, y0 + 1, 1, 3, B[2]);
      r(c, -3, y0 + 5, 6, 2, S[1]); r(c, -3, y0 + 5, 6, 1, S[0]);
      break;
    case 'sweater':
      r(c, -1, y0, 2, 1, S[1]);
      r(c, -4, y0 + 3, 8, 2, B[2]); for (let i = -4; i < 4; i += 2) px(c, i + 1, y0 + 3, S[2]);
      r(c, -4, y0 + 7, 8, 1, S[1]);
      break;
    case 'vest':
      r(c, -2, y0, 4, 8, B[2]); r(c, -1, y0, 2, 1, K[1]); r(c, -1, y0 + 1, 2, 1, B[1]);
      r(c, -2, y0 + 1, 1, 7, S[1]); r(c, 1, y0 + 1, 1, 7, S[1]); px(c, -2, y0 + 4, '#e8c060'); px(c, -2, y0 + 6, '#e8c060');
      break;
    case 'overalls':
      r(c, -4, y0, 8, 4, B[2]); r(c, -4, y0, 1, 4, B[3]); r(c, 3, y0, 1, 4, B[1]); r(c, -1, y0, 2, 1, K[1]);
      r(c, -3, y0, 1, 4, S[2]); r(c, 2, y0, 1, 4, S[2]);
      r(c, -3, y0 + 3, 6, 5, S[2]); r(c, -3, y0 + 3, 6, 1, S[3]); r(c, -1, y0 + 5, 2, 2, S[1]);
      px(c, -3, y0 + 3, '#f2d36b'); px(c, 2, y0 + 3, '#f2d36b');
      break;
    case 'dress':
      r(c, -1, y0, 2, 2, K[1]); px(c, -2, y0, K[1]); px(c, 1, y0, K[1]);
      r(c, -4, y0 + 6, 8, 1, B[2]); px(c, -1, y0 + 6, B[3]); px(c, 0, y0 + 6, '#f2d36b');
      break;
    case 'apron':
      r(c, -1, y0, 2, 1, K[1]);
      r(c, -3, y0 + 2, 6, 8, B[2]); r(c, -3, y0 + 2, 6, 1, lt(B[2], 0.4)); r(c, 2, y0 + 3, 1, 7, B[1]);
      r(c, -3, y0, 1, 2, B[2]); r(c, 2, y0, 1, 2, B[2]);
      r(c, -2, y0 + 6, 3, 2, B[1]); r(c, -2, y0 + 6, 3, 1, B[0]);
      break;
    case 'flannel': plaid(c, L, y0); r(c, -1, y0, 2, 1, K[1]); px(c, -2, y0, B[2]); px(c, 1, y0, B[2]); break;
    case 'tank': r(c, -4, y0, 2, 2, K[2]); r(c, 2, y0, 2, 2, K[2]); r(c, -2, y0, 4, 1, K[1]); break;
    case 'sailor':
      r(c, -4, y0, 8, 3, B[2]); r(c, -1, y0, 2, 3, K[1]); r(c, -2, y0, 1, 3, '#f2efe6'); r(c, 1, y0, 1, 3, '#f2efe6');
      r(c, -1, y0 + 3, 2, 2, '#c0392b'); px(c, -1, y0 + 5, '#9a2a20');
      break;
  }
}

function plaid(c, L, y0) {
  const { S, B } = L;
  for (let j = 0; j < 8; j++) for (let i = -4; i < 4; i++) {
    const a = (i + 8) % 3 === 0, b = j % 3 === 1;
    if (a && b) px(c, i, y0 + j, B[2]); else if (a || b) px(c, i, y0 + j, S[1]);
  }
}

function armsFront(c, L, y0, frame) {
  const sw = [0, 1, 0, -1][frame];
  const sl = sleeveColor(L);
  for (const side of [-1, 1]) {
    const x = side < 0 ? (L.body === 0 ? -6 : -6) : 4;
    const yy = y0 + (L.body === 0 ? 1 : 2) + side * sw;
    const len = L.body === 0 ? 6 : 5;
    if (sl) { r(c, x, yy, 2, len, sl[2]); r(c, x + (side < 0 ? 0 : 1), yy, 1, len, side < 0 ? sl[3] : sl[1]); r(c, x, yy + len - 1, 2, 1, sl[0]); }
    else { r(c, x, yy, 2, 2, L.S[2]); r(c, x, yy + 2, 2, len - 2, L.K[side < 0 ? 2 : 1]); }
    r(c, x, yy + len, 2, 2, L.K[2]); px(c, x + (side < 0 ? 0 : 1), yy + len + 1, L.K[1]);
  }
}

function torsoSide(c, L, y0, frame) {
  const { S, B, K, shirt } = L;
  r(c, -3, y0, 6, 8, S[2]); r(c, -3, y0, 1, 8, S[1]); r(c, 2, y0 + 1, 1, 6, S[3]); r(c, -3, y0 + 7, 6, 1, S[0]);
  const k = shirt.kind;
  if (k === 'overalls') { r(c, -3, y0, 6, 4, B[2]); r(c, 0, y0 + 3, 3, 5, S[2]); r(c, 0, y0, 1, 4, S[2]); }
  else if (k === 'jacket') { r(c, 2, y0, 1, 8, B[2]); }
  else if (k === 'stripes') for (let j = 1; j < 8; j += 2) r(c, -3, y0 + j, 6, 1, B[2]);
  else if (k === 'flannel') for (let j = 1; j < 8; j += 3) r(c, -3, y0 + j, 6, 1, S[1]);
  else if (k === 'apron') { r(c, 2, y0 + 2, 2, 8, B[2]); r(c, -3, y0 + 5, 5, 1, B[1]); }
  else if (k === 'vest') { r(c, 1, y0, 2, 8, B[2]); }
  else if (k === 'hoodie') { r(c, -4, y0 - 1, 3, 3, S[1]); }
  else if (k === 'sailor') { r(c, -3, y0, 4, 3, B[2]); }
  else if (k === 'dress') { r(c, -3, y0 + 6, 6, 1, B[2]); }
  else if (k === 'tank') { r(c, -3, y0, 6, 1, K[1]); }
  r(c, 0, y0 - 1, 2, 1, K[1]);
  // near arm, swinging
  const sw = [0, 1, 0, -1][frame];
  const sl = sleeveColor(L);
  const ax = -1 + sw, len = 6;
  if (sl) { r(c, ax, y0 + 1, 2, len, sl[1]); r(c, ax, y0 + 1, 1, len, sl[2]); }
  else { r(c, ax, y0 + 1, 2, 2, S[1]); r(c, ax, y0 + 3, 2, len - 2, K[1]); }
  r(c, ax, y0 + 1 + len, 2, 2, K[2]);
}

// ---------- head ----------
// A big round chibi head, 12 px wide (x -6..5), wider than the body. Face rows run from
// y-28 (forehead) to y-18 (chin); hair sits on top and frames it.
const LASH = '#2a1a12';
const BLUSH = '#f4a0a0';

function headShape(c, L, y, side) {
  const { K } = L;
  r(c, -5, y - 28, 10, 1, K[2]);
  r(c, -6, y - 27, 12, 8, K[2]);
  r(c, -5, y - 19, 10, 1, K[2]);
  r(c, -4, y - 18, 8, 1, K[1]);
  if (!side) {
    r(c, -6, y - 27, 1, 7, K[3]);              // lit left cheek
    r(c, 5, y - 26, 1, 7, K[1]);               // shaded right cheek
    r(c, -5, y - 19, 1, 1, K[1]); r(c, 4, y - 19, 1, 1, K[1]);
  } else {
    r(c, -6, y - 27, 1, 8, K[1]);
  }
}

function headFront(c, L, y, back) {
  const { K, E } = L;
  headShape(c, L, y, false);
  r(c, -7, y - 23, 1, 2, back ? K[1] : K[3]); r(c, 6, y - 23, 1, 2, K[1]); // ears
  r(c, -1, y - 17, 2, 1, K[1]);                                          // neck
  if (back) return;
  // Big round eyes: dark top, coloured iris, a white sparkle in the upper corner.
  for (const x0 of [-4, 2]) {
    px(c, x0, y - 24, E[0]); px(c, x0 + 1, y - 24, E[0]);
    px(c, x0, y - 23, E[2]); px(c, x0 + 1, y - 23, E[1]);
    px(c, x0, y - 22, E[1]); px(c, x0 + 1, y - 22, E[0]);
    px(c, x0 === -4 ? x0 : x0 + 1, y - 24, EYE_W);
    if (L.body === 1) px(c, x0 === -4 ? -5 : 4, y - 25, LASH);
  }
  r(c, -5, y - 21, 2, 1, mix(K[2], BLUSH, 0.55)); r(c, 3, y - 21, 2, 1, mix(K[2], BLUSH, 0.55));
  px(c, -1, y - 20, '#b5574a'); px(c, 0, y - 20, '#c76a5a');             // tiny smile
}

function headSide(c, L, y) {
  const { K, E } = L;
  headShape(c, L, y, true);
  px(c, 6, y - 22, K[2]);                                               // little nose
  r(c, -2, y - 23, 2, 2, K[1]); px(c, -2, y - 23, K[0]);                // ear
  r(c, 0, y - 17, 2, 1, K[1]);
  px(c, 3, y - 24, EYE_W); px(c, 4, y - 24, E[0]);
  px(c, 3, y - 23, E[2]); px(c, 4, y - 23, E[1]);
  px(c, 3, y - 22, E[1]); px(c, 4, y - 22, E[0]);
  if (L.body === 1) px(c, 5, y - 25, LASH);
  r(c, 2, y - 21, 2, 1, mix(K[2], BLUSH, 0.55));
  px(c, 4, y - 20, '#b5574a');
}

function brows(c, L, y, dir) {
  const col = L.H[0];
  if (dir === 0) { r(c, -4, y - 26, 2, 1, col); r(c, 2, y - 26, 2, 1, col); }
  else if (dir === 3) r(c, 3, y - 26, 2, 1, col);
}

const hairBottom = (y, len) => [y - 23, y - 19, y - 15, y - 11][len];

// Hair cap over the skull: a rounded dome from `top` down to the forehead.
function cap(c, H, y, top, wide) {
  r(c, -4, top, 8, 1, H[2]);
  r(c, -5, top + 1, 10, 1, H[2]);
  r(c, -6, top + 2, 12, y - 26 - (top + 2), H[2]);
  if (wide) r(c, -7, top + 3, 14, y - 25 - (top + 3), H[2]);
  r(c, -3, top + 1, 3, 1, H[3]); r(c, -4, top + 2, 2, 1, H[3]); px(c, -5, top + 3, H[3]);   // shine
  r(c, 4, top + 2, 2, y - 26 - (top + 2), H[1]);
}

function hairFront(c, L, y, back) {
  const { H, hair } = L;
  const top = y - 31 - hair.vol;
  const f = hair.fringe;
  if (f === 'bald') {
    r(c, -5, y - 30, 10, 2, L.K[2]); r(c, -4, y - 31, 8, 1, L.K[2]); r(c, -4, y - 30, 3, 1, L.K[3]);
    r(c, -7, y - 26, 1, 3, H[1]); r(c, 6, y - 26, 1, 3, H[0]);
    return;
  }
  const buzz = f === 'none' && hair.extra !== 'mohawk';
  const Hc = buzz ? [H[0], dk(H[2], 0.12), dk(H[2], 0.05), H[2]] : H;
  if (hair.extra === 'mohawk') {
    r(c, -5, y - 30, 10, 3, L.K[2]); r(c, -6, y - 27, 12, 1, H[0]);
    r(c, -1, top - 2, 2, y - 26 - top + 2, H[2]); px(c, -1, top - 2, H[3]); r(c, 0, top - 1, 1, y - 26 - top + 1, H[1]);
  } else cap(c, Hc, y, buzz ? y - 30 : top, hair.vol > 0);
  // sides by length
  const bottom = hairBottom(y, hair.len);
  if (hair.len === 0) { r(c, -7, y - 26, 1, 3, H[2]); r(c, 6, y - 26, 1, 3, H[1]); }
  else {
    r(c, -7, y - 26, 2, bottom - (y - 26), H[2]); r(c, 5, y - 26, 2, bottom - (y - 26), H[1]);
    px(c, -7, y - 26, H[3]);
    if (hair.len >= 2) { r(c, -8, y - 22, 1, bottom - (y - 22), H[1]); r(c, 7, y - 22, 1, bottom - (y - 22), H[0]); }
    r(c, -7, bottom - 1, 2, 1, H[1]); r(c, 5, bottom - 1, 2, 1, H[0]);
  }
  if (back) {
    const nape = hair.len === 0 ? y - 20 : bottom;
    r(c, -6, y - 27, 12, nape - (y - 27), Hc[2]);
    r(c, -6, y - 27, 2, nape - (y - 27), Hc[3]); r(c, 4, y - 27, 2, nape - (y - 27), Hc[1]); r(c, -6, nape - 1, 12, 1, Hc[1]);
    if (hair.len >= 1) r(c, -7, y - 26, 14, bottom - (y - 26), H[2]), r(c, -7, bottom - 1, 14, 1, H[1]);
  } else if (!buzz && hair.extra !== 'mohawk') {
    // fringe over the forehead (rows y-27 .. y-25)
    const row = (yy, xs, col = H[2]) => { for (const [a, b] of xs) r(c, a, yy, b - a + 1, 1, col); };
    if (f === 'side') { row(y - 27, [[-6, 5]]); row(y - 26, [[-6, 2]]); row(y - 25, [[-6, -3]], H[1]); px(c, 3, y - 26, H[1]); }
    else if (f === 'part') { row(y - 27, [[-6, -2], [0, 5]]); px(c, -1, y - 27, L.K[1]); row(y - 26, [[-6, -3], [2, 5]]); row(y - 25, [[-6, -5], [4, 5]], H[1]); }
    else if (f === 'full') { row(y - 27, [[-6, 5]]); row(y - 26, [[-6, -3], [-1, 0], [2, 5]]); row(y - 25, [[-6, -5], [4, 5]], H[1]); px(c, -1, y - 25, H[1]); }
    else if (f === 'spiky') { row(y - 27, [[-6, 5]]); for (const x of [-6, -4, -2, 0, 2, 4]) px(c, x, y - 26, H[2]); }
    else if (f === 'swoop') { row(y - 27, [[-6, 5]]); row(y - 26, [[-3, 5]]); row(y - 25, [[1, 5]], H[1]); px(c, -2, y - 27, H[3]); }
  }
  extras(c, L, y, back ? 1 : 0, top);
}

function hairSide(c, L, y) {
  const { H, hair } = L;
  const top = y - 31 - hair.vol;
  if (hair.fringe === 'bald') { r(c, -5, y - 30, 10, 2, L.K[2]); r(c, -4, y - 31, 8, 1, L.K[2]); r(c, -7, y - 26, 3, 3, H[1]); return; }
  const buzz = hair.fringe === 'none' && hair.extra !== 'mohawk';
  if (hair.extra === 'mohawk') {
    r(c, -5, y - 30, 10, 3, L.K[2]); r(c, -6, y - 27, 10, 1, H[0]);
    r(c, -3, top - 2, 5, 3, H[2]); r(c, -4, top - 1, 7, y - 27 - top, H[2]);
  } else cap(c, buzz ? [H[0], dk(H[2], 0.12), dk(H[2], 0.05), H[2]] : H, y, buzz ? y - 30 : top, false);
  const bottom = hair.len === 0 ? y - 21 : hairBottom(y, hair.len);
  r(c, -7, y - 27, 6, bottom - (y - 27), buzz ? dk(H[2], 0.12) : H[2]);
  r(c, -7, y - 27, 1, bottom - (y - 27), H[1]); r(c, -7, bottom - 1, 6, 1, H[1]); px(c, -5, y - 27, H[3]);
  if (hair.len >= 2) r(c, -8, y - 22, 2, bottom - (y - 22), H[1]);
  if (!buzz && hair.extra !== 'mohawk') {
    r(c, -6, y - 27, 12, 1, H[2]);
    if (hair.fringe === 'full' || hair.fringe === 'swoop') r(c, 1, y - 26, 5, 1, H[2]), px(c, 5, y - 25, H[1]);
    else if (hair.fringe === 'side' || hair.fringe === 'part') r(c, 2, y - 26, 4, 1, H[2]);
    else if (hair.fringe === 'spiky') { px(c, 2, y - 26, H[2]); px(c, 4, y - 26, H[2]); }
  }
  extras(c, L, y, 3, top);
}

function extras(c, L, y, dir, top) {
  const { H, hair } = L;
  const e = hair.extra;
  if (e === 'bun') {
    const x = dir === 3 ? -6 : -3;
    r(c, x + 1, top - 4, 4, 1, H[2]); r(c, x, top - 3, 6, 3, H[2]); r(c, x + 1, top, 4, 1, H[1]);
    r(c, x + 1, top - 3, 2, 1, H[3]); r(c, x + 5, top - 2, 1, 2, H[1]);
  } else if (e === 'pony') {
    if (dir === 1) { r(c, -1, y - 24, 2, 9, H[2]); px(c, -1, y - 24, H[3]); r(c, -1, y - 25, 2, 1, '#e0457b'); r(c, -1, y - 16, 2, 1, H[1]); }
    else if (dir === 3) { r(c, -9, y - 26, 2, 8, H[2]); r(c, -9, y - 19, 2, 1, H[1]); px(c, -7, y - 26, '#e0457b'); }
    else { r(c, 6, y - 24, 1, 4, H[1]); }
  } else if (e === 'pigtails') {
    const tail = (x) => { r(c, x, y - 24, 2, 6, H[2]); px(c, x, y - 24, H[3]); r(c, x, y - 19, 2, 1, H[1]); r(c, x, y - 25, 2, 1, '#e0457b'); };
    if (dir === 3) tail(-9); else { tail(-9); tail(7); }
  } else if (e === 'curly') {
    for (const x of [-4, -2, 0, 2]) px(c, x, top - 1, H[2]);
    const bottom = hair.len === 0 ? y - 22 : hairBottom(y, hair.len);
    for (let yy = top + 3; yy < bottom; yy += 2) { px(c, -8, yy, H[1]); if (dir !== 3) px(c, 7, yy, H[0]); }
  } else if (e === 'spiky') {
    for (const x of [-5, -3, -1, 1, 3]) px(c, x, top - 1, H[2]);
    for (const x of [-4, 0, 2]) px(c, x, top - 2, H[3]);
  }
}

// ---------- accessories ----------
function faceAcc(c, L, y, dir) {
  const a = L.acc;
  if (!a.kind || dir === 1) {
    if (dir === 1 && a.kind === 'bandana') r(c, -3, y - 17, 6, 2, ramp(a.color)[1]);
    return;
  }
  const front = dir === 0;
  const col = a.color;
  switch (a.kind) {
    case 'glasses': case 'round':
      if (front) {
        for (const x0 of [-5, 1]) {
          r(c, x0, y - 25, 4, 1, col); px(c, x0, y - 24, col); px(c, x0 + 3, y - 24, col); px(c, x0, y - 23, col); px(c, x0 + 3, y - 23, col);
          if (a.kind === 'round') r(c, x0 + 1, y - 21, 2, 1, col); else r(c, x0, y - 22, 4, 1, col);
        }
        r(c, -1, y - 24, 2, 1, col);
      } else { r(c, 2, y - 25, 4, 1, col); px(c, 2, y - 23, col); px(c, 5, y - 23, col); r(c, 2, y - 22, 4, 1, col); r(c, -1, y - 24, 3, 1, col); }
      break;
    case 'shades':
      if (front) { r(c, -5, y - 24, 10, 1, col); r(c, -5, y - 23, 4, 2, col); r(c, 1, y - 23, 4, 2, col); px(c, -4, y - 23, '#6a7a8a'); px(c, 2, y - 23, '#6a7a8a'); }
      else { r(c, 2, y - 24, 4, 3, col); r(c, -1, y - 24, 3, 1, col); px(c, 3, y - 23, '#6a7a8a'); }
      break;
    case 'beard': {
      const H = L.H;
      if (front) { r(c, -6, y - 22, 1, 3, H[2]); r(c, 5, y - 22, 1, 3, H[1]); r(c, -6, y - 20, 12, 2, H[2]); r(c, -5, y - 18, 10, 2, H[2]); r(c, -4, y - 16, 8, 1, H[1]); r(c, -2, y - 20, 4, 1, H[3]); r(c, -1, y - 19, 2, 1, '#7a3a2a'); }
      else { r(c, -1, y - 21, 7, 4, H[2]); r(c, 0, y - 17, 5, 1, H[1]); r(c, 5, y - 20, 1, 2, H[1]); }
      break;
    }
    case 'moustache':
      if (front) { r(c, -3, y - 21, 6, 1, L.H[2]); px(c, -3, y - 20, L.H[1]); px(c, 2, y - 20, L.H[1]); }
      else r(c, 3, y - 21, 3, 1, L.H[2]);
      break;
    case 'stubble':
      for (const [x, yy] of front ? [[-5, 20], [-3, 19], [2, 19], [4, 20], [-4, 18], [3, 18], [-2, 18], [1, 18]] : [[1, 19], [3, 18], [2, 20], [4, 19]]) px(c, x, y - yy, mix(L.K[2], L.H[1], 0.4));
      break;
    case 'freckles':
      for (const [x, yy] of front ? [[-5, 22], [-4, 21], [3, 22], [4, 21]] : [[2, 22], [3, 21]]) px(c, x, y - yy, L.K[0]);
      break;
    case 'blush':
      if (front) { r(c, -5, y - 21, 2, 2, '#f08a8a'); r(c, 3, y - 21, 2, 2, '#f08a8a'); } else r(c, 2, y - 21, 2, 2, '#f08a8a');
      break;
    case 'earrings':
      if (front) { px(c, -7, y - 21, col); px(c, 6, y - 21, col); } else px(c, -2, y - 21, col);
      break;
    case 'patch':
      if (front) { r(c, -5, y - 25, 4, 4, col); for (let i = 0; i < 7; i++) px(c, -1 + i, y - 26 - (i >> 1), col); }
      else r(c, -6, y - 26, 12, 1, col);
      break;
    case 'bandana': {
      const B = ramp(col);
      r(c, -3, y - 17, 6, 2, B[2]); r(c, -2, y - 15, 4, 1, B[2]); px(c, -1, y - 14, B[1]); px(c, -2, y - 16, B[3]);
      break;
    }
  }
}

function hatAcc(c, L, y, dir) {
  const a = L.acc;
  const top = y - 31 - L.hair.vol;
  const side = dir === 3;
  switch (a.kind) {
    case 'bow': {
      const B = ramp(a.color);
      const x = side ? -5 : dir === 1 ? -2 : 2;
      r(c, x, top + 1, 5, 3, B[2]); px(c, x + 2, top + 2, B[0]); r(c, x, top + 1, 1, 1, B[3]); px(c, x + 2, top + 1, B[1]);
      break;
    }
    case 'flower':
      if (dir === 1) return;
      { const x = side ? 2 : 3; r(c, x, y - 30, 3, 3, a.color); px(c, x + 1, y - 29, '#f1c40f'); px(c, x, y - 30, '#ffffff'); }
      break;
    case 'cap': {
      const C = ramp(a.color);
      r(c, -6, top, 12, y - 26 - top, C[2]); r(c, -5, top - 1, 10, 1, C[2]); r(c, -4, top - 1, 3, 1, C[3]); r(c, 4, top + 1, 2, y - 27 - top, C[1]);
      px(c, -1, top - 2, C[1]);
      if (dir === 0) { r(c, -7, y - 27, 14, 1, C[1]); r(c, -6, y - 26, 12, 1, C[0]); r(c, -1, top + 1, 2, 2, '#f2efe6'); }
      else if (side) { r(c, -6, y - 27, 14, 1, C[1]); r(c, 4, y - 26, 4, 1, C[0]); }
      else r(c, -6, y - 27, 12, 1, C[1]);
      break;
    }
    case 'sunhat': {
      const C = ramp(a.color);
      const bw = side ? 18 : 20;
      r(c, -bw / 2, y - 28, bw, 2, C[2]); r(c, -bw / 2, y - 28, bw, 1, C[3]); r(c, -bw / 2, y - 27, bw, 1, C[1]);
      r(c, -5, y - 33, 10, 5, C[2]); r(c, -4, y - 34, 8, 1, C[2]); r(c, -5, y - 33, 2, 5, C[3]); r(c, 3, y - 33, 2, 5, C[1]);
      r(c, -5, y - 29, 10, 1, '#c0392b');
      for (let x = -4; x < 4; x += 2) px(c, x, y - 32, C[1]);
      break;
    }
    case 'beanie': {
      const C = ramp(a.color);
      r(c, -7, top, 14, y - 26 - top, C[2]); r(c, -6, top - 1, 12, 1, C[2]); r(c, -6, top, 3, 2, C[3]);
      r(c, -7, y - 28, 14, 2, C[1]); for (let x = -7; x < 7; x += 2) px(c, x, y - 28, C[0]);
      r(c, -1, top - 3, 2, 2, '#f2efe6');
      break;
    }
    case 'headband':
      r(c, -7, y - 28, side ? 13 : 14, 1, a.color); if (side) px(c, -7, y - 27, a.color);
      break;
    case 'patch':
      if (dir === 1) r(c, -6, y - 26, 12, 1, a.color);
      break;
  }
}

// ---------- whole person ----------
function paint(c, L, dir, frame) {
  const side = dir === 2 || dir === 3;
  if (dir === 2) { c.scale(-1, 1); dir = 3; }
  const bob = frame % 2 ? -1 : 0;
  const y0 = -17 + bob; // torso top
  legs(c, L, dir, frame);
  if (side) {
    skirt(c, L, y0, true);
    torsoSide(c, L, y0, frame);
    headSide(c, L, bob);
    brows(c, L, bob, 3);
    faceAcc(c, L, bob, 3);
    hairSide(c, L, bob);
  } else {
    if (dir === 1) armsFront(c, L, y0, frame);
    skirt(c, L, y0, false);
    torsoFront(c, L, y0, dir === 1);
    if (dir === 0) armsFront(c, L, y0, frame);
    headFront(c, L, bob, dir === 1);
    if (dir === 0) brows(c, L, bob, 0);
    faceAcc(c, L, bob, dir);
    hairFront(c, L, bob, dir === 1);
  }
  hatAcc(c, L, bob, dir);
}

const resolved = new Map();
function resolveCached(look) {
  const k = lookKey(look);
  let L = resolved.get(k);
  if (!L) { L = resolve(look); resolved.set(k, L); }
  return { k, L };
}

// Sprite for a (sanitized) look, facing dir, walk frame 0..3.
export function personSprite(look, dir, frame) {
  const { k, L } = resolveCached(look);
  return bake(`pp|${k}|${dir}|${frame}`, 12, 40, 24, 42, (cc) => paint(cc, L, dir, frame));
}

// Draw a look scaled up onto a canvas (character creator preview, portraits).
// crop: 'full' or 'bust'.
export function drawLook(canvas, look, { dir = 0, frame = 0, crop = 'full' } = {}) {
  const spr = personSprite(sanitizeLook(look), dir, frame);
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, canvas.width, canvas.height);
  // sprite-local rows: feet at 0, head top around -36
  const [sy0, sy1] = crop === 'bust' ? [-37, -12] : [-38, 1];
  const sx0 = -12, sx1 = 12;
  const sw = sx1 - sx0, sh = sy1 - sy0;
  const scale = Math.max(1, Math.floor(Math.min(canvas.width / sw, canvas.height / sh)));
  const dx = Math.round((canvas.width - sw * scale) / 2), dy = Math.round(canvas.height - sh * scale - (crop === 'full' ? scale * 2 : 0));
  g.drawImage(spr.cv, sx0 - spr.dx, sy0 - spr.dy, sw, sh, dx, dy, sw * scale, sh * scale);
}

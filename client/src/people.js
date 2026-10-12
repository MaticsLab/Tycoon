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
    if (!dress) { r(c, -4, -10, 8, 4, P[2]); r(c, -4, -10, 1, 4, P[3]); r(c, 3, -10, 1, 4, P[1]); r(c, -1, -7, 2, 1, P[1]); }
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
  if (!dress) { r(c, -3, -10, 6, 4, P[2]); r(c, -3, -10, 6, 1, P[3]); }
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
const HEAD_TOP = -29; // first face row (hair sits above and on it)

function headFront(c, L, y, back) {
  const { K } = L;
  // face block: rows y-29 .. y-20, rounded chin
  r(c, -5, y - 29, 10, 9, K[2]); r(c, -4, y - 20, 8, 1, K[2]);
  r(c, -5, y - 28, 1, 7, K[3]); r(c, 4, y - 28, 1, 8, K[1]); r(c, -4, y - 20, 8, 1, K[1]);
  r(c, -6, y - 25, 1, 2, back ? K[2] : K[3]); r(c, 5, y - 25, 1, 2, K[1]); // ears
  r(c, -1, y - 19, 2, 1, K[1]); // neck
  if (back) return;
  const E = L.E;
  for (const side of [-1, 1]) {
    const outer = side < 0 ? -3 : 2, inner = side < 0 ? -2 : 1;
    px(c, outer, y - 25, EYE_W); px(c, inner, y - 25, E[2]); px(c, inner, y - 24, E[0]); px(c, outer, y - 24, mix(E[2], K[2], 0.45));
    if (L.body === 1) px(c, side < 0 ? -4 : 3, y - 26, '#2a1a12');
  }
  px(c, 0, y - 23, K[1]);
  r(c, -1, y - 21, 2, 1, L.body === 1 ? '#c0605a' : '#a0523c');
}

function headSide(c, L, y) {
  const { K, E } = L;
  r(c, -5, y - 29, 10, 9, K[2]); r(c, -4, y - 20, 8, 1, K[1]); r(c, -5, y - 28, 1, 7, K[1]);
  px(c, 5, y - 24, K[2]); px(c, 5, y - 23, K[1]); // nose
  r(c, -1, y - 25, 2, 2, K[1]); px(c, -1, y - 25, K[0]); // ear
  r(c, 0, y - 19, 2, 1, K[1]);
  px(c, 3, y - 25, E[2]); px(c, 3, y - 24, E[0]); px(c, 4, y - 25, EYE_W);
  if (L.body === 1) px(c, 4, y - 26, '#2a1a12');
  px(c, 3, y - 21, L.body === 1 ? '#c0605a' : '#a0523c');
}

// Brows sit on the face, just below the fringe.
function brows(c, L, y, dir) {
  const col = L.H[0];
  if (L.hair.fringe === 'bald' && dir !== 1) { /* still has brows */ }
  if (dir === 0) { r(c, -3, y - 27, 2, 1, col); r(c, 1, y - 27, 2, 1, col); }
  else if (dir === 3) r(c, 2, y - 27, 3, 1, col);
}

function hairFront(c, L, y, back) {
  const { H, hair } = L;
  const top = y - 31 - hair.vol;
  const f = hair.fringe;
  if (f === 'bald') {
    r(c, -4, y - 31, 8, 2, L.K[2]); r(c, -4, y - 31, 3, 1, L.K[3]); r(c, 3, y - 30, 1, 1, L.K[1]);
    r(c, -6, y - 27, 1, 3, H[1]); r(c, 5, y - 27, 1, 3, H[0]);
    return;
  }
  const buzz = f === 'none' && hair.extra !== 'mohawk';
  const Hc = buzz ? [H[0], dk(H[2], 0.12), H[1], H[2]] : H;
  // cap
  r(c, -4, top, 8, 1, Hc[2]);
  r(c, -5, top + 1, 10, y - 28 - (top + 1), Hc[2]);
  if (hair.vol > 0) r(c, -6, top + 2, 12, y - 27 - (top + 2), Hc[2]);
  r(c, -3, top + 1, 3, 1, Hc[3]); px(c, -4, top + 2, Hc[3]); r(c, 3, top + 2, 2, y - 28 - (top + 2), Hc[1]);
  if (hair.extra === 'mohawk') {
    r(c, -5, top + 1, 10, y - 28 - top, L.K[2]); r(c, -6, y - 29, 12, 2, H[0]);
    r(c, -1, top - 2, 2, y - 28 - top + 2, H[2]); px(c, -1, top - 2, H[3]); r(c, 0, top - 1, 1, y - 28 - top + 1, H[1]);
  }
  // sides by length
  const bottom = [y - 26, y - 21, y - 17, y - 12][hair.len];
  if (hair.len === 0) { r(c, -6, y - 29, 1, 3, H[2]); r(c, 5, y - 29, 1, 3, H[1]); }
  else {
    const flare = hair.len >= 2 ? 1 : 0;
    r(c, -6, y - 29, 2, bottom - (y - 29), H[2]); r(c, 4, y - 29, 2, bottom - (y - 29), H[1]);
    if (back) r(c, -6, y - 29, 12, bottom - (y - 29), H[2]);
    if (flare) { r(c, -7, y - 23, 1, bottom - (y - 23), H[1]); r(c, 6, y - 23, 1, bottom - (y - 23), H[0]); }
    r(c, -6, bottom - 1, 2, 1, H[1]); r(c, 4, bottom - 1, 2, 1, H[0]);
  }
  if (back) {
    // the whole back of the head is hair
    const nape = hair.len === 0 ? y - 22 : bottom;
    r(c, -5, y - 29, 10, nape - (y - 29), H[2]);
    r(c, -5, y - 29, 2, nape - (y - 29), H[3]); r(c, 3, y - 29, 2, nape - (y - 29), H[1]); r(c, -5, nape - 1, 10, 1, H[1]);
    if (buzz) r(c, -5, y - 29, 10, 5, Hc[2]);
  } else if (!buzz && hair.extra !== 'mohawk') {
    // fringe
    const row = (yy, xs) => { for (const [a, b] of xs) r(c, a, yy, b - a + 1, 1, H[2]); };
    if (f === 'side') { row(y - 29, [[-5, 4]]); row(y - 28, [[-5, 1]]); r(c, -5, y - 27, 2, 1, H[1]); px(c, 2, y - 28, H[1]); }
    else if (f === 'part') { row(y - 29, [[-5, -2], [0, 4]]); px(c, -1, y - 29, H[0]); row(y - 28, [[-5, -3], [2, 4]]); }
    else if (f === 'full') { row(y - 29, [[-5, 4]]); row(y - 28, [[-5, -3], [-1, 0], [2, 4]]); px(c, -4, y - 27, H[1]); px(c, 3, y - 27, H[1]); }
    else if (f === 'spiky') { row(y - 29, [[-5, 4]]); for (const x of [-5, -3, -1, 1, 3]) px(c, x, y - 28, H[2]); }
    else if (f === 'swoop') { row(y - 29, [[-5, 4]]); row(y - 28, [[-2, 4]]); row(y - 27, [[1, 4]]); r(c, 3, y - 28, 2, 2, H[1]); px(c, -1, y - 29, H[3]); }
    r(c, -5, y - 29, 1, 2, H[3]);
  }
  extras(c, L, y, back ? 1 : 0, top);
}

function hairSide(c, L, y) {
  const { H, hair } = L;
  const top = y - 31 - hair.vol;
  if (hair.fringe === 'bald') { r(c, -4, y - 31, 8, 2, L.K[2]); r(c, -6, y - 27, 2, 3, H[1]); return; }
  const buzz = hair.fringe === 'none' && hair.extra !== 'mohawk';
  r(c, -4, top, 8, 1, H[2]);
  r(c, -5, top + 1, 10, y - 28 - (top + 1), H[2]);
  r(c, -2, top + 1, 4, 1, H[3]);
  if (hair.extra === 'mohawk') { r(c, -5, top + 1, 10, y - 28 - top, L.K[2]); r(c, -5, y - 29, 9, 2, H[0]); r(c, -3, top - 2, 5, 3, H[2]); r(c, -4, top - 1, 7, y - 28 - top, H[2]); }
  const bottom = [y - 23, y - 21, y - 17, y - 12][hair.len];
  r(c, -6, top + 2, 5, bottom - (top + 2), buzz ? dk(H[2], 0.12) : H[2]);
  r(c, -6, top + 2, 1, bottom - (top + 2), H[1]); r(c, -6, bottom - 1, 5, 1, H[1]);
  if (hair.len >= 2) r(c, -7, y - 24, 2, bottom - (y - 24), H[1]);
  if (!buzz && hair.extra !== 'mohawk') {
    r(c, -5, y - 29, 10, 1, H[2]);
    if (hair.fringe === 'full' || hair.fringe === 'swoop') r(c, 1, y - 28, 4, 1, H[2]);
    else if (hair.fringe === 'side') r(c, 2, y - 28, 3, 1, H[2]);
    else if (hair.fringe === 'spiky') { px(c, 2, y - 28, H[2]); px(c, 4, y - 28, H[2]); }
  }
  extras(c, L, y, 3, top);
}

function extras(c, L, y, dir, top) {
  const { H, hair } = L;
  const e = hair.extra;
  if (e === 'bun') {
    const x = dir === 3 ? -4 : -2;
    r(c, x, top - 3, 4, 3, H[2]); r(c, x + 1, top - 4, 2, 1, H[2]); px(c, x + 1, top - 3, H[3]); r(c, x + 3, top - 2, 1, 2, H[1]);
  } else if (e === 'pony') {
    if (dir === 1) { r(c, -1, y - 26, 2, 9, H[2]); px(c, -1, y - 26, H[3]); r(c, -1, y - 27, 2, 1, '#c0392b'); r(c, -1, y - 18, 2, 1, H[1]); }
    else if (dir === 3) { r(c, -8, y - 28, 2, 8, H[2]); r(c, -8, y - 21, 2, 1, H[1]); px(c, -6, y - 28, '#c0392b'); }
    else { r(c, 5, y - 26, 1, 4, H[1]); }
  } else if (e === 'pigtails') {
    const tail = (x) => { r(c, x, y - 26, 2, 6, H[2]); px(c, x, y - 26, H[3]); r(c, x, y - 21, 2, 1, H[1]); r(c, x, y - 27, 2, 1, '#e0457b'); };
    if (dir === 3) tail(-8); else { tail(-8); tail(6); }
  } else if (e === 'curly') {
    for (const x of [-3, -1, 1]) px(c, x, top - 1, H[2]);
    const bottom = [y - 25, y - 21, y - 17, y - 12][hair.len];
    for (let yy = top + 3; yy < bottom; yy += 2) { px(c, -7, yy, H[1]); if (dir !== 3) px(c, 6, yy, H[0]); }
  } else if (e === 'spiky') {
    for (const x of [-4, -2, 0, 2]) px(c, x, top - 1, H[2]);
    for (const x of [-3, 1]) px(c, x, top - 2, H[3]);
  }
}

// ---------- accessories ----------
function faceAcc(c, L, y, dir) {
  const a = L.acc;
  if (!a.kind || dir === 1) {
    if (dir === 1 && a.kind === 'bandana') r(c, -3, y - 19, 6, 2, ramp(a.color)[1]);
    return;
  }
  const front = dir === 0;
  const col = a.color;
  switch (a.kind) {
    case 'glasses': case 'round':
      if (front) {
        r(c, -4, y - 26, 4, 1, col); r(c, 0, y - 26, 4, 1, col); px(c, -4, y - 25, col); px(c, 3, y - 25, col); r(c, -1, y - 25, 2, 1, col);
        if (a.kind === 'round') { px(c, -4, y - 24, col); px(c, -1, y - 24, col); px(c, 0, y - 24, col); px(c, 3, y - 24, col); }
        px(c, -2, y - 25, mix(L.E[2], '#ffffff', 0.25));
      } else { r(c, 1, y - 26, 4, 1, col); px(c, 5, y - 25, col); r(c, -1, y - 26, 2, 1, col); }
      break;
    case 'shades':
      if (front) { r(c, -4, y - 26, 8, 1, col); r(c, -4, y - 25, 3, 2, col); r(c, 1, y - 25, 3, 2, col); px(c, -3, y - 25, '#5a6a7a'); px(c, 2, y - 25, '#5a6a7a'); }
      else { r(c, 2, y - 26, 3, 3, col); r(c, -1, y - 26, 3, 1, col); }
      break;
    case 'beard': {
      const H = L.H;
      if (front) { r(c, -5, y - 23, 1, 2, H[2]); r(c, 4, y - 23, 1, 2, H[1]); r(c, -5, y - 22, 10, 3, H[2]); r(c, -4, y - 19, 8, 1, H[1]); r(c, -2, y - 22, 4, 1, H[3]); px(c, -1, y - 21, '#5a2a1a'); px(c, 0, y - 21, '#5a2a1a'); }
      else { r(c, -2, y - 23, 6, 4, H[2]); r(c, -1, y - 19, 4, 1, H[1]); r(c, 4, y - 22, 1, 2, H[1]); }
      break;
    }
    case 'moustache':
      if (front) { r(c, -2, y - 22, 4, 1, L.H[2]); px(c, -2, y - 21, L.H[1]); px(c, 1, y - 21, L.H[1]); }
      else r(c, 3, y - 22, 3, 1, L.H[2]);
      break;
    case 'stubble':
      for (const [x, yy] of front ? [[-4, 21], [-2, 20], [0, 20], [2, 21], [-3, 22], [3, 22], [1, 21], [-1, 22]] : [[1, 21], [3, 20], [2, 22], [-1, 21]]) px(c, x, y - yy, mix(L.K[2], L.H[1], 0.45));
      break;
    case 'freckles':
      for (const [x, yy] of front ? [[-4, 23], [-3, 22], [2, 23], [3, 22]] : [[2, 23], [3, 22]]) px(c, x, y - yy, L.K[0]);
      break;
    case 'blush':
      if (front) { r(c, -4, y - 23, 2, 1, '#f08a8a'); r(c, 2, y - 23, 2, 1, '#f08a8a'); } else r(c, 2, y - 23, 2, 1, '#f08a8a');
      break;
    case 'earrings':
      if (front) { px(c, -6, y - 23, col); px(c, 5, y - 23, col); } else px(c, -1, y - 23, col);
      break;
    case 'patch':
      if (front) { r(c, -4, y - 26, 3, 3, col); for (let i = 0; i < 6; i++) px(c, -1 + i, y - 27 - (i >> 1), col); }
      else r(c, -5, y - 28, 10, 1, col);
      break;
    case 'bandana': {
      const B = ramp(col);
      r(c, -3, y - 19, 6, 2, B[2]); r(c, -2, y - 17, 4, 1, B[2]); px(c, -1, y - 16, B[1]); px(c, -2, y - 18, B[3]);
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
      const x = side ? -4 : dir === 1 ? -2 : 2;
      r(c, x, top + 1, 4, 3, B[2]); px(c, x + 1, top + 2, B[0]); px(c, x + 2, top + 2, B[0]); r(c, x, top + 1, 1, 1, B[3]);
      break;
    }
    case 'flower':
      if (dir === 1) return;
      { const x = side ? 2 : 3; r(c, x, y - 31, 3, 3, a.color); px(c, x + 1, y - 30, '#f1c40f'); px(c, x, y - 31, '#ffffff'); }
      break;
    case 'cap': {
      const C = ramp(a.color);
      r(c, -5, top - 1, 10, y - 28 - top, C[2]); r(c, -4, top - 2, 8, 1, C[2]); r(c, -4, top - 1, 3, 1, C[3]); r(c, 3, top, 2, y - 29 - top, C[1]);
      px(c, -1, top - 3, C[1]);
      if (dir === 0) { r(c, -6, y - 29, 12, 1, C[1]); r(c, -5, y - 28, 10, 1, C[0]); r(c, -1, top + 1, 2, 2, '#f2efe6'); }
      else if (side) { r(c, -5, y - 29, 12, 1, C[1]); r(c, 3, y - 28, 4, 1, C[0]); }
      else r(c, -5, y - 29, 10, 1, C[1]);
      break;
    }
    case 'sunhat': {
      const C = ramp(a.color);
      const bw = side ? 16 : 18;
      r(c, -bw / 2, y - 30, bw, 2, C[2]); r(c, -bw / 2, y - 30, bw, 1, C[3]); r(c, -bw / 2, y - 29, bw, 1, C[1]);
      r(c, -5, y - 35, 10, 5, C[2]); r(c, -4, y - 36, 8, 1, C[2]); r(c, -5, y - 35, 2, 5, C[3]); r(c, 3, y - 35, 2, 5, C[1]);
      r(c, -5, y - 31, 10, 1, '#c0392b');
      for (let x = -4; x < 4; x += 2) px(c, x, y - 34, C[1]);
      break;
    }
    case 'beanie': {
      const C = ramp(a.color);
      r(c, -6, top, 12, y - 28 - top, C[2]); r(c, -5, top - 1, 10, 1, C[2]); r(c, -5, top, 3, 2, C[3]);
      r(c, -6, y - 30, 12, 2, C[1]); for (let x = -6; x < 6; x += 2) px(c, x, y - 30, C[0]);
      r(c, -1, top - 3, 2, 2, '#f2efe6');
      break;
    }
    case 'headband':
      r(c, side ? -6 : -6, y - 30, side ? 11 : 12, 1, a.color); if (side) px(c, -6, y - 29, a.color);
      break;
    case 'patch':
      if (dir === 1) r(c, -5, y - 28, 10, 1, a.color);
      break;
  }
}

// ---------- whole person ----------
function paint(c, L, dir, frame) {
  const side = dir === 2 || dir === 3;
  if (dir === 2) { c.scale(-1, 1); dir = 3; }
  const bob = frame % 2 ? -1 : 0;
  const y0 = -18 + bob; // torso top
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

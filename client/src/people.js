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
  // side view (facing right; left is mirrored): far leg, then near leg. Each foot swings
  // forward and back with the stride, the lifted one tucked up a little at the knee.
  const swing = [0, 2.5, 0, -2.5][frame], lift = [0, 1, 0, 1][frame];
  leg(c, L, -0.5, -9, -swing, -2 - (swing < 0 ? lift : 0), false);
  leg(c, L, 0, -9, swing, -2 - (swing > 0 ? lift : 0), true);
  if (!dress) { r(c, -3, -10, 6, 3, P[2]); r(c, -3, -10, 6, 1, P[3]); }
}

// ---------- the skeleton ----------
// Arms and (side-on) legs are two bones each: shoulder → elbow → wrist and hip → knee →
// ankle. A pose says where each hand or foot should be; two-bone IK finds the elbow or
// knee, and each bone is drawn as a chunky rotated pixel limb. bend: which side the
// middle joint goes (+1 / -1).
function ik(sx, sy, tx, ty, a, b, bend) {
  let dx = tx - sx, dy = ty - sy, d = Math.hypot(dx, dy) || 0.001;
  const dd = Math.max(Math.abs(a - b) + 0.01, Math.min(a + b - 0.01, d));
  dx = (dx / d) * dd; dy = (dy / d) * dd;
  const th = Math.atan2(dy, dx), al = Math.acos(Math.max(-1, Math.min(1, (a * a + dd * dd - b * b) / (2 * a * dd))));
  const ex = sx + Math.cos(th + bend * al) * a, ey = sy + Math.sin(th + bend * al) * a;
  return { ex, ey, hx: sx + dx, hy: sy + dy };
}
// A bone from (x0, y0) to (x1, y1), w px thick, in colour col with a darker edge.
function bone(c, x0, y0, x1, y1, w, col, edge) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
  const h = (w - 1) / 2;
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
    r(c, Math.round(x - h), Math.round(y - h), w, w, col);
  }
  if (edge) for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
    px(c, Math.round(x - h), Math.round(y + h), edge);
  }
}
// One arm: shoulder (sx, sy) reaching for (tx, ty). Sleeve colour on the upper arm (and
// the forearm for long sleeves), a 2x2 hand at the end.
function arm(c, L, sx, sy, tx, ty, bend, far = false) {
  const UP = 3.6, LO = 3.4;
  const j = ik(sx, sy, tx, ty, UP, LO, bend);
  const sl = sleeveColor(L), K = L.K, t = far ? 0 : 1;
  const upper = sl ? sl[1 + t] : L.S[1 + t], upperE = sl ? sl[0 + t] : L.S[0 + t];
  const long = sl && L.shirt.kind !== 'tee' && L.shirt.kind !== 'polo' && L.shirt.kind !== 'sailor';
  bone(c, sx, sy, j.ex, j.ey, 2, upper, upperE);
  bone(c, j.ex, j.ey, j.hx, j.hy, 2, long ? upper : K[1 + t], long ? upperE : K[t]);
  r(c, Math.round(j.hx - 1), Math.round(j.hy - 0.5), 2, 2, K[1 + t]);
  px(c, Math.round(j.hx - 1), Math.round(j.hy + 0.5), K[t]);
  return j;
}
// One side-on leg: hip → knee → ankle, a shoe at the ankle pointing forward (+x).
function leg(c, L, hx, hy, tx, ty, near) {
  const j = ik(hx, hy, tx, ty, 4.2, 4.2, -1);
  const P = L.P, dress = L.shirt.kind === 'dress', t = near ? 2 : 1;
  const col = dress ? L.K[t] : P[t], edge = dress ? L.K[t - 1] : P[t - 1];
  bone(c, hx, hy, j.ex, j.ey, 3, col, edge);
  bone(c, j.ex, j.ey, j.hx, j.hy, 3, col, edge);
  const ax = Math.round(j.hx), ay = Math.round(j.hy);
  r(c, ax - 2, ay, 4, 2, SHOE[t]); r(c, ax - 2, ay, 4, 1, SHOE[t === 2 ? 2 : 2]); px(c, ax + 1, ay + 1, SHOE[0]);
}

// Little props held in the hands.
function prop(c, kind, x, y, f) {
  x = Math.round(x); y = Math.round(y);
  if (kind === 'book') { r(c, x - 3, y - 3, 6, 4, '#7a3b2e'); r(c, x - 2, y - 3, 4, 3, '#f4ecd8'); px(c, x, y - 3, '#7a3b2e'); if (f % 2) r(c, x - 2, y - 3, 2, 1, '#d8ccb0'); }
  else if (kind === 'plate') { r(c, x - 3, y, 6, 1, '#f4f6f7'); r(c, x - 2, y - 1, 4, 1, f % 2 ? '#e8a23a' : '#c0392b'); }
  else if (kind === 'cup') { r(c, x - 1, y - 2, 2, 3, '#f4f6f7'); px(c, x + 1, y - 1, '#f4f6f7'); px(c, x - 1, y - 2, '#8a5a32'); }
  else if (kind === 'pad') { r(c, x - 3, y - 1, 6, 2, '#2f3542'); px(c, x - 2, y - 1, '#e74c3c'); px(c, x + 1, y - 1, '#3fa9f5'); }
  else if (kind === 'brush') { r(c, x, y - 4, 1, 4, '#a8703f'); px(c, x, y - 5, ['#e74c3c', '#3fa9f5', '#f5c542', '#5cb85c'][f % 4]); }
  else if (kind === 'stick') { r(c, x, y - 2, 1, 3, '#c99363'); px(c, x + 1, y - 3, '#d9b27a'); }
}

// Where the hands go for each activity (front view; back view mirrors it, side view uses
// SIDE_HANDS), frame f = 0..3 animates them. y0 = torso top, F = face top.
const SWAY = [0, 1, 0, -1];
function handsFront(arms, y0, F, f, frame) {
  const s = SWAY[f];
  switch (arms) {
    case 'eat': return { l: [-2, y0 + 6], r: f % 2 ? [1, F + 7] : [2, y0 + 5], prop: ['plate', -2, y0 + 6] };
    case 'drink': return { l: [-4, y0 + 7], r: f < 2 ? [1, F + 7] : [2, y0 + 4], prop: ['cup', f < 2 ? 1 : 2, f < 2 ? F + 7 : y0 + 4] };
    case 'read': return { l: [-2.5, y0 + 5], r: [2.5, y0 + 5], prop: ['book', 0, y0 + 6] };
    case 'type': return { l: [-2.5, y0 + 6 + (f % 2)], r: [2.5, y0 + 6 + (f % 2 ? 0 : 1)] };
    case 'game': return { l: [-2, y0 + 6], r: [2, y0 + 6 + (f % 2)], prop: ['pad', 0, y0 + 6] };
    case 'paint': return { l: [-5, y0 + 8], r: [5 + (f % 2), y0 + 1 + s], prop: ['brush', 5 + (f % 2), y0 + 1 + s] };
    case 'stir': return { l: [-2 + s, y0 + 6], r: [2 - s, y0 + 6 + (f % 2)] };
    case 'wash': return { l: [-1 + (f % 2), y0 + 7], r: [1 - (f % 2), y0 + 7] };
    case 'warm': return { l: [-3, y0 + 5 + (f % 2)], r: [3, y0 + 5 + (f % 2 ? 0 : 1)] };
    case 'wave': return { l: [-5, y0 + 8], r: [6 + (f % 2), y0 - 3] };
    case 'carry': return { l: [-2.5, y0 + 6], r: [2.5, y0 + 6], prop: ['plate', 0, y0 + 6] };
    case 'whittle': return { l: [-2, y0 + 7], r: [1 + (f % 2), y0 + 6], prop: ['stick', -2, y0 + 7] };
    case 'lap': return { l: [-4.5, y0 + 9.5], r: [4.5, y0 + 9.5] };
    default: return { l: [-5.5, y0 + 8 - SWAY[frame]], r: [5.5, y0 + 8 + SWAY[frame]] };
  }
}
// Side view (facing right): one near hand, sometimes a prop.
function handSide(arms, y0, F, f, frame) {
  switch (arms) {
    case 'eat': return { h: f % 2 ? [3, F + 7] : [4, y0 + 5], prop: ['plate', 4.5, y0 + 6] };
    case 'drink': return { h: f < 2 ? [3, F + 7] : [4, y0 + 4], prop: ['cup', f < 2 ? 3 : 4, f < 2 ? F + 7 : y0 + 4] };
    case 'read': return { h: [4, y0 + 4], prop: ['book', 5, y0 + 5] };
    case 'type': case 'stir': case 'warm': return { h: [5, y0 + 5 + (f % 2)] };
    case 'game': return { h: [4, y0 + 6], prop: ['pad', 4, y0 + 6] };
    case 'paint': return { h: [6, y0 + 1 + SWAY[f]], prop: ['brush', 6, y0 + 1 + SWAY[f]] };
    case 'wash': return { h: [4 + (f % 2), y0 + 6] };
    case 'wave': return { h: [3 + (f % 2), y0 - 4] };
    case 'carry': return { h: [4.5, y0 + 6], prop: ['plate', 5, y0 + 6] };
    case 'whittle': return { h: [4, y0 + 6 + (f % 2)], prop: ['stick', 4, y0 + 6] };
    case 'lap': return { h: [3.5, y0 + 8] };
    default: return { h: [0.5 + SWAY[frame] * 2, y0 + 8] };
  }
}

// Sitting: thighs come towards you (front/back) or stick out forwards (side), shins
// hang down to the floor. The body above is lowered by SIT_DROP.
const SIT_DROP = 4;
function legsSitting(c, L, dir) {
  const { P } = L;
  const dress = L.shirt.kind === 'dress';
  if (dir === 0) {
    // Seen from the front: two thighs coming towards you (lit along the top, a shadow
    // between them), round knees a little apart, shins down to shoes pointing at you.
    const K = L.K, S = L.S;
    for (const side of [-1, 1]) {
      const x0 = side < 0 ? -5 : 1;                       // knee column (3 px)
      const th = dress ? S : P;
      // thigh: from the hip (under the torso) out to the knee
      r(c, side < 0 ? -4 : 0, -6, 4, 3, th[2]);
      r(c, side < 0 ? -4 : 0, -6, 4, 1, th[3]);
      // knee cap
      r(c, x0, -4, 4, 2, th[2]); r(c, x0 + 1, -4, 2, 1, lt(th[3], 0.3)); px(c, side < 0 ? x0 : x0 + 3, -3, th[1]);
      // shin and sock line
      const shin = dress ? K : P;
      r(c, x0 + 1, -2, 2, 1, shin[1]); px(c, side < 0 ? x0 + 1 : x0 + 2, -2, shin[0]);
      // shoe, toe towards you
      r(c, x0, -1, 4, 1, SHOE[1]); r(c, x0 + 1, -1, 2, 1, SHOE[2]); px(c, side < 0 ? x0 : x0 + 3, -1, SHOE[0]);
    }
    // the shadow between the legs
    r(c, 0, -5, 1, 4, dress ? S[0] : P[0]); px(c, -1, -3, dress ? S[1] : P[1]);
    if (dress) { r(c, -5, -4, 11, 1, S[1]); }
    return;
  }
  if (dir === 1) {
    // From behind the thighs are hidden by the body: the seat of the trousers on the
    // chair, then the calves and heels below.
    const th = dress ? L.S : P;
    r(c, -4, -6, 8, 3, th[1]); r(c, -4, -6, 8, 1, th[2]); r(c, 0, -5, 1, 2, th[0]);
    for (const x0 of [-4, 1]) {
      r(c, x0, -3, 3, 2, dress ? L.K[1] : P[1]); r(c, x0, -3, 3, 1, dress ? L.K[0] : P[0]);
      r(c, x0, -1, 3, 1, SHOE[1]); px(c, x0 + 1, -1, SHOE[2]);
    }
    return;
  }
  // side view facing right: hip on the seat, thigh straight out, shin down to the floor
  leg(c, L, 0, -6.5, 5, -2, false);
  leg(c, L, -0.5, -6.5, 4.5, -2, true);
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

function armsFront(c, L, y0, F, frame, arms, f, back) {
  const H = handsFront(arms, y0, F, f, frame);
  const sw = L.body === 0 ? 5 : 4.5;
  const lt2 = back ? [-H.r[0], H.r[1]] : H.l, rt2 = back ? [-H.l[0], H.l[1]] : H.r;
  arm(c, L, -sw, y0 + 1.5, lt2[0], lt2[1], 1);
  arm(c, L, sw, y0 + 1.5, rt2[0], rt2[1], -1);
  if (H.prop && !back) prop(c, H.prop[0], H.prop[1], H.prop[2], f);
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
}

// ---------- head ----------
// Stardew proportions: a narrow face (8 px, x -4..3) under big, textured hair. Every head
// part is placed relative to F, the face's top row (forehead); the chin is row F+8.
const LASH = '#2a1a12';

function face(c, L, F, dir) {
  const { K, E } = L;
  if (dir === 3) {
    // Profile facing right: forehead, nose, lips and chin.
    r(c, -3, F, 6, 1, K[2]); r(c, -4, F + 1, 8, 7, K[2]); r(c, -3, F + 8, 5, 1, K[1]);
    r(c, -4, F + 1, 1, 7, K[1]);
    px(c, 4, F + 4, K[2]); px(c, 4, F + 5, K[1]);             // nose
    px(c, 3, F + 7, K[1]); px(c, 2, F + 7, '#a8503e');         // lips
    px(c, 1, F + 4, E[1]); px(c, 2, F + 4, EYE_W); px(c, 1, F + 5, E[0]);
    if (L.body === 1) px(c, 2, F + 3, LASH);
    r(c, -1, F + 9, 3, 1, K[1]);                               // neck
    return;
  }
  r(c, -3, F, 6, 1, K[2]); r(c, -4, F + 1, 8, 7, K[2]); r(c, -3, F + 8, 6, 1, K[2]);
  r(c, -4, F + 1, 1, 6, K[3]); r(c, 3, F + 1, 1, 7, K[1]);
  r(c, -2, F + 9, 4, 1, K[2]); px(c, 1, F + 9, K[1]);           // neck (no dark jaw line: it read as a beard)
  if (dir === 1) return;
  // Eyes: a coloured iris with a white glint on the outside, darker underneath.
  px(c, -3, F + 4, EYE_W); px(c, -2, F + 4, E[1]); px(c, -2, F + 5, E[0]);
  px(c, 1, F + 4, E[1]); px(c, 2, F + 4, EYE_W); px(c, 1, F + 5, E[0]);
  if (L.body === 1) { px(c, -4, F + 4, LASH); px(c, 3, F + 4, LASH); }
  // A small, soft smile (no nose pixel: it read as a spot above the lip).
  const lip = L.body === 1 ? '#d4807a' : '#c98f80';
  px(c, -1, F + 7, lip); px(c, 0, F + 7, lip);
}

// Ears sit on top of short hair, so they read as ears rather than gaps in the hair.
function ears(c, L, F, dir) {
  if (L.hair.len > 0) return;
  const { K } = L;
  if (dir === 3) { r(c, -2, F + 3, 2, 2, K[2]); px(c, -1, F + 4, K[1]); px(c, -2, F + 3, K[3]); return; }
  r(c, -5, F + 3, 1, 2, dir === 1 ? K[1] : K[3]); r(c, 4, F + 3, 1, 2, K[1]);
}

function brows(c, L, F, dir) {
  const col = L.H[0];
  if (dir === 0) { r(c, -3, F + 3, 2, 1, col); r(c, 1, F + 3, 2, 1, col); }
  else if (dir === 3) r(c, 1, F + 3, 2, 1, col);
}

const hairBottom = (F, len) => F + [3, 9, 13, 18][len];

// Strand texture: darker lines running down the hair, lighter near the crown.
function strands(c, H, x0, x1, y0, y1, seed) {
  for (let x = x0; x <= x1; x++) {
    const h = ((x * 7 + seed * 13) % 5 + 5) % 5;
    if (h === 0 || h === 3) r(c, x, y0 + 1 + (h === 3 ? 1 : 0), 1, Math.max(0, y1 - y0 - 1 - (h === 3 ? 2 : 0)), H[1]);
  }
}

// A chunky tapered spike of hair centred on x, rising h rows from `base`; its tip
// ends `lean` px to the side.
function spike(c, H, x, base, h, lean) {
  for (let i = 0; i < h; i++) {
    const t = i / h, w = Math.max(1, Math.round(4 * (1 - t))), cx = x + Math.round(lean * t);
    const x0 = cx - Math.floor(w / 2);
    r(c, x0, base - i, w, 1, H[2]);
    if (w > 1) px(c, x0 + w - 1, base - i, H[1]);
    if (i >= h - 2 || (w > 2 && i % 2 === 0)) px(c, x0, base - i, H[3]);
  }
}

function capFront(c, L, F, top, back) {
  const { H, hair } = L;
  const fade = hair.sides === 'fade';
  r(c, -3, top, 6, 1, H[2]);
  r(c, -5, top + 1, 10, 1, H[2]);
  r(c, -6, top + 2, 12, F - top - 2, H[2]);
  // temples / over the ears
  if (fade) { r(c, -5, F, 1, 3, H[1]); r(c, 4, F, 1, 3, H[0]); }
  else { r(c, -6, F, 2, 4, H[2]); r(c, 4, F, 2, 4, H[1]); r(c, -6, F + 3, 1, 1, H[1]); }
  strands(c, H, -5, 4, top + 1, F + (fade ? 0 : 3), back ? 2 : 1);
  if (!back) { r(c, -3, top + 1, 3, 1, H[3]); r(c, -4, top + 2, 2, 1, H[3]); px(c, -5, top + 3, H[3]); }
  else { r(c, -2, top + 1, 4, 1, H[3]); }
  r(c, 4, top + 2, 2, F - top - 2, H[1]);
}

function fringeFront(c, L, F, top) {
  const { H, hair, K } = L;
  const row = (dy, xs, col = H[2]) => { for (const [a, b] of xs) r(c, a, F + dy, b - a + 1, 1, col); };
  switch (hair.fringe) {
    case 'crop': row(0, [[-4, 3]]); for (const x of [-4, -2, 0, 2]) px(c, x, F + 1, H[1]); break;
    case 'part': row(0, [[-4, -2], [0, 3]]); px(c, -1, F, K[2]); px(c, -1, F - 1, K[1]); row(1, [[-4, -3], [2, 3]]); break;
    case 'side': row(0, [[-4, 3]]); row(1, [[-4, 1]]); row(2, [[-4, -2]], H[1]); px(c, 2, F + 1, H[1]); break;
    case 'swept':
      row(0, [[-4, 3]]); px(c, -4, F + 1, H[1]); px(c, -1, F + 1, H[2]); px(c, 2, F + 1, H[1]);
      for (const [x, h, lean] of [[-4, 3, 1], [-1, 4, 2], [2, 4, 2], [4, 3, 2]]) spike(c, H, x, top + 1, h, lean);
      break;
    case 'emo':
      row(0, [[-4, 3]]); row(1, [[-2, 3]]); row(2, [[-1, 3]]); row(3, [[0, 3]]); row(4, [[1, 3]]); row(5, [[2, 3]], H[1]);
      r(c, 0, F + 1, 1, 3, H[3]);
      break;
    case 'spiky': row(0, [[-4, 3]]); for (const x of [-4, -2, 0, 2]) px(c, x, F + 1, H[2]); px(c, -3, F + 2, H[1]); px(c, 1, F + 2, H[1]); break;
    case 'curls': row(0, [[-4, 3]]); for (const x of [-4, -3, -1, 1, 2]) px(c, x, F + 1, H[2]); px(c, -3, F + 2, H[1]); px(c, 2, F + 2, H[1]); break;
    case 'quiff': row(0, [[-4, 3]], H[1]); r(c, -3, top - 2, 7, 2, H[2]); r(c, -1, top - 3, 5, 1, H[2]); r(c, -2, top - 2, 3, 1, H[3]); break;
    case 'undercut': row(0, [[-2, 3]]); row(1, [[0, 3]]); row(2, [[2, 3]], H[1]); break;
    case 'slick': row(0, [[-4, 3]], H[1]); for (let y = top + 2; y < F; y += 2) r(c, -4, y, 6, 1, H[3]); break;
    case 'pixie': row(0, [[-4, 3]]); for (const x of [-4, -3, -1, 0]) px(c, x, F + 1, H[2]); px(c, -4, F + 2, H[1]); px(c, -2, F + 2, H[1]); break;
    case 'full': row(0, [[-4, 3]]); row(1, [[-4, 3]]); row(2, [[-4, -3], [2, 3]], H[1]); px(c, -1, F + 2, H[1]); break;
    case 'none': row(0, [[-4, 3]], H[1]); break;
  }
}

function hairFront(c, L, F, back) {
  const { H, hair, K } = L;
  const top = F - 3 - hair.vol;
  if (hair.fringe === 'bald') {
    r(c, -3, F - 2, 6, 1, K[2]); r(c, -4, F - 1, 8, 1, K[2]); r(c, -3, F - 2, 2, 1, K[3]);
    r(c, -5, F + 1, 1, 3, H[1]); r(c, 4, F + 1, 1, 3, H[1]);
    if (back) r(c, -4, F + 1, 8, 3, H[1]);
    return;
  }
  if (hair.extra === 'mohawk') {
    r(c, -3, F - 2, 6, 1, K[2]); r(c, -4, F - 1, 8, 1, K[2]);
    for (let x = -4; x <= 3; x += 2) px(c, x, F - 1, H[0]);
    r(c, -1, top - 3, 2, F - top + 3, H[2]); px(c, -1, top - 3, H[3]); r(c, 0, top - 2, 1, F - top + 1, H[1]);
    r(c, -5, F, 1, 3, H[1]); r(c, 4, F, 1, 3, H[0]);
    return;
  }
  const bottom = hairBottom(F, hair.len);
  // long hair falls behind the shoulders (drawn first so the cap covers its top)
  if (hair.len > 0) {
    const w = hair.len >= 2 ? 7 : 6;
    r(c, -w, F, 2, bottom - F, H[2]); r(c, w - 2, F, 2, bottom - F, H[1]);
    if (hair.len >= 2) { r(c, -w - 1 + 1, F + 4, 1, bottom - F - 4, H[1]); r(c, w - 1, F + 4, 1, bottom - F - 4, H[0]); }
    px(c, -w, bottom - 1, H[1]); px(c, w - 1, bottom - 1, H[0]);
    if (back) { r(c, -w, F, w * 2, bottom - F, H[2]); strands(c, H, -w + 1, w - 2, F, bottom, 3); }
  }
  if (back && hair.len === 0) {
    r(c, -5, F, 10, 6, H[2]); strands(c, H, -4, 3, F, F + 6, 4); r(c, -5, F + 5, 10, 1, H[1]);
  }
  capFront(c, L, F, top, back);
  if (!back) fringeFront(c, L, F, top);
  extras(c, L, F, back ? 1 : 0, top);
}

function hairSide(c, L, F) {
  const { H, hair, K } = L;
  const top = F - 3 - hair.vol;
  if (hair.fringe === 'bald') { r(c, -3, F - 2, 6, 1, K[2]); r(c, -4, F - 1, 8, 1, K[2]); r(c, -4, F + 1, 3, 3, H[1]); return; }
  if (hair.extra === 'mohawk') {
    r(c, -3, F - 2, 6, 1, K[2]); r(c, -4, F - 1, 8, 1, K[2]);
    r(c, -4, top - 2, 7, 3, H[2]); r(c, -3, top - 3, 5, 1, H[2]); r(c, -2, top + 1, 4, F - top - 1, H[2]); px(c, -1, top - 2, H[3]);
    r(c, -4, F, 3, 4, H[0]);
    return;
  }
  const fade = hair.sides === 'fade';
  const bottom = hairBottom(F, hair.len);
  // back of the head, then the long part
  if (hair.len > 0) { r(c, -6, F, 6, bottom - F, H[2]); r(c, -6, F, 1, bottom - F, H[1]); strands(c, H, -5, -1, F, bottom, 5); r(c, -6, bottom - 1, 6, 1, H[1]); }
  // crown
  r(c, -3, top, 6, 1, H[2]);
  r(c, -5, top + 1, 9, 1, H[2]);
  r(c, -6, top + 2, 11, F - top - 2, H[2]);
  r(c, -6, F, 7, 3, fade ? H[1] : H[2]);                       // temple + sideburn
  r(c, -6, F + 3, 4, 4, fade ? H[1] : H[2]);                   // back of the head
  if (!fade) r(c, -6, F + 6, 3, 1, H[1]);
  strands(c, H, -5, 3, top + 1, F + 2, 6);
  r(c, -2, top + 1, 4, 1, H[3]); r(c, -1, top + 2, 3, 1, H[3]);
  // fringe at the front
  const f = hair.fringe;
  if (f === 'crop' || f === 'spiky' || f === 'curls') { r(c, 1, F, 4, 1, H[2]); px(c, 2, F + 1, H[1]); px(c, 4, F + 1, H[2]); }
  else if (f === 'side' || f === 'full' || f === 'pixie') { r(c, 1, F, 4, 2, H[2]); px(c, 3, F + 2, H[1]); }
  else if (f === 'part') r(c, 1, F, 3, 1, H[2]);
  else if (f === 'emo') { r(c, 1, F, 4, 3, H[2]); r(c, 2, F + 3, 3, 1, H[1]); px(c, 4, F + 4, H[1]); }
  else if (f === 'swept') { r(c, 1, F, 4, 1, H[2]); for (const [x, h, lean] of [[-4, 3, -2], [-1, 4, -2], [2, 4, -1]]) spike(c, H, x, top + 1, h, lean); }
  else if (f === 'quiff') { r(c, -2, top - 2, 7, 2, H[2]); r(c, 0, top - 3, 5, 1, H[2]); px(c, 5, top - 1, H[1]); }
  else if (f === 'undercut') { r(c, 0, F, 5, 1, H[2]); r(c, 2, F + 1, 3, 1, H[1]); }
  extras(c, L, F, 3, top);
}

function extras(c, L, F, dir, top) {
  const { H, hair } = L;
  const e = hair.extra;
  if (e === 'bun') {
    const x = dir === 3 ? -5 : -2;
    r(c, x, top - 3, 4, 3, H[2]); r(c, x + 1, top - 4, 2, 1, H[2]); px(c, x + 1, top - 3, H[3]); r(c, x + 3, top - 2, 1, 2, H[1]);
  } else if (e === 'manbun') {
    if (dir === 3) { r(c, -7, top + 1, 2, 3, H[2]); px(c, -7, top + 1, H[3]); }
    else r(c, -1, top - 2, 2, 2, H[dir === 1 ? 2 : 1]);
  } else if (e === 'pony') {
    if (dir === 1) { r(c, -1, F + 1, 2, 9, H[2]); px(c, -1, F + 1, H[3]); r(c, -1, F, 2, 1, '#e0457b'); r(c, -1, F + 9, 2, 1, H[1]); }
    else if (dir === 3) { r(c, -8, F - 1, 2, 8, H[2]); r(c, -8, F + 6, 2, 1, H[1]); px(c, -6, F - 1, '#e0457b'); }
    else r(c, 6, F + 1, 1, 4, H[1]);
  } else if (e === 'pigtails') {
    const tail = (x) => { r(c, x, F + 2, 2, 7, H[2]); px(c, x, F + 2, H[3]); r(c, x, F + 8, 2, 1, H[1]); r(c, x, F + 1, 2, 1, '#e0457b'); };
    if (dir === 3) tail(-8); else { tail(-8); tail(6); }
  } else if (e === 'curly') {
    for (const x of [-4, -1, 2]) px(c, x, top - 1, H[2]);
    const bottom = hair.len === 0 ? F + 3 : hairBottom(F, hair.len);
    for (let yy = top + 3; yy < bottom; yy += 2) { px(c, dir === 3 ? -7 : -7, yy, H[1]); if (dir !== 3) px(c, 6, yy, H[0]); }
  } else if (e === 'spikes') {
    const set = dir === 3
      ? [[-5, 4, -3], [-2, 6, -2], [1, 5, 0], [3, 3, 1]]
      : [[-5, 5, -3], [-2, 7, -1], [1, 7, 1], [4, 5, 3]];
    for (const [x, h, lean] of set) spike(c, H, x, top + 2, h, lean);
  }
}

// ---------- accessories ----------
function faceAcc(c, L, F, dir) {
  const a = L.acc;
  if (!a.kind || dir === 1) {
    if (dir === 1 && a.kind === 'bandana') r(c, -3, F + 9, 6, 2, ramp(a.color)[1]);
    return;
  }
  const front = dir === 0;
  const col = a.color;
  switch (a.kind) {
    case 'glasses': case 'round':
      if (front) {
        for (const x0 of [-4, 0]) {
          r(c, x0, F + 3, 4, 1, col); px(c, x0, F + 4, col); px(c, x0 + 3, F + 4, col);
          if (a.kind === 'round') r(c, x0 + 1, F + 5, 2, 1, col); else r(c, x0, F + 5, 4, 1, col);
        }
        px(c, -2, F + 4, mix(L.E[1], '#ffffff', 0.3)); px(c, 1, F + 4, mix(L.E[1], '#ffffff', 0.3));
      } else { r(c, 0, F + 3, 4, 1, col); px(c, 3, F + 4, col); r(c, 0, F + 5, 4, 1, col); r(c, -2, F + 3, 2, 1, col); }
      break;
    case 'shades':
      if (front) { r(c, -4, F + 3, 8, 1, col); r(c, -4, F + 4, 3, 2, col); r(c, 1, F + 4, 3, 2, col); px(c, -3, F + 4, '#6a7a8a'); px(c, 2, F + 4, '#6a7a8a'); }
      else { r(c, 0, F + 3, 4, 3, col); r(c, -2, F + 3, 2, 1, col); px(c, 2, F + 4, '#6a7a8a'); }
      break;
    case 'beard': {
      const H = L.H;
      if (front) { r(c, -4, F + 4, 1, 4, H[2]); r(c, 3, F + 4, 1, 4, H[1]); r(c, -4, F + 6, 8, 3, H[2]); r(c, -3, F + 9, 6, 1, H[1]); r(c, -2, F + 6, 4, 1, H[1]); px(c, -1, F + 7, '#7a3a2a'); px(c, 0, F + 7, '#7a3a2a'); px(c, -3, F + 7, H[3]); }
      else { r(c, -1, F + 4, 1, 3, H[2]); r(c, -1, F + 6, 5, 3, H[2]); r(c, 0, F + 9, 3, 1, H[1]); px(c, 2, F + 7, '#7a3a2a'); }
      break;
    }
    case 'moustache':
      if (front) { r(c, -2, F + 6, 4, 1, L.H[2]); px(c, -2, F + 7, L.H[1]); px(c, 1, F + 7, L.H[1]); px(c, -1, F + 6, L.H[3]); }
      else { r(c, 2, F + 6, 3, 1, L.H[2]); px(c, 2, F + 7, L.H[1]); }
      break;
    case 'stubble':
      for (const [x, yy] of front ? [[-4, 6], [-3, 7], [-2, 8], [1, 8], [2, 7], [3, 6], [-3, 5], [2, 5]] : [[0, 6], [1, 8], [2, 8], [0, 8]]) px(c, x, F + yy, mix(L.K[2], L.H[1], 0.4));
      break;
    case 'freckles':
      for (const [x, yy] of front ? [[-3, 6], [-2, 6], [1, 6], [2, 6]] : [[1, 6], [2, 6]]) px(c, x, F + yy, L.K[0]);
      break;
    case 'blush':
      if (front) { r(c, -4, F + 6, 2, 1, '#f08a8a'); r(c, 2, F + 6, 2, 1, '#f08a8a'); } else r(c, 0, F + 6, 2, 1, '#f08a8a');
      break;
    case 'earrings':
      if (front) { px(c, -5, F + 5, col); px(c, 4, F + 5, col); } else px(c, -2, F + 5, col);
      break;
    case 'patch':
      if (front) { r(c, -4, F + 3, 3, 3, col); for (let i = 0; i < 7; i++) px(c, -1 + i, F + 3 - (i >> 1), col); }
      else r(c, -5, F + 2, 9, 1, col);
      break;
    case 'bandana': {
      const B = ramp(col);
      r(c, -3, F + 9, 6, 2, B[2]); r(c, -2, F + 11, 4, 1, B[2]); px(c, -1, F + 12, B[1]); px(c, -2, F + 10, B[3]);
      break;
    }
  }
}

function hatAcc(c, L, F, dir) {
  const a = L.acc;
  const top = F - 3 - L.hair.vol;
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
      { const x = side ? 1 : 3; r(c, x, F - 3, 3, 3, a.color); px(c, x + 1, F - 2, '#f1c40f'); px(c, x, F - 3, '#ffffff'); }
      break;
    case 'cap': {
      const C = ramp(a.color);
      r(c, -6, F - 5, 12, 5, C[2]); r(c, -5, F - 6, 10, 1, C[2]); r(c, -4, F - 6, 3, 1, C[3]); r(c, 4, F - 5, 2, 5, C[1]);
      px(c, -1, F - 7, C[1]);
      if (dir === 0) { r(c, -7, F - 1, 14, 1, C[1]); r(c, -6, F, 12, 1, C[0]); r(c, -1, F - 4, 2, 2, '#f2efe6'); }
      else if (side) { r(c, -6, F - 1, 13, 1, C[1]); r(c, 3, F, 4, 1, C[0]); }
      else r(c, -6, F - 1, 12, 1, C[1]);
      break;
    }
    case 'sunhat': {
      const C = ramp(a.color);
      const bw = side ? 18 : 20;
      r(c, -bw / 2, F - 2, bw, 2, C[2]); r(c, -bw / 2, F - 2, bw, 1, C[3]); r(c, -bw / 2, F - 1, bw, 1, C[1]);
      r(c, -5, F - 7, 10, 5, C[2]); r(c, -4, F - 8, 8, 1, C[2]); r(c, -5, F - 7, 2, 5, C[3]); r(c, 3, F - 7, 2, 5, C[1]);
      r(c, -5, F - 3, 10, 1, '#c0392b');
      for (let x = -4; x < 4; x += 2) px(c, x, F - 6, C[1]);
      break;
    }
    case 'beanie': {
      const C = ramp(a.color);
      r(c, -6, F - 6, 12, 7, C[2]); r(c, -5, F - 7, 10, 1, C[2]); r(c, -5, F - 6, 3, 2, C[3]);
      r(c, -6, F - 1, 12, 2, C[1]); for (let x = -6; x < 6; x += 2) px(c, x, F - 1, C[0]);
      r(c, -1, F - 9, 2, 2, '#f2efe6');
      break;
    }
    case 'headband':
      r(c, -6, F - 1, side ? 11 : 12, 1, a.color); if (side) px(c, -6, F, a.color);
      break;
    case 'patch':
      if (dir === 1) r(c, -6, F + 2, 12, 1, a.color);
      break;
  }
}

// ---------- whole person ----------
function paint(c, L, dir, frame, pose = null, arms = null, f = 0) {
  const side = dir === 2 || dir === 3;
  if (dir === 2) { c.scale(-1, 1); dir = 3; }
  const sit = pose === 'sit';
  if (sit) frame = 0;
  if (sit && !arms) arms = 'lap';
  const bob = frame % 2 ? -1 : 0;
  const drop = sit ? SIT_DROP : 0;
  const y0 = -18 + bob + drop;       // torso top
  const F = -28 + bob + drop;        // face top
  if (sit) legsSitting(c, L, dir); else legs(c, L, dir, frame);
  if (side) {
    // far arm behind the body, near arm in front
    const H = handSide(arms, y0, F, f, frame);
    arm(c, L, -0.5, y0 + 1.5, H.h[0] - 1 - (arms ? 0 : SWAY[frame] * 4), H.h[1], 1, true);
    skirt(c, L, y0, true);
    torsoSide(c, L, y0, frame);
    arm(c, L, 0.5, y0 + 1.5, H.h[0], H.h[1], 1);
    if (H.prop) prop(c, H.prop[0], H.prop[1], H.prop[2], f);
    face(c, L, F, 3);
    brows(c, L, F, 3);
    faceAcc(c, L, F, 3);
    hairSide(c, L, F);
    ears(c, L, F, 3);
  } else {
    if (dir === 1) armsFront(c, L, y0, F, frame, arms, f, true);
    skirt(c, L, y0, false);
    torsoFront(c, L, y0, dir === 1);
    if (dir === 0) armsFront(c, L, y0, F, frame, arms, f, false);
    face(c, L, F, dir);
    if (dir === 0) brows(c, L, F, 0);
    faceAcc(c, L, F, dir);
    hairFront(c, L, F, dir === 1);
    ears(c, L, F, dir);
  }
  hatAcc(c, L, F, dir);
}

const resolved = new Map();
function resolveCached(look) {
  const k = lookKey(look);
  let L = resolved.get(k);
  if (!L) { L = resolve(look); resolved.set(k, L); }
  return { k, L };
}

// Sprite for a (sanitized) look, facing dir, walk frame 0..3. pose 'sit' draws them
// seated (feet still at row 0, so it stands on the floor in front of the seat).
// arms: what the hands are doing ('eat', 'read', 'type', 'wave'… see handsFront), with
// animation frame f 0..3.
export function personSprite(look, dir, frame, pose = null, arms = null, f = 0) {
  const { k, L } = resolveCached(look);
  if (!arms) f = 0;
  return bake(`pp|${k}|${dir}|${frame}|${pose || ''}|${arms || ''}|${f}`, 12, 40, 24, 42, (cc) => paint(cc, L, dir, frame, pose, arms, f));
}

// Someone asleep in bed, seen from straight above: their head on the pillow (eyes
// shut) and the shape of their body under the quilt. 16 × 32 px = one bed (1 × 2 tiles),
// head end at the top (the bed's headboard side). Laid flat on the mattress.
// f animates it: 0/1 breathe (the quilt rises and falls), 2/3 the same rolled over to
// face the other way.
export function sleeperSprite(look, quilt = '#4d79c7', f = 0) {
  const { k, L } = resolveCached(look);
  const id = `sleep|${k}|${quilt}|${f}`;
  let cv = sleepCache.get(id);
  if (cv) return { cv };
  cv = document.createElement('canvas');
  cv.width = 16; cv.height = 32;
  const c = cv.getContext('2d');
  if (f >= 2) { c.translate(16, 0); c.scale(-1, 1); }
  const H = L.H, K = L.K, br = f % 2;
  const q = quilt, qd = shade(quilt, -0.22), ql = shade(quilt, 0.18);
  sleepHead(c, L, 3);
  // quilt pulled up to the chin, with the body's bump (rising as they breathe) and feet
  r(c, 1, 11, 14, 20, q); r(c, 1, 11, 14, 2, ql); r(c, 1, 11, 1, 20, qd); r(c, 14, 11, 1, 20, qd);
  r(c, 4 - br, 13, 8 + br * 2, 16, ql); r(c, 4 - br, 13, 1, 16, q); r(c, 11 + br, 13, 1, 16, qd);
  r(c, 5, 15 + br, 6, 1, shade(ql, 0.12));                               // light on the chest
  r(c, 5, 26, 2, 3, qd); r(c, 9, 26, 2, 3, qd);                           // feet
  r(c, 1, 30, 14, 1, qd);
  r(c, 11, 15 - br, 2, 2, K[2]);                                          // a hand on the quilt
  sleepCache.set(id, cv);
  return { cv };
}
// A sleeping face from above (eyes shut), hair round it; head top at row y.
function sleepHead(c, L, y) {
  const H = L.H, K = L.K;
  r(c, 4, y, 8, 8, H[2]); r(c, 4, y, 8, 2, H[3]); r(c, 3, y + 1, 1, 6, H[1]); r(c, 12, y + 1, 1, 6, H[1]);
  r(c, 5, y + 3, 6, 5, K[2]); r(c, 5, y + 7, 6, 1, K[1]);
  r(c, 6, y + 5, 1, 1, '#2a1a12'); r(c, 9, y + 5, 1, 1, '#2a1a12');     // closed eyes
  r(c, 7, y + 7, 2, 1, shade(K[1], -0.15));
  r(c, 5, y + 2, 6, 1, H[2]);                                             // fringe
}
// Lying on a sofa (or a hammock) for a nap, seen from above in their own clothes: head on
// the armrest at the top, hands folded on the belly, legs out straight, shoes at the far
// end. 16 × 32 px; f 0..3 breathes (the chest rises on 1 and 3).
export function lyingSprite(look, f = 0) {
  const { k, L } = resolveCached(look);
  const id = `lie|${k}|${f}`;
  let cv = sleepCache.get(id);
  if (cv) return { cv };
  cv = document.createElement('canvas');
  cv.width = 16; cv.height = 32;
  const c = cv.getContext('2d');
  const S = L.S, B = L.B, K = L.K, P = L.P, br = f % 2;
  const dress = L.shirt.kind === 'dress', sl = sleeveColor(L) || S;
  // legs and shoes first (feet towards the bottom)
  const legC = dress ? K : P;
  r(c, 5, 20, 3, 9, legC[2]); r(c, 8, 20, 3, 9, legC[1]); r(c, 5, 20, 1, 9, legC[3]); r(c, 7, 22, 2, 6, legC[0]);
  r(c, 4, 29, 4, 2, SHOE[1]); r(c, 8, 29, 4, 2, SHOE[1]); r(c, 4, 29, 4, 1, SHOE[2]); r(c, 8, 29, 4, 1, SHOE[2]);
  if (dress) { r(c, 4, 19, 8, 5, S[2]); r(c, 4, 23, 8, 1, S[1]); }
  // torso (a touch wider when breathing in), with the shirt's own trim
  r(c, 4 - br, 11, 8 + br * 2, 10, S[2]); r(c, 4 - br, 11, 1, 10, S[3]); r(c, 11 + br, 11, 1, 10, S[1]); r(c, 4, 20, 8, 1, S[0]);
  if (L.shirt.kind === 'overalls' || L.shirt.kind === 'vest' || L.shirt.kind === 'apron') r(c, 6, 11, 4, 9, B[2]);
  if (L.shirt.kind === 'stripes') for (let j = 12; j < 20; j += 2) r(c, 4, j, 8, 1, B[2]);
  // arms along the sides, hands folded on the belly
  r(c, 2 - br, 11, 2, 6, sl[1]); r(c, 12 + br, 11, 2, 6, sl[1]);
  r(c, 3 - br, 16, 3, 2, sl === S ? sl[2] : K[1]); r(c, 10 + br, 16, 3, 2, sl === S ? sl[2] : K[1]);
  r(c, 6, 16 - br, 4, 2, K[2]); px(c, 7, 17 - br, K[1]);
  // neck and head on the armrest
  r(c, 7, 10, 2, 1, K[1]);
  sleepHead(c, L, 2);
  sleepCache.set(id, cv);
  return { cv };
}
const sleepCache = new Map();
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)));
  return '#' + [n >> 16, (n >> 8) & 255, n & 255].map((v) => ch(v).toString(16).padStart(2, '0')).join('');
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

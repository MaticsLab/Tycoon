// Fences: built along the grid lines like walls (the same drag tool and pole cursor), one
// segment per tile edge. Each model is one segment as a box list (see models-extra.js),
// running along x from 0 to 1 on the line z = 0.5, with a post at each end. Gates are
// fence segments you can walk through. Pure data: the catalog icons are drawn from these.
const C = 0.5; // the fence line

const post = (x, w, h, col, cap) => [
  [x - w / 2, 0, C - w / 2, w, h, w, col],
  ...(cap ? [[x - w / 2 - 0.02, h, C - w / 2 - 0.02, w + 0.04, 0.05, w + 0.04, cap]] : []),
];
const rail = (y, h, d, col, x0 = 0, x1 = 1) => [[x0, y, C - d / 2, x1 - x0, h, d, col]];

function picket(white = '#f4f6f7', shade = '#d9dee2', gate = false) {
  const out = [...post(0, 0.1, 0.95, shade, white), ...post(1, 0.1, 0.95, shade, white)];
  out.push(...rail(0.22, 0.06, 0.04, shade, 0.05, 0.95), ...rail(0.62, 0.06, 0.04, shade, 0.05, 0.95));
  for (let i = 0; i < 6; i++) {
    const x = 0.1 + i * 0.145;
    out.push([x, 0.04, C + 0.02, 0.08, 0.78, 0.035, white], [x + 0.015, 0.82, C + 0.02, 0.05, 0.04, 0.035, white]);
  }
  if (gate) out.push([0.12, 0.3, C + 0.055, 0.76, 0.05, 0.02, shade], [0.5, 0.3, C + 0.06, 0.04, 0.42, 0.02, shade], [0.82, 0.45, C + 0.07, 0.05, 0.05, 0.03, '#c9a24c']);
  return out;
}

export const FENCE_MODELS = {
  fence_picket: () => picket(),
  fence_gate: () => picket('#f4f6f7', '#d9dee2', true),
  // Split-rail ranch fence.
  fence_ranch: () => {
    const W = '#a8703f', D = '#6b4424', L = '#c99363';
    return [...post(0, 0.12, 0.9, D, L), ...post(1, 0.12, 0.9, D, L),
      ...rail(0.25, 0.08, 0.07, W, 0.04, 0.96), ...rail(0.58, 0.08, 0.07, W, 0.04, 0.96),
      [0.2, 0.3, C + 0.036, 0.3, 0.012, 0.004, D], [0.55, 0.63, C + 0.036, 0.25, 0.012, 0.004, D]];
  },
  // Wrought iron with spear tips.
  fence_iron: () => {
    const I = '#23262b', L = '#3a3f47', G = '#c9a24c';
    const out = [...post(0, 0.1, 1.15, I, L), ...post(1, 0.1, 1.15, I, L), [-0.03, 1.2, C - 0.03, 0.06, 0.06, 0.06, G], [0.97, 1.2, C - 0.03, 0.06, 0.06, 0.06, G],
      ...rail(0.12, 0.04, 0.04, I), ...rail(0.86, 0.04, 0.04, I)];
    for (let i = 0; i < 8; i++) {
      const x = 0.08 + i * 0.115;
      out.push([x, 0.08, C - 0.015, 0.03, 0.94, 0.03, I], [x - 0.008, 1.0, C - 0.02, 0.046, 0.04, 0.04, L], [x + 0.004, 1.04, C - 0.01, 0.022, 0.04, 0.02, I]);
    }
    out.push([0.3, 0.2, C - 0.02, 0.4, 0.03, 0.04, L], [0.42, 0.24, C - 0.02, 0.16, 0.08, 0.04, L]);
    return out;
  },
  fence_irongate: () => {
    const out = FENCE_MODELS.fence_iron();
    out.push([0.08, 0.5, C - 0.03, 0.84, 0.04, 0.06, '#3a3f47'], [0.44, 0.5, C - 0.035, 0.12, 0.12, 0.07, '#c9a24c']);
    return out;
  },
  // A low dry-stone wall with a capstone.
  fence_stone: () => {
    const S = ['#9a9384', '#a8a191', '#8d8778'], L = '#b6af9f', M = '#7d776b';
    const out = [[-0.05, 0, C - 0.17, 1.1, 0.6, 0.34, S[0]], [-0.07, 0.6, C - 0.2, 1.14, 0.08, 0.4, L]];
    for (const [x, y, w] of [[0, 0.06, 0.3], [0.34, 0.06, 0.36], [0.74, 0.06, 0.24], [0.08, 0.32, 0.34], [0.46, 0.32, 0.3], [0.8, 0.32, 0.18]]) {
      out.push([x, y, C + 0.17, w, 0.22, 0.008, S[Math.round(x * 10) % 3]], [x, y, C - 0.178, w, 0.22, 0.008, S[(Math.round(x * 10) + 1) % 3]]);
    }
    out.push([0, 0.3, C + 0.172, 1, 0.012, 0.008, M], [0, 0.3, C - 0.18, 1, 0.012, 0.008, M], [0.12, 0.68, C - 0.08, 0.14, 0.02, 0.1, '#5aa842']);
    return out;
  },
  // A clipped box hedge.
  fence_hedge: () => {
    const G = '#3f8a35', GL = '#5aa842', GD = '#2c6b28';
    return [[-0.04, 0, C - 0.22, 1.08, 0.95, 0.44, G], [-0.02, 0.95, C - 0.2, 1.04, 0.06, 0.4, GL],
      [0.1, 0.2, C + 0.22, 0.2, 0.18, 0.02, GL], [0.55, 0.5, C + 0.22, 0.24, 0.2, 0.02, GL], [0.3, 0.7, C - 0.24, 0.2, 0.16, 0.02, GL],
      [0.7, 0.15, C - 0.24, 0.18, 0.2, 0.02, GD], [-0.04, 0, C - 0.23, 1.08, 0.08, 0.46, GD]];
  },
  // Painted porch railing with chunky posts and a handrail (the porch look).
  fence_porch: () => {
    const P = '#9db8d6', PL = '#c3d6ea', CAP = '#e8b860';
    const out = [...post(0, 0.14, 1.05, P, CAP), ...post(1, 0.14, 1.05, P, CAP), ...rail(0.9, 0.07, 0.1, PL, 0.07, 0.93), ...rail(0.1, 0.05, 0.07, P, 0.07, 0.93)];
    for (let i = 0; i < 7; i++) out.push([0.13 + i * 0.11, 0.15, C - 0.02, 0.04, 0.75, 0.04, PL]);
    return out;
  },
  // Woven willow hurdle.
  fence_wattle: () => {
    const W = ['#a88a5a', '#8a6e42', '#b89a68'], S = '#6b4424';
    const out = [...post(0, 0.07, 0.95, S), ...post(1, 0.07, 0.95, S), ...post(0.5, 0.06, 0.9, S)];
    for (let k = 0; k < 9; k++) out.push([0.02, 0.06 + k * 0.095, C - 0.035 + (k % 2) * 0.03, 0.96, 0.08, 0.04, W[k % 3]]);
    return out;
  },
};

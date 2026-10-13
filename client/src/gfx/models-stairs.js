// Staircases, as box lists like the other furniture models (see models-extra.js for the
// format). Every staircase is 1x3 and climbs one floor (LEVEL_H) away from its front
// (south, +z) in 12 steps. Pure data: the catalog icons are drawn from these too.
import { LEVEL_H } from '@shared/plot.js';

const WOOD = '#a8703f', WOOD_D = '#6b4424', WOOD_L = '#c99363';
const N = 12, RUN = 3 / N, RISE = LEVEL_H / N;
// Step i (0 = bottom): its front edge z, its top height.
const step = (i) => ({ z: 3 - (i + 1) * RUN, top: (i + 1) * RISE });
// A sloped beam from the bottom front to the top back, as a staircase of short boxes.
function slope(x, w, depth, col, under = 0.1) {
  const out = [];
  for (let i = 0; i < N; i++) {
    const { z, top } = step(i);
    out.push([x, Math.max(0, top - depth - under), z, w, depth, RUN, col]);
  }
  return out;
}
// A banister: handrail along the slope with a spindle on every step.
function banister(x, rail, spindle, h = 0.8) {
  const out = [];
  for (let i = 0; i < N; i++) {
    const { z, top } = step(i);
    out.push([x, top + h, z - 0.01, 0.08, 0.07, RUN + 0.02, rail], [x + 0.02, top, z + RUN / 2 - 0.02, 0.04, h, 0.04, spindle]);
  }
  return out;
}

export const STAIR_MODELS = {
  // Classic oak: solid steps, side stringers, white spindles and chunky newel posts.
  stairs: () => {
    const out = [];
    for (let i = 0; i < N; i++) {
      const { z, top } = step(i);
      out.push([0.1, 0, z, 0.8, top - 0.04, RUN, WOOD]);
      out.push([0.08, top - 0.05, z - 0.02, 0.84, 0.05, RUN + 0.02, i % 2 ? WOOD_L : '#d6a26d']);
      out.push([0, 0, z, 0.1, top + 0.08, RUN, WOOD_D], [0.9, 0, z, 0.1, top + 0.08, RUN, WOOD_D]);
    }
    out.push(...banister(0.01, WOOD_L, '#e8dcc4'), ...banister(0.91, WOOD_L, '#e8dcc4'));
    for (const x of [0, 0.9]) {
      out.push([x, 0, 2.86, 0.1, RISE + 1.0, 0.1, WOOD_D], [x - 0.01, RISE + 1.0, 2.85, 0.12, 0.06, 0.12, WOOD_L]);
      out.push([x, LEVEL_H - 0.1, 0, 0.1, 1.0, 0.1, WOOD_D]);
    }
    return out;
  },
  // Box stairs: closed, painted side panels, pale treads with a cream nosing.
  stairs_box: () => {
    const P = '#e8875f', PL = '#f2a07c', T = '#b9b6d8', TL = '#d4d2ec', NOSE = '#f4ecd8';
    const out = [];
    for (let i = 0; i < N; i++) {
      const { z, top } = step(i);
      out.push([0.06, 0, z, 0.88, top - 0.05, RUN, T], [0.06, top - 0.05, z - 0.015, 0.88, 0.05, RUN + 0.015, TL], [0.06, top - 0.05, z + RUN - 0.03, 0.88, 0.03, 0.03, NOSE]);
      // the side panels rise with the steps, a little above them
      out.push([0, 0, z, 0.06, top + 0.12, RUN, P], [0.94, 0, z, 0.06, top + 0.12, RUN, P]);
      out.push([-0.005, top + 0.08, z, 0.07, 0.04, RUN, PL], [0.935, top + 0.08, z, 0.07, 0.04, RUN, PL]);
    }
    return out;
  },
  // Runner stairs: dark treads over red risers, open sawtooth stringers.
  stairs_runner: () => {
    const T = '#3a3d44', TL = '#4c5058', R = '#c0392b', RD = '#962d22', S = '#e3cfa8', SD = '#c9b08a';
    const out = [];
    for (let i = 0; i < N; i++) {
      const { z, top } = step(i);
      out.push([0.08, top - RISE, z + RUN - 0.03, 0.84, RISE - 0.04, 0.03, R], [0.08, top - RISE + 0.02, z + RUN - 0.035, 0.84, 0.03, 0.006, RD]);
      out.push([0.06, top - 0.05, z, 0.88, 0.05, RUN + 0.01, T], [0.06, top - 0.01, z + RUN - 0.04, 0.88, 0.012, 0.04, TL]);
      // sawtooth stringers under each side
      out.push([0, Math.max(0, top - 0.42), z, 0.08, Math.min(top, 0.42), RUN, S], [0.92, Math.max(0, top - 0.42), z, 0.08, Math.min(top, 0.42), RUN, S]);
      out.push([0.08, Math.max(0, top - 0.42), z + 0.02, 0.006, Math.min(top, 0.36), RUN - 0.04, SD]);
    }
    out.push(...banister(0.0, '#2f3542', '#2f3542', 0.85));
    return out;
  },
  // Floating stairs: thick painted treads on one steel spine, nothing between them.
  stairs_float: () => {
    const T = '#1f7a55', TL = '#2a9a6c', TD = '#16603f', STEEL = '#5a626e';
    const out = [];
    for (let i = 0; i < N; i++) {
      const { z, top } = step(i);
      out.push([0.04, top - 0.09, z + 0.01, 0.92, 0.09, RUN - 0.03, T], [0.04, top - 0.01, z + 0.01, 0.92, 0.01, RUN - 0.03, TL], [0.04, top - 0.09, z + RUN - 0.025, 0.92, 0.012, 0.006, TD]);
      out.push([0.38, top - 0.09, z + RUN * 0.3, 0.24, 0.04, RUN * 0.5, STEEL]); // bracket
    }
    out.push(...slope(0.44, 0.12, 0.14, STEEL, 0.12));
    return out;
  },
  // Stone steps: chunky blocks with mortar lines and a little moss.
  stairs_stone: () => {
    const S = ['#9a9384', '#a8a191', '#8d8778'], SL = '#b6af9f', M = '#7d776b';
    const out = [];
    for (let i = 0; i < N; i++) {
      const { z, top } = step(i);
      out.push([0.02, 0, z, 0.96, top, RUN, S[i % 3]], [0.02, top - 0.03, z - 0.01, 0.96, 0.03, RUN + 0.02, SL]);
      out.push([0.02 + ((i * 0.37) % 0.6) + 0.15, top - RISE + 0.02, z + RUN, 0.012, RISE - 0.04, 0.004, M]);
      out.push([0.02, top - RISE, z + RUN, 0.96, 0.012, 0.004, M]);
    }
    out.push([0.06, RISE, 2.72, 0.16, 0.02, 0.1, '#5aa842'], [0.8, RISE * 4, 1.98, 0.14, 0.02, 0.08, '#3f8a35']);
    // low stone cheek walls
    for (const x of [0, 0.88]) out.push(...slope(x, 0.12, 0.3, M, -0.3));
    return out;
  },
  // Iron stairs: black perforated treads, thin stringers and a simple rail.
  stairs_iron: () => {
    const I = '#2a2d33', IL = '#4a5058', DOT = '#15171b';
    const out = [];
    for (let i = 0; i < N; i++) {
      const { z, top } = step(i);
      out.push([0.08, top - 0.04, z + 0.01, 0.84, 0.04, RUN - 0.02, I], [0.08, top - 0.005, z + 0.01, 0.84, 0.006, 0.02, IL]);
      for (let k = 0; k < 4; k++) out.push([0.18 + k * 0.18, top - 0.004, z + RUN / 2 - 0.02, 0.06, 0.006, 0.04, DOT]);
    }
    out.push(...slope(0.02, 0.06, 0.18, I), ...slope(0.92, 0.06, 0.18, I));
    out.push(...banister(0.91, IL, I, 0.85));
    out.push([0.9, 0, 2.86, 0.1, RISE + 1.0, 0.1, I]);
    return out;
  },
};

// Catalog entries live in shared/catalog.js; these are their 3D looks.
export const STAIR_IDS = Object.keys(STAIR_MODELS);

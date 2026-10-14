// Weather, in the world: rain and storms fall as streaks through the 3D scene and splash
// in little rings where they hit the ground (or stop on the roofs), snow drifts down,
// settles on the ground and roofs and frosts the trees, then melts after it stops, and on
// summer nights fireflies float over the grass. Clouds dim and cool the scene's light
// instead of tinting the screen, and lightning lights the whole scene up for a moment.
// Leaves and petals drop from the actual trees around you (see makeTreeLeaves below).
// Everything lives in world coordinates around the camera, so it pans and zooms with the
// view and hides behind houses and trees like anything else.
import { QuadBatch } from './gfx/weather3d.js';
import { G } from './gfx/bjs.js';
import { MAP_W, MAP_H } from '@shared/world.js';
import { tileGround } from '@shared/landscape.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const hexRGB = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

// Per weather: drops per square tile of ground in view, fall speed (tiles/s), wind,
// how high they start, and how cloudy it is.
const KIND = {
  rain: { density: 0.65, vy: [12, 15], wind: [1.4, -0.9], top: 8, dim: 0.7 },
  storm: { density: 1.05, vy: [15, 19], wind: [5.5, -4], top: 8, dim: 1 },
  snow: { density: 0.5, vy: [0.8, 1.3], wind: [0.35, -0.2], top: 7, dim: 0.42 },
};
const RAIN = [0.78, 0.86, 1, 0.75], RAIN_TOP = [0.78, 0.86, 1, 0.08];

// opts: { view, world, onFlash() (thunder), roof(x, z): what covers tile (x, z): null
//   (open sky), { y } (a roof at height y: the rain stops on it) or { hidden: true } (a roof
//   cut away while you're inside: no rain falls in that room) }
export function makeWeather({ view, world, onFlash, roof = () => null } = {}) {
  const drops = new QuadBatch('drops', 1500, 'solid', { order: 7 });
  const rings = new QuadBatch('rings', 240, 'ring', { order: 6 });
  const flies = new QuadBatch('flies', 40, 'glow', { order: 8 });
  const parts = [], ripples = [], bugs = [];
  let dim = 0, cover = 0, amount = 0, flies01 = 0, mode = null, flashT = -1, last = 0;
  const W = world || view.world;

  // What a drop landing on (x, z) hits: sets p.floor / p.splash; false if nothing should
  // fall there (inside a house whose roof is cut away).
  const roofCache = new Map();
  let roofAt = 0;
  function land(p, x, z) {
    const tx = Math.floor(x), tz = Math.floor(z);
    if (tx < 0 || tz < 0 || tx >= MAP_W || tz >= MAP_H) { p.floor = 0; p.splash = false; return true; }
    const k = tz * MAP_W + tx;
    let r = roofCache.get(k);
    if (r === undefined) { r = roof(tx, tz) || 0; roofCache.set(k, r); }
    if (r && r.hidden) return false;
    if (r) { p.floor = r.y; p.splash = false; return true; }
    p.floor = tileGround(W, tx, tz); p.splash = true;
    return true;
  }

  // The patch of ground the camera sees, as offsets along its right and forward axes
  // (drops high up show further up the screen, so the patch reaches back toward the camera).
  const box = { A: 0, b0: 0, b1: 0, rx: 1, rz: 0, fx: 0, fz: -1, cot: 1 };
  function frame(top) {
    const s = Math.sin(view.pitch), c = Math.cos(view.pitch), g = view.ground();
    box.rx = g.rx; box.rz = g.rz; box.fx = g.fx; box.fz = g.fz; box.cot = c / s;
    box.A = view.halfW + 1.5;
    const hs = view.halfH / s + 1.5;
    box.b0 = -hs - top * box.cot; box.b1 = hs + 2.5;
    return 2 * box.A * (box.b1 - box.b0);
  }

  function spawn(p, kind, high) {
    const K = KIND[kind], t = view.target;
    p.kind = kind; p.rest = 0;
    p.vy = rnd(K.vy[0], K.vy[1]);
    p.wx = K.wind[0] * rnd(0.85, 1.15); p.wz = K.wind[1] * rnd(0.85, 1.15);
    p.ph = rnd(0, 6.3); p.sz = Math.random() < 0.35 ? 1.5 : 1;
    for (let tries = 0; tries < 4; tries++) {
      const a = rnd(-box.A, box.A), b = rnd(box.b0, box.b1);
      const lx = t.x + box.rx * a + box.fx * b, lz = t.z + box.rz * a + box.fz * b;
      if (!land(p, lx, lz)) continue;
      const h = high ? K.top * rnd(0.85, 1.15) : rnd(0.2, K.top);
      const tf = h / p.vy;
      p.x = lx - p.wx * tf; p.z = lz - p.wz * tf; p.y = p.floor + h;
      return true;
    }
    p.y = -999; // nowhere to fall right now
    return false;
  }

  // Keep a particle within the patch as the camera moves (it comes back in on the far side).
  function wrap(p) {
    const t = view.target, dx = p.x - t.x, dz = p.z - t.z;
    const a = dx * box.rx + dz * box.rz, b = dx * box.fx + dz * box.fz;
    let sa = 0, sb = 0;
    if (a < -box.A) sa = 2 * box.A; else if (a > box.A) sa = -2 * box.A;
    const L = box.b1 - box.b0, h = Math.max(0, p.y - p.floor);
    if (b < box.b0) sb = L; else if (b > box.b1) sb = -L;
    if (!sa && !sb) return true;
    p.x += box.rx * sa + box.fx * sb; p.z += box.rz * sa + box.fz * sb;
    const tf = h / p.vy;
    if (!land(p, p.x + p.wx * tf, p.z + p.wz * tf)) return false;
    p.y = p.floor + h;
    return true;
  }

  function lightning(now, dt) {
    if (flashT < 0 && mode === 'storm' && amount > 0.6 && Math.random() < dt * 0.08) { flashT = now; onFlash?.(); }
    let f = 0;
    if (flashT >= 0) {
      const t = (now - flashT) / 1000;
      // A bright strike, a flicker, a second strike, then it fades.
      f = t < 0.07 ? 1 : t < 0.14 ? 0.25 : t < 0.22 ? 0.75 : Math.max(0, 0.75 * Math.exp(-(t - 0.22) * 7));
      if (t > 1.2) flashT = -1;
    }
    view.wx.flash = f;
  }

  // state: { kind: 'rain'|'storm'|'snow'|null, season: 'spring'|..., dark: 0..0.65 }
  function update(now, dt, state) {
    // Slow changes (clouds, snow cover) follow the clock even when frames are slow.
    const rdt = Math.min(1, (now - (last || now)) / 1000);
    last = now;
    if (now - roofAt > 500) { roofCache.clear(); roofAt = now; }
    const kind = KIND[state.kind] ? state.kind : null;
    if (kind && kind !== mode) amount = mode ? amount * 0.5 : 0;
    mode = kind;
    amount = kind ? Math.min(1, amount + rdt / 3) : 0;
    // Clouds roll in (and away) over a few seconds.
    dim += ((kind ? KIND[kind].dim : 0) - dim) * Math.min(1, rdt / 3);
    view.wx.dim = dim;
    // Snow settles while it snows (white in about half a minute) and melts once it stops.
    cover = kind === 'snow' ? Math.min(1, cover + (rdt / 35) * amount) : Math.max(0, cover - rdt / 70);
    view.wx.snow = cover;
    if (cover > 0.6) view.setSnowTrees?.(true); else if (cover < 0.3) view.setSnowTrees?.(false);
    lightning(now, dt);

    const area = frame(8);
    const want = kind ? Math.min(drops.cap, Math.round(KIND[kind].density * area * amount)) : 0;
    const unit = view.snap?.unit || 0.05, b = view._b, right = b.right, up = b.up;
    drops.begin();
    rings.begin();
    let live = 0;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      let gone = p.y === -999;
      if (!gone && p.rest > 0) {
        // A snowflake lying on the ground for a moment.
        p.rest -= dt;
        if (p.rest <= 0) gone = true;
        else drops.card(p.x, p.floor + 0.03, p.z, unit * p.sz, unit * p.sz, right, up, [1, 1, 1, Math.min(1, p.rest) * 0.9]);
        if (!gone) { live++; continue; }
      }
      if (!gone) {
        p.y -= p.vy * dt; p.x += p.wx * dt; p.z += p.wz * dt;
        if (p.kind === 'snow') { p.ph += dt * 1.4; p.x += Math.sin(p.ph) * 0.45 * dt * box.rx; p.z += Math.sin(p.ph) * 0.45 * dt * box.rz; }
        if (!wrap(p)) gone = true;
      }
      if (!gone && p.y <= p.floor) {
        // Landed: a splash ring on open ground, or a flake that lies a moment.
        if (p.kind !== 'snow' && p.splash && ripples.length < rings.cap && Math.random() < 0.55) ripples.push({ x: p.x, y: p.floor + 0.04, z: p.z, t: 0, big: rnd(0.8, 1.25) });
        if (p.kind === 'snow' && p.splash && Math.random() < 0.5) { p.y = p.floor; p.rest = rnd(0.6, 1.6); live++; continue; }
        gone = true;
      }
      if (gone) {
        // Recycled as a new drop up in the clouds, unless there's already enough.
        if (!kind || live + i >= want || !spawn(p, kind, true)) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
      }
      live++;
      if (p.kind === 'snow') {
        const s = unit * p.sz;
        drops.card(p.x, p.y, p.z, s, s, right, up, [1, 1, 1, 0.95]);
      } else {
        // A streak along the way it falls, one pixel wide, fading toward its tail.
        const L = 0.045, vx = -p.wx * L, vy = p.vy * L, vz = -p.wz * L;
        const sr = vx * right.x + vy * right.y + vz * right.z, su = vx * up.x + vy * up.y + vz * up.z;
        const l = Math.hypot(sr, su) || 1, w = unit * 0.55;
        const ox = (right.x * -su + up.x * sr) / l * w, oy = (right.y * -su + up.y * sr) / l * w, oz = (right.z * -su + up.z * sr) / l * w;
        drops.quad(p.x - ox, p.y - oy, p.z - oz, p.x + ox, p.y + oy, p.z + oz,
          p.x + vx + ox, p.y + vy + oy, p.z + vz + oz, p.x + vx - ox, p.y + vy - oy, p.z + vz - oz, RAIN, RAIN_TOP);
      }
    }
    // Fill up toward the wanted count (new ones start anywhere in the column at first).
    let add = want - parts.length;
    const fresh = parts.length === 0;
    while (add-- > 0) { const p = {}; if (spawn(p, kind, !fresh)) parts.push(p); }
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      r.t += dt;
      const k = r.t / 0.4;
      if (k >= 1) { ripples[i] = ripples[ripples.length - 1]; ripples.pop(); continue; }
      const s = (0.07 + k * 0.17) * r.big;
      rings.flat(r.x, r.y, r.z, s, s, [0.82, 0.9, 1, 0.65 * (1 - k)]);
    }
    const L = G.tint;
    drops.setLight(L.r, L.g, L.b);
    rings.setLight(L.r, L.g, L.b);
    drops.end();
    rings.end();
    fireflies(dt, rdt, state, unit, right, up);
  }

  // Summer nights: fireflies drifting low over the ground near you, blinking.
  function fireflies(dt, rdt, state, unit, right, up) {
    const on = !mode && state.season === 'summer' && state.dark > 0.3;
    flies01 = on ? Math.min(1, flies01 + rdt / 3) : Math.max(0, flies01 - rdt / 2);
    flies.begin();
    if (flies01 > 0) {
      const t = view.target, R = Math.min(view.halfW, 14);
      while (bugs.length < 30) {
        const q = { x: t.x + rnd(-R, R), z: t.z + rnd(-R * 0.8, R * 0.8), h: rnd(0.3, 1.5), ph: rnd(0, 6.3), sp: rnd(0.5, 1), tw: rnd(1.6, 2.8) };
        q.gy = q.x >= 0 && q.z >= 0 && q.x < MAP_W && q.z < MAP_H ? tileGround(W, Math.floor(q.x), Math.floor(q.z)) : 0;
        bugs.push(q);
      }
      for (const q of bugs) {
        q.ph += dt;
        q.x += Math.sin(q.ph * 0.7 * q.sp) * 0.35 * dt; q.z += Math.cos(q.ph * 0.9 * q.sp) * 0.3 * dt;
        if (Math.abs(q.x - t.x) > R + 2) q.x = t.x - Math.sign(q.x - t.x) * R;
        if (Math.abs(q.z - t.z) > R + 2) q.z = t.z - Math.sign(q.z - t.z) * R;
        const glow = Math.sqrt(Math.max(0, Math.sin(q.ph * q.tw))) * flies01;
        if (glow < 0.05) continue;
        const y = q.gy + q.h + Math.sin(q.ph * 1.3) * 0.15, s = unit * 4;
        flies.card(q.x, y, q.z, s, s, right, up, [1, 1, 0.6, glow]);
      }
    } else bugs.length = 0;
    flies.end();
  }

  return { update };
}

// Leaves and blossom petals falling from the real trees near the camera, in each tree's
// own colours (pink petals from blossom trees in spring, red/orange/gold leaves from fall
// maples, the odd green leaf in summer, none in winter). They spin and sway down from the
// crown, rest on the ground for a while, then fade: little cards in the 3D scene.
// opts: { view, world, isTree(x, y), kindAt(x, y), palette: { kind: [5 colours] } }
export function makeTreeLeaves({ view, world, isTree, kindAt, palette }) {
  const leaves = [];
  const batch = new QuadBatch('leaves', 170, 'leaf', { order: 6 });
  let acc = 0;
  const RATE = { spring: 16, summer: 2, fall: 22, winter: 0 };
  const rgb = new Map();
  const col = (h) => { let c = rgb.get(h); if (!c) { c = [...hexRGB(h), 1]; rgb.set(h, c); } return c; };
  function spawn(season, cx, cz) {
    // A tree somewhere around the camera.
    for (let tries = 0; tries < 40; tries++) {
      const x = Math.floor(cx + rnd(-12, 12)), z = Math.floor(cz + rnd(-9, 9));
      if (!isTree(x, z)) continue;
      const kind = kindAt(x, z);
      if (kind === 'pine') continue;
      if (season === 'spring' && kind !== 'blossom' && Math.random() < 0.85) continue;
      const pal = palette[kind] || palette.oak;
      const petal = kind === 'blossom', gy = tileGround(world, x, z);
      leaves.push({
        x: x + 0.5 + rnd(-0.9, 0.9), y: gy + rnd(1.6, 3.1), z: z + 0.55 + rnd(-0.5, 0.5), gy,
        vy: rnd(0.35, 0.65) * (petal ? 0.8 : 1), ph: rnd(0, 6.3), spin: rnd(-3, 3), rot: rnd(0, 6.3),
        r: petal ? rnd(0.1, 0.14) : rnd(0.13, 0.19), c: col(pal[2 + Math.floor(Math.random() * 3)]), petal, rest: 0, life: 1,
      });
      return;
    }
  }
  const tmp = [0, 0, 0, 0];
  function update(now, dt, season) {
    const rate = RATE[season] || 0;
    const cam = view.target;
    if (rate) {
      acc += dt * rate;
      while (acc >= 1 && leaves.length < 160) { acc -= 1; spawn(season, cam.x, cam.z); }
      if (acc > 1) acc = 0;
    }
    const b = view._b;
    batch.begin();
    for (let i = leaves.length - 1; i >= 0; i--) {
      const p = leaves[i];
      const floor = p.gy + 0.03;
      if (p.y > floor) {
        p.y = Math.max(floor, p.y - p.vy * dt);
        p.ph += dt * 2.2;
        p.x += Math.sin(p.ph) * 0.35 * dt + 0.08 * dt; p.z += Math.cos(p.ph * 0.7) * 0.2 * dt;
        p.rot += p.spin * dt;
      } else {
        p.rest += dt;
        if (p.rest > 4) p.life -= dt / 1.5;
        if (p.life <= 0 || Math.abs(p.x - cam.x) > 30 || Math.abs(p.z - cam.z) > 24) { leaves.splice(i, 1); continue; }
      }
      tmp[0] = p.c[0]; tmp[1] = p.c[1]; tmp[2] = p.c[2]; tmp[3] = Math.max(0, p.life);
      const ry = p.r * (p.petal ? 0.7 : 0.55);
      // Fluttering: the leaf turns edge-on and back as it falls; it lies flat once landed.
      if (p.y > floor) batch.card(p.x, p.y, p.z, p.r, ry * (Math.abs(Math.sin(p.ph * 1.6)) * 0.7 + 0.3), b.right, b.up, tmp, p.rot);
      else batch.flat(p.x, floor, p.z, p.r, ry, tmp, p.rot);
    }
    const L = G.tint;
    batch.setLight(L.r, L.g, L.b);
    batch.end();
  }
  return { update };
}

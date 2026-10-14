// Little animations on things in the world, drawn over the 3D view each frame (like the
// falling leaves): water arcing out of live sprinklers, flames and embers in fireplaces
// and fire pits, flickering candles and lanterns, steam from busy machines, a bubbling
// cauldron. Positions are worked out from time alone (no particle state), so it's cheap.
// It also reports how close the nearest of each kind is, for their sounds.
import { ITEMS } from '@shared/catalog.js';
import { footprint, levelView, roofAt, LEVEL_H } from '@shared/plot.js';
import { connected } from '@shared/farm.js';

const FIRE = new Set(['fireplace', 'firepit']);
const FLICKER = { candles: [0.35, 0.5], lantern: [0.45, 0.6], stonelantern: [0.55, 0.7], jackolantern: [0.35, 0.8] };
const RANGE = 18; // tiles from the camera worth animating
const HEAR = 11;  // tiles away you stop hearing something

// opts: { view, plots: () => plot list, shown: (plot, lx, ly, level) => visible?, me: () => {x, z} in tiles }
export function makeObjectFx({ view, plots, shown, me }) {
  const sound = { sprinkler: 0, fire: 0, machine: 0, clock: 0, bubble: 0 };
  const hear = (kind, x, z) => {
    const p = me();
    if (!p) return;
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < HEAR) sound[kind] = Math.max(sound[kind], (1 - d / HEAR) ** 2);
  };

  function draw(c, now, opts = {}) {
    for (const k of Object.keys(sound)) sound[k] = 0;
    const cam = view.target;
    const a = view.toScreen(cam.x, 0, cam.z), b = view.toScreen(cam.x + 1, 0, cam.z);
    const ppt = Math.hypot(b.x - a.x, b.y - a.y); // pixels per tile
    const t = now / 1000;
    for (const plot of plots()) {
      if (Math.abs(plot.x + plot.w / 2 - cam.x) > RANGE + plot.w / 2 || Math.abs(plot.y + plot.h / 2 - cam.z) > RANGE + plot.h / 2) continue;
      for (const level of [0, 1]) {
        const view_ = level ? plot.l1 : plot;
        if (!view_?.obj) continue;
        for (const [k, o] of Object.entries(view_.obj)) {
          const d = ITEMS[o.t];
          if (!d) continue;
          const isFire = FIRE.has(o.t), spray = d.reach && d.needs === 'water';
          const busy = d.machine && o.job && now < o.job.ready;
          if (!isFire && !spray && !busy && !FLICKER[o.t] && o.t !== 'cauldron' && o.t !== 'grandclock' && o.t !== 'harvester') continue;
          const [lx, ly] = k.split(',').map(Number);
          const r = o.r || 0, [w, h] = footprint(o.t, r);
          const cx = plot.x + lx + w / 2, cz = plot.y + ly + h / 2, y0 = level * LEVEL_H;
          const vis = shown(plot, lx, ly, level);
          const seed = (lx * 7 + ly * 13) % 17;
          if (spray) {
            if (!(plot.util?.water && connected(plot, k, 'water'))) continue;
            hear('sprinkler', cx, cz);
            if (vis && !opts.quiet) sprinkle(c, cx, cz, y0, d.reach, o.t === 'bigsprinkler', t + seed, ppt);
          } else if (isFire) {
            // Fireplace: the fire sits in the hearth at the front.
            const [fx, fz] = [[0, 0.25], [-0.25, 0], [0, -0.25], [0.25, 0]][r];
            const px = o.t === 'fireplace' ? cx + fx : cx, pz = o.t === 'fireplace' ? cz + fz : cz;
            hear('fire', px, pz);
            if (vis) flames(c, px, y0 + (o.t === 'fireplace' ? 0.12 : 0.18), pz, o.t === 'fireplace' ? 0.5 : 0.62, t + seed, ppt, o.t === 'firepit');
          } else if (FLICKER[o.t]) {
            if (vis && opts.dark > 0.15) glow(c, cx, y0 + FLICKER[o.t][0], cz, FLICKER[o.t][1], t + seed, ppt, opts.dark);
          } else if (o.t === 'cauldron') {
            hear('bubble', cx, cz);
            if (vis) bubbles(c, cx, y0 + 0.62, cz, t + seed, ppt);
          } else if (o.t === 'grandclock') {
            hear('clock', cx, cz);
          } else if (o.t === 'harvester') {
            if (!(plot.util?.power && connected(plot, k, 'power'))) continue;
            hear('machine', cx, cz);
            if (vis) beacon(c, cx, y0 + 0.78, cz, t + seed, ppt);
          } else if (busy) {
            hear('machine', cx, cz);
            if (vis) steam(c, cx, y0 + (h > 1 || w > 1 ? 0.9 : 0.85), cz, t + seed, ppt, o.t === 'smoker' || o.t === 'bakeryoven');
          }
        }
      }
    }
    return sound;
  }

  // Water from a sprinkler: jets arcing out to its reach and splashing down. A small
  // one spins four jets; the big one sweeps a single jet back and forth, ticking.
  function sprinkle(c, x, z, y0, reach, big, t, ppt) {
    const top = y0 + (big ? 1.18 : 0.55), R = reach + 0.35, arc = big ? 0.6 : 0.35;
    const jets = big ? [Math.sin(t * 0.9) * 2.4] : [0, 1, 2, 3].map((i) => t * 1.6 + (i * Math.PI) / 2);
    const N = big ? 16 : 9;
    c.save();
    c.lineCap = 'round';
    for (const ang of jets) {
      const dx = Math.cos(ang), dz = Math.sin(ang);
      for (let i = 0; i < N; i++) {
        const ph = (t * (big ? 0.9 : 1.4) + i / N) % 1;
        const d = ph * R, yy = top * (1 - ph) + arc * 4 * ph * (1 - ph);
        const p = view.toScreen(x + dx * d, yy, z + dz * d);
        const q = view.toScreen(x + dx * (d - 0.06), top * (1 - Math.max(0, ph - 0.05)) + arc * 4 * Math.max(0, ph - 0.05) * (1 - Math.max(0, ph - 0.05)), z + dz * (d - 0.06));
        c.strokeStyle = `rgba(200,232,255,${0.55 + 0.35 * (1 - ph)})`;
        c.lineWidth = Math.max(1.2, ppt * 0.035);
        c.beginPath(); c.moveTo(q.x, q.y); c.lineTo(p.x, p.y); c.stroke();
        // Splashes where it lands.
        if (ph > 0.9) {
          const g = view.toScreen(x + dx * R, 0.02, z + dz * R);
          c.strokeStyle = `rgba(220,240,255,${(1 - ph) * 6})`;
          c.lineWidth = 1;
          c.beginPath(); c.ellipse(g.x, g.y, ppt * 0.12 * (ph - 0.85) * 10, ppt * 0.05 * (ph - 0.85) * 10, 0, 0, Math.PI * 2); c.stroke();
        }
      }
    }
    // A fine mist around the head.
    const h = view.toScreen(x, top, z);
    const m = c.createRadialGradient(h.x, h.y, 0, h.x, h.y, ppt * 0.35);
    m.addColorStop(0, 'rgba(225,242,255,.35)'); m.addColorStop(1, 'rgba(225,242,255,0)');
    c.fillStyle = m; c.fillRect(h.x - ppt * 0.35, h.y - ppt * 0.35, ppt * 0.7, ppt * 0.7);
    c.restore();
  }

  // Flames: three tongues licking up and swaying, a warm glow, embers drifting up (and
  // smoke from an open fire pit).
  function flames(c, x, y, z, size, t, ppt, smoky) {
    const base = view.toScreen(x, y, z), S = ppt * size;
    c.save();
    const g = c.createRadialGradient(base.x, base.y - S * 0.3, 0, base.x, base.y - S * 0.3, S * 1.3);
    g.addColorStop(0, `rgba(255,190,90,${0.35 + 0.08 * Math.sin(t * 9)})`); g.addColorStop(1, 'rgba(255,140,40,0)');
    c.fillStyle = g; c.fillRect(base.x - S * 1.3, base.y - S * 1.6, S * 2.6, S * 2.6);
    const tongue = (ox, hgt, wid, col) => {
      const sway = Math.sin(t * 7 + ox * 9) * wid * 0.35;
      c.fillStyle = col;
      c.beginPath();
      c.moveTo(base.x + ox * S - wid * S, base.y);
      c.quadraticCurveTo(base.x + ox * S - wid * S * 0.9, base.y - hgt * S * 0.55, base.x + ox * S + sway * S, base.y - hgt * S);
      c.quadraticCurveTo(base.x + ox * S + wid * S * 0.9, base.y - hgt * S * 0.55, base.x + ox * S + wid * S, base.y);
      c.closePath(); c.fill();
    };
    const f = (k) => 0.75 + 0.25 * Math.sin(t * (8 + k) + k * 2) * Math.sin(t * (5.3 + k));
    tongue(-0.22, 0.55 * f(1), 0.16, 'rgba(226,88,34,.9)');
    tongue(0.2, 0.6 * f(2), 0.16, 'rgba(226,88,34,.9)');
    tongue(0, 0.85 * f(3), 0.22, 'rgba(245,140,40,.95)');
    tongue(-0.05, 0.55 * f(4), 0.13, 'rgba(255,210,90,.95)');
    tongue(0.05, 0.32 * f(5), 0.08, 'rgba(255,245,200,.95)');
    for (let i = 0; i < 6; i++) {
      const ph = (t * 0.6 + i / 6) % 1;
      const ex = x + Math.sin(i * 12.9 + t * 1.3) * 0.12 * size, ey = y + 0.15 + ph * (smoky ? 1.4 : 0.9) * size;
      const p = view.toScreen(ex, ey, z);
      c.fillStyle = `rgba(255,${170 + i * 10},80,${(1 - ph) * 0.9})`;
      c.fillRect(p.x, p.y, Math.max(1.5, ppt * 0.03), Math.max(1.5, ppt * 0.03));
    }
    if (smoky) puffs(c, x, y + 0.8 * size, z, t, ppt, 'rgba(120,115,110,', 0.45);
    c.restore();
  }

  function glow(c, x, y, z, rad, t, ppt, dark) {
    const p = view.toScreen(x, y, z), R = ppt * rad * (0.9 + 0.1 * Math.sin(t * 11) * Math.sin(t * 6.1));
    const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
    g.addColorStop(0, `rgba(255,214,130,${0.35 * Math.min(1, dark * 2)})`); g.addColorStop(1, 'rgba(255,190,90,0)');
    c.fillStyle = g; c.fillRect(p.x - R, p.y - R, R * 2, R * 2);
  }

  function puffs(c, x, y, z, t, ppt, rgb, alpha) {
    for (let i = 0; i < 4; i++) {
      const ph = (t * 0.35 + i / 4) % 1;
      const p = view.toScreen(x + Math.sin(t * 0.7 + i * 2) * 0.08 + ph * 0.15, y + ph * 0.9, z);
      const R = ppt * (0.08 + ph * 0.18);
      c.fillStyle = `${rgb}${alpha * (1 - ph) * Math.min(1, ph * 5)})`;
      c.beginPath(); c.arc(p.x, p.y, R, 0, Math.PI * 2); c.fill();
    }
  }
  // Busy machines: steam (or smoke from smokers and ovens) puffing out of the top.
  function steam(c, x, y, z, t, ppt, smoke) { puffs(c, x, y, z, t, ppt, smoke ? 'rgba(130,124,118,' : 'rgba(245,248,252,', 0.55); }
  function bubbles(c, x, y, z, t, ppt) {
    for (let i = 0; i < 5; i++) {
      const ph = (t * 0.9 + i / 5) % 1;
      const p = view.toScreen(x + Math.sin(i * 7.3) * 0.18, y + ph * 0.25, z + Math.cos(i * 5.1) * 0.12);
      c.strokeStyle = `rgba(150,240,120,${1 - ph})`; c.lineWidth = 1.2;
      c.beginPath(); c.arc(p.x, p.y, ppt * (0.03 + ph * 0.04), 0, Math.PI * 2); c.stroke();
    }
    puffs(c, x, y + 0.2, z, t, ppt, 'rgba(160,230,140,', 0.3);
  }
  // The harvester's status light blinks while it's powered.
  function beacon(c, x, y, z, t, ppt) {
    if (Math.sin(t * 5) < 0.2) return;
    const p = view.toScreen(x, y, z), R = ppt * 0.16;
    const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
    g.addColorStop(0, 'rgba(140,255,140,.85)'); g.addColorStop(1, 'rgba(140,255,140,0)');
    c.fillStyle = g; c.fillRect(p.x - R, p.y - R, R * 2, R * 2);
  }

  return { draw, sound };
}

// Geometry helpers: boxes with world-aligned UVs (so textures line up across wall
// segments), merging by material, and gable roofs.
import { Geo, box, merge, toMesh } from './bjs.js';
import { WALL_H } from './textures.js';

// Rewrites UVs from world positions: horizontal faces map (x, z); vertical faces map
// (along-the-face, y / vScale). One texture repeat = 1 unit wide, vScale tall.
export function worldUV(geo, vScale = WALL_H) {
  const p = geo.pos, n = geo.nrm, uv = geo.uv;
  for (let i = 0, c = geo.count; i < c; i++) {
    const nx = Math.abs(n[i * 3]), ny = Math.abs(n[i * 3 + 1]);
    const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
    if (ny > 0.5) { uv[i * 2] = x; uv[i * 2 + 1] = -z; } else if (nx > 0.5) { uv[i * 2] = z; uv[i * 2 + 1] = y / vScale; } else { uv[i * 2] = x; uv[i * 2 + 1] = y / vScale; }
  }
  return geo;
}

// Axis-aligned box from min corner (x, y, z) with size (w, h, d), world UVs.
export function boxAt(x, y, z, w, h, d, vScale) {
  return worldUV(box(w, h, d).translate(x + w / 2, y + h / 2, z + d / 2), vScale);
}

// Collects geometries per material and merges them into meshes (one draw call each).
export class Batch {
  constructor() { this.parts = new Map(); }
  add(mat, geo) {
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push(geo);
  }
  // parent: a node; cast: draws into the sun's shadow map. Returns the meshes.
  build(parent, { cast = true, noCast = null } = {}) {
    const out = [];
    for (const [mat, list] of this.parts) out.push(toMesh(merge(list), mat, { parent, cast: cast && mat !== noCast }));
    return out;
  }
}

// A gable roof over the rectangle [x0, x1] x [z0, z1] whose eaves sit at height y.
// Adds slopes to `roofMat` and the triangular gable ends to `gableMat`.
export function gableRoof(batch, x0, z0, x1, z1, y, roofMat, gableMat, trimMat) {
  const alongX = x1 - x0 >= z1 - z0;
  const o = 0.3; // overhang
  const len = (alongX ? x1 - x0 : z1 - z0) + o * 2;
  const half = (alongX ? z1 - z0 : x1 - x0) / 2;
  const rise = Math.min(1.6, Math.max(0.6, half * 0.75));
  const slope = Math.hypot(half + o, rise * ((half + o) / half));
  const ang = Math.atan2(rise, half);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const t = 0.12;
  for (const side of [-1, 1]) {
    const g = box(alongX ? len : slope, t, alongX ? slope : len);
    // Tilt down towards the eave on this side.
    if (alongX) g.rotateX(side * ang); else g.rotateZ(-side * ang);
    const off = (slope / 2) * Math.cos(ang);
    g.translate(alongX ? cx : cx + side * off, y + rise - (slope / 2) * Math.sin(ang) + 0.04, alongX ? cz + side * off : cz);
    batch.add(roofMat, worldUV(g, 1));
  }
  // Ridge cap
  batch.add(trimMat, boxAt(alongX ? x0 - o : cx - 0.1, y + rise - 0.02, alongX ? cz - 0.1 : z0 - o, alongX ? len : 0.2, 0.14, alongX ? 0.2 : len));
  // Gable ends (triangles)
  const pos = [], nrm = [];
  for (const end of [-1, 1]) {
    const e = end < 0 ? (alongX ? x0 : z0) : (alongX ? x1 : z1);
    const a = [-half, 0], b = [half, 0], c = [0, rise];
    for (const [s, h] of [a, b, c]) {
      if (alongX) { pos.push(e, y + h, cz + s); nrm.push(end, 0, 0); } else { pos.push(cx + s, y + h, e); nrm.push(0, 0, end); }
    }
  }
  const idx = [0, 1, 2, 3, 4, 5];
  batch.add(gableMat, worldUV(new Geo(pos, nrm, new Array((pos.length / 3) * 2).fill(0), idx)));
  return rise;
}

// Geometry helpers: boxes with world-aligned UVs (so textures line up across wall
// segments), merging by material, and gable roofs.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WALL_H } from './textures.js';

// Rewrites UVs from world positions: horizontal faces map (x, z); vertical faces map
// (along-the-face, y / vScale). One texture repeat = 1 unit wide, vScale tall.
export function worldUV(geo, vScale = WALL_H) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (ny > 0.5) uv.setXY(i, x, -z);
    else if (nx > 0.5) uv.setXY(i, z, y / vScale);
    else uv.setXY(i, x, y / vScale);
  }
  uv.needsUpdate = true;
  return geo;
}

// Axis-aligned box from min corner (x, y, z) with size (w, h, d), world UVs.
export function boxAt(x, y, z, w, h, d, vScale) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x + w / 2, y + h / 2, z + d / 2);
  return worldUV(g, vScale);
}

// Collects geometries per material and merges them into meshes.
export class Batch {
  constructor() { this.parts = new Map(); }
  add(mat, geo) {
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push(geo);
  }
  build(group, { cast = true, receive = true } = {}) {
    for (const [mat, list] of this.parts) {
      // Mixed indexed/non-indexed geometry can't merge directly; flatten when needed.
      const mixed = list.some((g) => !g.index);
      const geos = mixed ? list.map((g) => (g.index ? g.toNonIndexed() : g)) : list;
      const m = new THREE.Mesh(geos.length === 1 ? geos[0] : mergeGeometries(geos), mat);
      m.castShadow = cast; m.receiveShadow = receive;
      group.add(m);
    }
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
    const g = new THREE.BoxGeometry(alongX ? len : slope, t, alongX ? slope : len);
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
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
  batch.add(gableMat, worldUV(g));
  return rise;
}

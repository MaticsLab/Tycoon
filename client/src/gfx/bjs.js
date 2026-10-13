// The thin layer between the game's renderer and Babylon.js: the engine/scene, a tiny
// geometry toolkit (boxes, merging, transforms — what the gfx modules used to get from
// three.js), and one shader for everything we draw. The shader reproduces the old
// three.js look exactly: Lambert lighting in linear space (hemisphere + sun with a hard
// shadow map + a pool of point lights with three's distance falloff), sRGB textures and
// an sRGB-encoded output, so the pixel art keeps its colours.
// The engine without its optional extensions (cube maps, compressed/HDR texture loaders,
// loading screen...): only the pieces this game draws with, to keep the bundle small.
import { Engine } from '@babylonjs/core/Engines/engine.pure.js';
import '@babylonjs/core/Engines/Extensions/engine.alpha.js';
import '@babylonjs/core/Engines/Extensions/engine.renderTarget.js';
import '@babylonjs/core/Engines/Extensions/engine.renderTargetTexture.js';
import '@babylonjs/core/Engines/Extensions/engine.uniformBuffer.js';
import '@babylonjs/core/Engines/AbstractEngine/abstractEngine.states.js';
import '@babylonjs/core/Engines/AbstractEngine/abstractEngine.stencil.js';
import '@babylonjs/core/Engines/AbstractEngine/abstractEngine.renderPass.js';
import '@babylonjs/core/Engines/AbstractEngine/abstractEngine.texture.js';
import '@babylonjs/core/Engines/AbstractEngine/abstractEngine.dom.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';

export { Mesh, TransformNode, Vector3, Color4 };

// ---------- engine & scene ----------
export const ctx = { engine: null, scene: null, frame: 0, globals: null, shadow: null };

export function createScene(canvas) {
  const engine = new Engine(canvas, false, {
    alpha: false, antialias: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false,
    powerPreference: 'high-performance', doNotHandleContextLost: false, audioEngine: false,
  }, false);
  engine.disableUniformBuffers = true; // plain uniforms: we bind the few we need ourselves
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true; // same world axes as the game data (and the old three.js view)
  scene.detachControl(); // the game handles all input; no pointer picking per move
  scene.skipPointerMovePicking = true;
  scene.autoClear = true;
  scene.autoClearDepthAndStencil = true;
  scene.skipFrustumClipping = false;
  scene.particlesEnabled = false; scene.spritesEnabled = false; scene.lensFlaresEnabled = false;
  scene.probesEnabled = false; scene.postProcessesEnabled = false; scene.fogEnabled = false;
  scene.lightsEnabled = false; scene.texturesEnabled = true;
  ctx.engine = engine; ctx.scene = scene;
  return { engine, scene };
}

// ---------- colours ----------
export const s2l = (c) => (c <= 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4));
const l2s = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 0.41666) - 0.055);
// '#rrggbb' -> [r, g, b] in 0..1 (sRGB)
export function hexRGB(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}
// '#rrggbb' -> linear Color3 (what three.js does with colours under colour management)
export function linear(hex) { const [r, g, b] = hexRGB(hex); return new Color3(s2l(r), s2l(g), s2l(b)); }
export const linearRGB = (hex) => hexRGB(hex).map(s2l);
export function hexOf(r, g, b) { return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join(''); }
export function hexFromLinear(r, g, b) { return hexOf(l2s(r), l2s(g), l2s(b)); }
// HSL helpers (same maths as three's Color.getHSL / setHSL).
export function rgbToHSL(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (min + max) / 2;
  if (min !== max) {
    const d = max - min;
    s = l <= 0.5 ? d / (max + min) : d / (2 - max - min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0); else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h /= 6;
  }
  return { h, s, l };
}
function hue2rgb(p, q, t) {
  if (t < 0) t += 1; if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * 6 * (2 / 3 - t);
  return p;
}
export function hslToRGB(h, s, l) {
  h = ((h % 1) + 1) % 1; s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
  if (s === 0) return [l, l, l];
  const p = l <= 0.5 ? l * (1 + s) : l + s - l * s, q = 2 * l - p;
  return [hue2rgb(q, p, h + 1 / 3), hue2rgb(q, p, h), hue2rgb(q, p, h - 1 / 3)];
}
// three's color.setHSL(h, s, l): HSL in the (linear) working space.
export function linearHSL(h, s, l, out) { const [r, g, b] = hslToRGB(h, s, l); return out.set(r, g, b); }

// ---------- geometry ----------
// A plain triangle list: positions, normals, uvs (+ optional linear vertex colours).
export class Geo {
  constructor(pos = [], nrm = [], uv = [], idx = [], col = null) { this.pos = pos; this.nrm = nrm; this.uv = uv; this.idx = idx; this.col = col; }
  get count() { return this.pos.length / 3; }
  translate(x, y, z) {
    const p = this.pos;
    for (let i = 0; i < p.length; i += 3) { p[i] += x; p[i + 1] += y; p[i + 2] += z; }
    return this;
  }
  // Applies a 3x3 rotation/scale m (row-major, column vectors: v' = m v) plus translation.
  apply(m, tx = 0, ty = 0, tz = 0, normalM = m) {
    const p = this.pos, n = this.nrm;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2];
      p[i] = m[0] * x + m[1] * y + m[2] * z + tx; p[i + 1] = m[3] * x + m[4] * y + m[5] * z + ty; p[i + 2] = m[6] * x + m[7] * y + m[8] * z + tz;
    }
    for (let i = 0; i < n.length; i += 3) {
      const x = n[i], y = n[i + 1], z = n[i + 2];
      let a = normalM[0] * x + normalM[1] * y + normalM[2] * z, b = normalM[3] * x + normalM[4] * y + normalM[5] * z, c = normalM[6] * x + normalM[7] * y + normalM[8] * z;
      const l = Math.hypot(a, b, c) || 1;
      n[i] = a / l; n[i + 1] = b / l; n[i + 2] = c / l;
    }
    return this;
  }
  rotateX(a) { const c = Math.cos(a), s = Math.sin(a); return this.apply([1, 0, 0, 0, c, -s, 0, s, c]); }
  rotateY(a) { const c = Math.cos(a), s = Math.sin(a); return this.apply([c, 0, s, 0, 1, 0, -s, 0, c]); }
  rotateZ(a) { const c = Math.cos(a), s = Math.sin(a); return this.apply([c, -s, 0, s, c, 0, 0, 0, 1]); }
  clone() { return new Geo(this.pos.slice(), this.nrm.slice(), this.uv.slice(), this.idx.slice(), this.col && this.col.slice()); }
  // Fills the vertex colours with one linear colour [r, g, b].
  colorize(rgb) {
    const n = this.count, c = new Array(n * 4);
    for (let i = 0; i < n; i++) { c[i * 4] = rgb[0]; c[i * 4 + 1] = rgb[1]; c[i * 4 + 2] = rgb[2]; c[i * 4 + 3] = 1; }
    this.col = c;
    return this;
  }
}

// Concatenates geometries (like three's mergeGeometries).
export function merge(list) {
  if (list.length === 1) return list[0];
  let nv = 0, ni = 0;
  for (const g of list) { nv += g.count; ni += g.idx.length; }
  const hasCol = list.every((g) => g.col);
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = hasCol ? new Float32Array(nv * 4) : null;
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let v = 0, k = 0;
  for (const g of list) {
    pos.set(g.pos, v * 3); nrm.set(g.nrm, v * 3);
    if (g.uv.length) uv.set(g.uv, v * 2);
    if (col) col.set(g.col, v * 4);
    for (let i = 0; i < g.idx.length; i++) idx[k++] = g.idx[i] + v;
    v += g.count;
  }
  return new Geo(pos, nrm, uv, idx, col);
}

// three.js BoxGeometry, same vertex order, normals, UVs and winding. faces: optional
// subset of 'px nx py ny pz nz' (used for multi-material boxes).
const BOX_PLANES = [
  ['px', 2, 1, 0, -1, -1, 'd', 'h', 'w', 1], ['nx', 2, 1, 0, 1, -1, 'd', 'h', 'w', -1],
  ['py', 0, 2, 1, 1, 1, 'w', 'd', 'h', 1], ['ny', 0, 2, 1, 1, -1, 'w', 'd', 'h', -1],
  ['pz', 0, 1, 2, 1, -1, 'w', 'h', 'd', 1], ['nz', 0, 1, 2, -1, -1, 'w', 'h', 'd', -1],
];
export function box(w, h, d, faces = null) {
  const S = { w, h, d };
  const pos = [], nrm = [], uv = [], idx = [];
  for (const [name, u, v, wa, udir, vdir, uw, vh, dd, sign] of BOX_PLANES) {
    if (faces && !faces.includes(name)) continue;
    const width = S[uw], height = S[vh], depth = S[dd] * sign;
    const base = pos.length / 3;
    for (let iy = 0; iy < 2; iy++) {
      const y = iy * height - height / 2;
      for (let ix = 0; ix < 2; ix++) {
        const x = ix * width - width / 2;
        const p = [0, 0, 0], n = [0, 0, 0];
        p[u] = x * udir; p[v] = y * vdir; p[wa] = depth / 2;
        n[wa] = depth > 0 ? 1 : -1;
        pos.push(...p); nrm.push(...n); uv.push(ix, 1 - iy);
      }
    }
    const a = base, b = base + 2, c = base + 3, e = base + 1;
    idx.push(a, b, e, b, c, e);
  }
  return new Geo(pos, nrm, uv, idx);
}

// A flat quad from 4 corners (counter-clockwise seen from the front), one normal.
export function quad(corners, normal, uvs = [0, 1, 1, 1, 1, 0, 0, 0]) {
  const pos = corners.flat(), nrm = [];
  for (let i = 0; i < 4; i++) nrm.push(...normal);
  return new Geo(pos, nrm, uvs.slice(), [0, 1, 2, 0, 2, 3]);
}

// three.js PlaneGeometry(w, h) in the XY plane facing +z.
export function plane(w, h) {
  return new Geo([-w / 2, h / 2, 0, w / 2, h / 2, 0, -w / 2, -h / 2, 0, w / 2, -h / 2, 0], [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], [0, 1, 1, 1, 0, 0, 1, 0], [0, 2, 1, 2, 3, 1]);
}

// three.js CylinderGeometry(rt, rb, h, seg) (one height segment, capped).
export function cylinder(rt, rb, h, seg) {
  const pos = [], nrm = [], uv = [], idx = [];
  const hh = h / 2, slope = (rb - rt) / h;
  const rows = [];
  for (let y = 0; y <= 1; y++) {
    const row = [], r = y * (rb - rt) + rt;
    for (let x = 0; x <= seg; x++) {
      const u = x / seg, th = u * Math.PI * 2, s = Math.sin(th), c = Math.cos(th);
      pos.push(r * s, -y * h + hh, r * c);
      const l = Math.hypot(s, slope, c);
      nrm.push(s / l, slope / l, c / l);
      uv.push(u, 1 - y);
      row.push(pos.length / 3 - 1);
    }
    rows.push(row);
  }
  for (let x = 0; x < seg; x++) {
    const a = rows[0][x], b = rows[1][x], c = rows[1][x + 1], d = rows[0][x + 1];
    if (rt > 0) idx.push(a, b, d);
    if (rb > 0) idx.push(b, c, d);
  }
  for (const top of [true, false]) {
    const r = top ? rt : rb, sign = top ? 1 : -1;
    if (r <= 0) continue;
    const c0 = pos.length / 3;
    for (let x = 1; x <= seg; x++) { pos.push(0, hh * sign, 0); nrm.push(0, sign, 0); uv.push(0.5, 0.5); }
    const e0 = pos.length / 3;
    for (let x = 0; x <= seg; x++) {
      const th = (x / seg) * Math.PI * 2, s = Math.sin(th), c = Math.cos(th);
      pos.push(r * s, hh * sign, r * c); nrm.push(0, sign, 0); uv.push(c * 0.5 + 0.5, s * 0.5 * sign + 0.5);
    }
    for (let x = 0; x < seg; x++) {
      const c = c0 + x, i = e0 + x;
      if (top) idx.push(i, i + 1, c); else idx.push(i + 1, i, c);
    }
  }
  return new Geo(pos, nrm, uv, idx);
}

// three.js SphereGeometry(r, ws, hs).
export function sphere(r, ws, hs) {
  const pos = [], nrm = [], uv = [], idx = [], grid = [];
  for (let iy = 0; iy <= hs; iy++) {
    const row = [], v = iy / hs;
    const uOff = iy === 0 ? 0.5 / ws : iy === hs ? -0.5 / ws : 0;
    for (let ix = 0; ix <= ws; ix++) {
      const u = ix / ws;
      const x = -r * Math.cos(u * Math.PI * 2) * Math.sin(v * Math.PI), y = r * Math.cos(v * Math.PI), z = r * Math.sin(u * Math.PI * 2) * Math.sin(v * Math.PI);
      pos.push(x, y, z);
      const l = Math.hypot(x, y, z) || 1;
      nrm.push(x / l, y / l, z / l); uv.push(u + uOff, 1 - v);
      row.push(pos.length / 3 - 1);
    }
    grid.push(row);
  }
  for (let iy = 0; iy < hs; iy++) for (let ix = 0; ix < ws; ix++) {
    const a = grid[iy][ix + 1], b = grid[iy][ix], c = grid[iy + 1][ix], d = grid[iy + 1][ix + 1];
    if (iy !== 0) idx.push(a, b, d);
    if (iy !== hs - 1) idx.push(b, c, d);
  }
  return new Geo(pos, nrm, uv, idx);
}

// ---------- meshes ----------
let meshId = 0;
// Builds a Babylon mesh from a Geo. opts: { cast, parent, updatable, name, lines }
export function toMesh(geo, mat, opts = {}) {
  const mesh = new Mesh(opts.name || `m${meshId++}`, ctx.scene);
  const vd = new VertexData();
  vd.positions = geo.pos instanceof Float32Array ? geo.pos : new Float32Array(geo.pos);
  if (geo.nrm.length) vd.normals = geo.nrm instanceof Float32Array ? geo.nrm : new Float32Array(geo.nrm);
  if (geo.uv.length) vd.uvs = geo.uv instanceof Float32Array ? geo.uv : new Float32Array(geo.uv);
  if (geo.col) vd.colors = geo.col instanceof Float32Array ? geo.col : new Float32Array(geo.col);
  vd.indices = geo.idx.BYTES_PER_ELEMENT ? geo.idx : (geo.count > 65535 ? new Uint32Array(geo.idx) : new Uint16Array(geo.idx));
  vd.applyToMesh(mesh, !!opts.updatable);
  mesh.material = mat;
  mesh.alphaIndex = opts.alphaIndex ?? 0; // three.js renderOrder: transparent passes sort by this first
  mesh.isPickable = false;
  if (opts.parent) mesh.parent = opts.parent;
  if (opts.cast && ctx.shadow) ctx.shadow.add(mesh);
  return mesh;
}

// Corner offsets of a camera-facing sprite (three.js Sprite: center, scale, rotation)
// for the SPRITE shader: position = view-space offset, uv as three's sprite quad.
export function spriteGeo(sx, sy, cx, cy, rot = 0, geo = null) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const g = geo || new Geo(new Float32Array(12), [], new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), new Uint16Array([0, 1, 2, 0, 2, 3]));
  [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].forEach(([px, py], k) => {
    const x = (px - cx + 0.5) * sx, y = (py - cy + 0.5) * sy;
    g.pos[k * 3] = c * x - s * y; g.pos[k * 3 + 1] = s * x + c * y; g.pos[k * 3 + 2] = 0;
  });
  return g;
}

// A node with children; dispose(false, true) frees materials too, so we always pass false.
export function node(name = 'g', parent = null) {
  const n = new TransformNode(name, ctx.scene);
  if (parent) n.parent = parent;
  return n;
}

// Freezes the world matrices of a static subtree (they never move again).
export function freeze(n) {
  n.computeWorldMatrix(true);
  if (n.getChildMeshes) for (const m of n.getChildMeshes(false)) { m.computeWorldMatrix(true); m.freezeWorldMatrix(); }
  if (n.freezeWorldMatrix) n.freezeWorldMatrix();
  return n;
}

// Disposes a node and its meshes; shared geometry and materials survive.
export function disposeNode(n) {
  if (!n) return;
  if (ctx.shadow) for (const m of n.getChildMeshes ? n.getChildMeshes(false) : []) ctx.shadow.remove(m);
  if (ctx.shadow && n.getClassName?.() === 'Mesh') ctx.shadow.remove(n);
  n.dispose(false, false);
}

// ---------- textures ----------
export const NEAREST_MIP = Texture.NEAREST_LINEAR_MIPLINEAR; // mag nearest, min trilinear
export function canvasTexture(cv, repeat = false, mip = true) {
  const t = new DynamicTexture(`cv${meshId++}`, cv, ctx.scene, mip, mip ? NEAREST_MIP : Texture.NEAREST_SAMPLINGMODE);
  t.wrapU = t.wrapV = repeat ? Texture.WRAP_ADDRESSMODE : Texture.CLAMP_ADDRESSMODE;
  t.anisotropicFilteringLevel = 4;
  t.hasAlpha = true;
  t.update(true, false, true);
  return t;
}

// ---------- the shader ----------
export const NPT = 12; // point light pool size
const VERT = `precision highp float;
attribute vec3 position;
#ifdef NORMAL
attribute vec3 normal;
#endif
#ifdef UV
attribute vec2 uv;
varying vec2 vUV;
#endif
#ifdef VCOLOR
attribute vec4 color;
varying vec3 vColor;
#endif
uniform mat4 world;
#ifdef SPRITE
uniform mat4 view;
uniform mat4 projection;
#else
uniform mat4 viewProjection;
#endif
#ifdef LIT
varying vec3 vPos;
varying vec3 vNormal;
#endif
#ifdef SHADOW
uniform mat4 lightMatrix;
varying vec4 vLight;
#endif
#ifdef DEPTH
varying float vDepth;
#endif
void main() {
#ifdef SPRITE
  // Camera-facing card; position holds the corner offset in view units (x right, y up).
  mat4 mv = view * world;
  vec4 mvPosition = mv * vec4(0.0, 0.0, 0.0, 1.0);
  mvPosition.xy += position.xy;
  gl_Position = projection * mvPosition;
#ifdef FEET
  // Depth as if the figure stood upright at its feet (see view.js).
  vec3 upView = normalize(mv[1].xyz);
  vec4 upright = mvPosition;
  upright.z += position.y * upView.z / max(upView.y, 0.05);
  vec4 uc = projection * upright;
  gl_Position.z = (uc.z / uc.w - 0.001) * gl_Position.w;
#endif
#else
  vec4 wp = world * vec4(position, 1.0);
  gl_Position = viewProjection * wp;
#ifdef LIT
  vPos = wp.xyz;
  vNormal = mat3(world) * normal;
#endif
#ifdef SHADOW
  vLight = lightMatrix * vec4(wp.xyz + normalize(mat3(world) * normal) * 0.03, 1.0);
#endif
#ifdef DEPTH
  vDepth = gl_Position.z / gl_Position.w * 0.5 + 0.5;
#endif
#endif
#ifdef UV
  vUV = uv;
#endif
#ifdef VCOLOR
  vColor = color.rgb;
#endif
#ifdef POINTS
  gl_PointSize = 1.0;
#endif
}`;
const FRAG = `precision highp float;
uniform vec3 uColor;
uniform float uOpacity;
#ifdef UV
varying vec2 vUV;
#endif
#ifdef VCOLOR
varying vec3 vColor;
#endif
#ifdef MAP
uniform sampler2D map;
#endif
#ifdef ALPHATEST
uniform float uAlphaTest;
#endif
#ifdef TINT
uniform vec3 uTint;
#endif
#ifdef LIT
uniform vec3 uEmissive;
uniform vec3 hemiSky;
uniform vec3 hemiGround;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform vec4 ptPos[${NPT}];
uniform vec4 ptCol[${NPT}];
uniform float ptCount;
varying vec3 vPos;
varying vec3 vNormal;
#endif
#ifdef SHADOW
uniform sampler2D shadowMap;
varying vec4 vLight;
float unpackDepth(vec4 v) { return dot(v, vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0)); }
#endif
#ifdef DEPTH
varying float vDepth;
vec4 packDepth(float v) {
  vec4 r = fract(v * vec4(1.0, 255.0, 65025.0, 16581375.0));
  r.xyz -= r.yzw * (1.0 / 255.0);
  return r;
}
#endif
vec3 toLinear(vec3 c) { return mix(pow(c * 0.9478672986 + 0.0521327014, vec3(2.4)), c * 0.0773993808, vec3(lessThanEqual(c, vec3(0.04045)))); }
vec3 toSRGB(vec3 c) { return mix(pow(c, vec3(0.41666)) * 1.055 - vec3(0.055), c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308)))); }
void main() {
#ifdef DEPTH
  gl_FragColor = packDepth(vDepth);
#else
  vec4 diff = vec4(uColor, uOpacity);
#ifdef MAP
  vec4 t = texture2D(map, vUV);
  diff *= vec4(toLinear(t.rgb), t.a);
#endif
#ifdef ALPHATEST
  if (diff.a < uAlphaTest) discard;
#endif
#ifdef VCOLOR
  diff.rgb *= vColor;
#endif
#ifdef TINT
  diff.rgb *= uTint;
#endif
  vec3 outc = diff.rgb;
#ifdef LIT
  vec3 n = normalize(vNormal);
  vec3 irr = mix(hemiGround, hemiSky, 0.5 * n.y + 0.5);
  float sh = 1.0;
#ifdef SHADOW
  vec3 sc = vLight.xyz / vLight.w * 0.5 + 0.5;
  if (sc.x > 0.0 && sc.x < 1.0 && sc.y > 0.0 && sc.y < 1.0 && sc.z < 1.0) {
    if (sc.z - 0.0008 > unpackDepth(texture2D(shadowMap, sc.xy))) sh = 0.0;
  }
#endif
  irr += max(dot(n, sunDir), 0.0) * sunColor * sh;
  for (int i = 0; i < ${NPT}; i++) {
    if (float(i) >= ptCount) break;
    vec3 L = ptPos[i].xyz - vPos;
    float d = length(L);
    float fall = 1.0 / max(pow(d, ptCol[i].w), 0.01);
    float r = d / ptPos[i].w;
    float k = clamp(1.0 - r * r * r * r, 0.0, 1.0);
    irr += max(dot(n, L / max(d, 0.0001)), 0.0) * ptCol[i].rgb * fall * k * k;
  }
  outc = diff.rgb * irr * 0.3183098862 + uEmissive;
#endif
  gl_FragColor = vec4(toSRGB(outc), diff.a);
#endif
}`;

// Per-frame lighting, set by the View. Linear colours, intensities folded in.
export const G = {
  hemiSky: new Color3(), hemiGround: new Color3(), sunDir: new Vector3(0, 1, 0), sunColor: new Color3(),
  ptPos: new Float32Array(NPT * 4), ptCol: new Float32Array(NPT * 4), ptCount: 0,
  tint: new Color3(1, 1, 1), lightMatrix: null, shadowMap: null,
};

function bindGlobals(effect, o) {
  if (effect._tyFrame === ctx.frame) return;
  effect._tyFrame = ctx.frame;
  if (o.lit) {
    effect.setColor3('hemiSky', G.hemiSky); effect.setColor3('hemiGround', G.hemiGround);
    effect.setVector3('sunDir', G.sunDir); effect.setColor3('sunColor', G.sunColor);
    effect.setArray4('ptPos', G.ptPos); effect.setArray4('ptCol', G.ptCol); effect.setFloat('ptCount', G.ptCount);
  }
  if (o.shadow && G.lightMatrix) effect.setMatrix('lightMatrix', G.lightMatrix);
  if (o.tint) effect.setColor3('uTint', G.tint);
}

// opts: { kind: 'lit'|'basic'|'sprite'|'depth', map, color '#hex' or Color3 (linear), vertexColors,
//   emissive, transparent, opacity, alphaTest, doubleSided, depthWrite, depthTest, receive,
//   feet (sprite upright depth), tint (night sprite tint), points, lines }
export class TyMaterial extends ShaderMaterial {
  constructor(opts = {}) {
    const o = { kind: 'lit', opacity: 1, depthWrite: true, depthTest: true, receive: true, ...opts };
    const lit = o.kind === 'lit', sprite = o.kind === 'sprite', depth = o.kind === 'depth';
    const shadow = lit && o.receive && !!ctx.shadow;
    const defines = [];
    const attributes = ['position'];
    if (lit || shadow) { defines.push('#define NORMAL'); attributes.push('normal'); }
    if (lit) defines.push('#define LIT');
    if (shadow) defines.push('#define SHADOW');
    if (o.map) defines.push('#define MAP');
    if (o.map || sprite) { defines.push('#define UV'); attributes.push('uv'); }
    if (o.vertexColors) { defines.push('#define VCOLOR'); attributes.push('color'); }
    if (o.alphaTest) defines.push('#define ALPHATEST');
    if (sprite) defines.push('#define SPRITE');
    if (o.feet) defines.push('#define FEET');
    if (o.tint) defines.push('#define TINT');
    if (o.points) defines.push('#define POINTS');
    if (depth) defines.push('#define DEPTH');
    const uniforms = ['world', 'viewProjection', 'view', 'projection', 'uColor', 'uOpacity', 'uAlphaTest', 'uEmissive', 'uTint',
      'hemiSky', 'hemiGround', 'sunDir', 'sunColor', 'ptPos', 'ptCol', 'ptCount', 'lightMatrix'];
    const samplers = [];
    if (o.map) samplers.push('map');
    if (shadow) samplers.push('shadowMap');
    const transparent = !!o.transparent;
    super(`ty${meshId++}`, ctx.scene, { vertexSource: VERT, fragmentSource: FRAG }, {
      attributes, uniforms, samplers, defines, needAlphaBlending: transparent, needAlphaTesting: !!o.alphaTest,
    });
    this.o = o;
    this._lit = lit;
    // Geometry uses three.js's counter-clockwise front faces.
    this.sideOrientation = Material.CounterClockWiseSideOrientation;
    this.backFaceCulling = !o.doubleSided && !sprite && !o.lines && !o.points;
    if (!o.depthWrite) this.disableDepthWrite = true;
    if (!o.depthTest) this.depthFunction = Engine.ALWAYS;
    if (o.points) this.fillMode = Material.PointListDrawMode;
    if (o.lines) this.fillMode = Material.LineListDrawMode;
    this.color = o.color instanceof Color3 ? o.color.clone() : linear(o.color || '#ffffff');
    this.emissive = o.emissive instanceof Color3 ? o.emissive.clone() : linear(o.emissive || '#000000');
    this.setColor3('uColor', this.color);
    this.setColor3('uEmissive', this.emissive);
    this.setFloat('uOpacity', o.opacity);
    if (o.alphaTest) this.setFloat('uAlphaTest', o.alphaTest);
    if (o.map) this.setTexture('map', o.map);
    if (shadow) this.setTexture('shadowMap', ctx.shadow.map);
    const flags = { lit, shadow, tint: !!o.tint };
    this.onBindObservable.add(() => bindGlobals(this.getEffect(), flags));
  }
  // Uniform changes are picked up on the next bind (the Color3 objects are shared).
  setOpacity(v) { this.o.opacity = v; this.setFloat('uOpacity', v); }
  // A copy with some options changed (build previews).
  cloneWith(over) {
    return new TyMaterial({ ...this.o, color: this.color, emissive: this.emissive, ...over });
  }
}

export function lambert(o = {}) { return new TyMaterial({ kind: 'lit', ...o }); }
export function basic(o = {}) { return new TyMaterial({ kind: 'basic', ...o }); }

// ---------- sun shadows ----------
// One hard-edged shadow map (like three's BasicShadowMap): casters are drawn into a
// depth texture from the sun; receivers compare in the shader. The map is only redrawn
// when the sun's frame moves or a caster changes, not every frame.
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture.js';
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';

export class ShadowMap {
  constructor(size = 2048, half = 22) {
    const scene = ctx.scene;
    ctx.shadow = this;
    const rtt = new RenderTargetTexture('sunShadow', size, scene, false, true, 0, false, Texture.NEAREST_SAMPLINGMODE, true, false);
    rtt.wrapU = rtt.wrapV = Texture.CLAMP_ADDRESSMODE;
    rtt.clearColor = new Color4(1, 1, 1, 1);
    rtt.renderParticles = false; rtt.renderSprites = false;
    rtt.refreshRate = 0; // on demand (resetRefreshCounter)
    const cam = new TargetCamera('sunCam', new Vector3(0, 30, 0), scene, false);
    cam.mode = Camera.ORTHOGRAPHIC_CAMERA;
    cam.orthoLeft = -half; cam.orthoRight = half; cam.orthoTop = half; cam.orthoBottom = -half;
    cam.minZ = 1; cam.maxZ = 80;
    rtt.activeCamera = cam;
    scene.customRenderTargets.push(rtt);
    this.rtt = rtt; this.cam = cam; this.map = rtt;
    // Like three.js, front-side casters draw their back faces into the map (less acne).
    this.mat = new TyMaterial({ kind: 'depth' });
    this.mat.cullBackFaces = false;
    this.key = '';
    this.dirty = true;
    G.shadowMap = rtt;
  }
  add(mesh) { this.rtt.renderList.push(mesh); this.rtt.setMaterialForRendering(mesh, this.mat); this.dirty = true; }
  remove(mesh) {
    const l = this.rtt.renderList, i = l.indexOf(mesh);
    if (i >= 0) { l.splice(i, 1); this.dirty = true; }
  }
  // Sun at `off` from the (snapped) ground point (x, z).
  update(x, z, off) {
    const k = `${x}|${z}`;
    if (k !== this.key) {
      this.key = k;
      this.cam.position.set(x + off[0], off[1], z + off[2]);
      this.cam.setTarget(new Vector3(x, 0, z));
      this.cam.getViewMatrix(true);
      this.cam.getProjectionMatrix(true);
      G.lightMatrix = this.cam.getTransformationMatrix().clone();
      this.dirty = true;
    }
    if (this.dirty) { this.dirty = false; this.rtt.resetRefreshCounter(); }
  }
}

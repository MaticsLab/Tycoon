// In-world weather particles: batches of little quads (rain streaks, splash rings,
// snowflakes, fireflies, falling leaves) that live in world space around the camera.
// Each batch is one mesh whose corners are rewritten on the CPU every frame. They are
// depth-tested against the scene, so a house in front hides the rain behind it, and they
// are drawn into the low-res frame like everything else, so they stay crisp pixels.
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { ctx } from './bjs.js';

const VERT = `precision highp float;
attribute vec3 position;
attribute vec4 color;
attribute vec2 uv;
uniform mat4 viewProjection;
varying vec4 vColor;
varying vec2 vUV;
void main() {
  gl_Position = viewProjection * vec4(position, 1.0);
  vColor = color;
  vUV = uv * 2.0 - 1.0;
}`;
// Shapes: 0 solid, 1 ring (a splash), 2 glow (bright core, faint halo), 3 leaf (an
// ellipse with a darker midrib). Colours are sRGB; uLight dims them with the light.
const FRAG = `precision highp float;
uniform vec3 uLight;
uniform float uShape;
varying vec4 vColor;
varying vec2 vUV;
void main() {
  vec4 c = vColor;
  float r = length(vUV);
  if (uShape > 0.5 && uShape < 1.5) { if (r > 1.0 || r < 0.6) discard; }
  else if (uShape > 1.5 && uShape < 2.5) {
    if (r > 1.0) discard;
    c.a *= r < 0.3 ? 1.0 : r < 0.6 ? 0.55 : 0.2;
  } else if (uShape > 2.5) {
    if (r > 1.0) discard;
    if (abs(vUV.y) < 0.16) c.rgb *= 0.72;
  }
  gl_FragColor = vec4(c.rgb * uLight, c.a);
}`;

export class QuadBatch {
  // shape: 'solid' | 'ring' | 'glow' | 'leaf'; lit: dims with the scene light (false for
  // things that glow on their own).
  constructor(name, cap, shape = 'solid', { order = 6 } = {}) {
    this.cap = cap;
    this.n = 0; this.last = 0;
    this.pos = new Float32Array(cap * 12);
    this.col = new Float32Array(cap * 16);
    const uv = new Float32Array(cap * 8), idx = new Uint32Array(cap * 6);
    for (let i = 0; i < cap; i++) {
      uv.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8);
      const v = i * 4;
      idx.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6);
    }
    const mesh = new Mesh(`wx:${name}`, ctx.scene);
    const vd = new VertexData();
    vd.positions = this.pos; vd.colors = this.col; vd.uvs = uv; vd.indices = idx;
    vd.applyToMesh(mesh, true);
    const mat = new ShaderMaterial(`wxmat:${name}`, ctx.scene, { vertexSource: VERT, fragmentSource: FRAG }, {
      attributes: ['position', 'color', 'uv'], uniforms: ['viewProjection', 'uLight', 'uShape'], needAlphaBlending: true,
    });
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    mat.setFloat('uShape', { solid: 0, ring: 1, glow: 2, leaf: 3 }[shape] || 0);
    this.light = [1, 1, 1];
    mat.setArray3('uLight', this.light);
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.alphaIndex = order;
    mesh.isVisible = false;
    this.mesh = mesh; this.mat = mat;
  }
  begin() { this.n = 0; }
  setLight(r, g, b) { this.light[0] = r; this.light[1] = g; this.light[2] = b; this.mat.setArray3('uLight', this.light); }
  // A quad from four corners (counter-clockwise), with a colour per pair of corners:
  // c0 on the first two (the bottom), c1 on the last two (the top). Colours [r, g, b, a].
  quad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, c0, c1 = c0) {
    if (this.n >= this.cap) return;
    const i = this.n++, p = this.pos, o = i * 12;
    p[o] = ax; p[o + 1] = ay; p[o + 2] = az; p[o + 3] = bx; p[o + 4] = by; p[o + 5] = bz;
    p[o + 6] = cx; p[o + 7] = cy; p[o + 8] = cz; p[o + 9] = dx; p[o + 10] = dy; p[o + 11] = dz;
    const c = this.col, k = i * 16;
    c[k] = c[k + 4] = c0[0]; c[k + 1] = c[k + 5] = c0[1]; c[k + 2] = c[k + 6] = c0[2]; c[k + 3] = c[k + 7] = c0[3];
    c[k + 8] = c[k + 12] = c1[0]; c[k + 9] = c[k + 13] = c1[1]; c[k + 10] = c[k + 14] = c1[2]; c[k + 11] = c[k + 15] = c1[3];
  }
  // A square of half-size (sx, sy) facing the camera (right/up: the camera's axes).
  card(x, y, z, sx, sy, right, up, c, rot = 0) {
    let rx = right.x * sx, ry = right.y * sx, rz = right.z * sx, ux = up.x * sy, uy = up.y * sy, uz = up.z * sy;
    if (rot) {
      const co = Math.cos(rot), si = Math.sin(rot);
      const ax = right.x * co + up.x * si, ay = right.y * co + up.y * si, az = right.z * co + up.z * si;
      const bx = -right.x * si + up.x * co, by = -right.y * si + up.y * co, bz = -right.z * si + up.z * co;
      rx = ax * sx; ry = ay * sx; rz = az * sx; ux = bx * sy; uy = by * sy; uz = bz * sy;
    }
    this.quad(x - rx - ux, y - ry - uy, z - rz - uz, x + rx - ux, y + ry - uy, z + rz - uz,
      x + rx + ux, y + ry + uy, z + rz + uz, x - rx + ux, y - ry + uy, z - rz + uz, c);
  }
  // A flat square lying on the ground (half-size s), turned by rot.
  flat(x, y, z, sx, sz, c, rot = 0) {
    const co = Math.cos(rot), si = Math.sin(rot);
    const ax = co * sx, az = si * sx, bx = -si * sz, bz = co * sz;
    this.quad(x - ax - bx, y, z - az - bz, x + ax - bx, y, z + az - bz, x + ax + bx, y, z + az + bz, x - ax + bx, y, z - az + bz, c);
  }
  end() {
    // Unused quads collapse to nothing.
    if (this.n < this.last) this.pos.fill(0, this.n * 12, this.last * 12);
    const used = Math.max(this.n, this.last);
    this.last = this.n;
    this.mesh.isVisible = this.n > 0;
    if (!used) return;
    this.mesh.updateVerticesData('position', this.pos, false, false);
    this.mesh.updateVerticesData('color', this.col, false, false);
  }
}

// The static village in 3D: terrain (the pixel-art ground painted in sprites.js),
// fences, rocks, trees, the fountain, plaza lamps and the two shops.
import { T, MAP_W, MAP_H, SHOPS, SQUARE, FOUNTAIN, PLAZA_LAMPS, HALL, tileHash } from '@shared/world.js';
import { ITEMS } from '@shared/catalog.js';
import { renderGround, treeSprite, treeKind, objectSprite, r, px, disc } from '../sprites.js';
import { canvasTex, paintTex, wallTex, roofTex, woodTex, stoneTex, signTex, WALL_H } from './textures.js';
export { woodTex };
import { Batch, boxAt, gableRoof } from './geom.js';
import { itemInto, materials, hasModel } from './models.js';
import { goodsBoxes } from './goods.js';
import { Geo, merge, toMesh, node, lambert, basic, plane as planeGeo, cylinder, sphere, freeze } from './bjs.js';

// Builds batches and freezes the result (static scenery never moves).
const buildInto = (batch, grp) => { batch.build(grp, { noCast: materials().glowMat }); return grp; };

export function buildTerrain(world) {
  const cv = renderGround(world, { three: true });
  if (world.season?.winter) snowGround(cv);
  const grp = node('terrain');
  const g = planeGeo(MAP_W, MAP_H).rotateX(-Math.PI / 2).translate(MAP_W / 2, 0, MAP_H / 2);
  toMesh(g, lambert({ map: canvasTex(cv) }), { parent: grp });
  // A dark forest floor beyond the map edge.
  const skirt = planeGeo(MAP_W + 80, MAP_H + 80).rotateX(-Math.PI / 2).translate(MAP_W / 2, -0.02, MAP_H / 2);
  toMesh(skirt, lambert({ color: '#2f5a2a', receive: false }), { parent: grp });
  return freeze(grp);
}

// three.js DodecahedronGeometry(0.34): 20 vertices on the sphere, 36 flat triangles.
const DT = (1 + Math.sqrt(5)) / 2, DR = 1 / DT;
const DODECA_V = [-1, -1, -1, -1, -1, 1, -1, 1, -1, -1, 1, 1, 1, -1, -1, 1, -1, 1, 1, 1, -1, 1, 1, 1,
  0, -DR, -DT, 0, -DR, DT, 0, DR, -DT, 0, DR, DT, -DR, -DT, 0, -DR, DT, 0, DR, -DT, 0, DR, DT, 0, -DT, 0, -DR, DT, 0, -DR, -DT, 0, DR, DT, 0, DR];
const DODECA_I = [3, 11, 7, 3, 7, 15, 3, 15, 13, 7, 19, 17, 7, 17, 6, 7, 6, 15, 17, 4, 8, 17, 8, 10, 17, 10, 6, 8, 0, 16, 8, 16, 2, 8, 2, 10, 0, 12, 1, 0, 1, 18, 0, 18, 16, 6, 10, 2, 6, 2, 13, 6, 13, 15, 2, 16, 18, 2, 18, 3, 2, 3, 13, 18, 1, 9, 18, 9, 11, 18, 11, 3, 4, 14, 12, 4, 12, 0, 4, 0, 8, 11, 9, 5, 11, 5, 19, 11, 19, 7, 19, 5, 14, 19, 14, 4, 19, 4, 17, 1, 12, 14, 1, 14, 5, 1, 5, 9];

export function buildRocks(world) {
  const pos = [], nrm = [], idx = [];
  const unit = [];
  for (let i = 0; i < DODECA_V.length; i += 3) { const l = Math.hypot(DODECA_V[i], DODECA_V[i + 1], DODECA_V[i + 2]); unit.push(DODECA_V[i] / l * 0.34, DODECA_V[i + 1] / l * 0.34, DODECA_V[i + 2] / l * 0.34); }
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    if (world.tiles[y * MAP_W + x] !== T.ROCK) continue;
    const h = tileHash(x, y);
    // Euler XYZ (h*2, h*5, 0) then scale (1.1, 0.7 + 0.3h, 0.9), at (x + 0.5, 0.16, y + 0.55).
    const a = h * 2, b = h * 5, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
    const R = [cb, 0, sb, sa * sb, ca, -sa * cb, -ca * sb, sa, ca * cb];
    const S = [1.1, 0.7 + h * 0.3, 0.9];
    const tv = [];
    for (let i = 0; i < unit.length; i += 3) {
      const vx = unit[i] * S[0], vy = unit[i + 1] * S[1], vz = unit[i + 2] * S[2];
      tv.push(R[0] * vx + R[1] * vy + R[2] * vz + x + 0.5, R[3] * vx + R[4] * vy + R[5] * vz + 0.16, R[6] * vx + R[7] * vy + R[8] * vz + y + 0.55);
    }
    for (let i = 0; i < DODECA_I.length; i += 3) {
      const [p, q, r] = [DODECA_I[i], DODECA_I[i + 1], DODECA_I[i + 2]].map((k) => tv.slice(k * 3, k * 3 + 3));
      const e1 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], e2 = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
      let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const l = Math.hypot(...n) || 1; n = n.map((v) => v / l);
      const o = pos.length / 3;
      pos.push(...p, ...q, ...r); nrm.push(...n, ...n, ...n); idx.push(o, o + 1, o + 2);
    }
  }
  const grp = node('rocks');
  if (pos.length) toMesh(new Geo(pos, nrm, [], idx), lambert({ color: '#8d939b' }), { parent: grp, cast: true });
  return freeze(grp);
}

// Winter: grass under a blanket of snow (roads, paths and water stay as they are).
function snowGround(cv) {
  const g = cv.getContext('2d');
  const img = g.getImageData(0, 0, cv.width, cv.height), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], gr = d[i + 1], b = d[i + 2];
    if (gr > r + 8 && gr > b + 8) {
      const n = ((i * 2654435761) >>> 0) % 7; // a little sparkle
      const v = 226 + n * 4;
      d[i] = (r * 0.12 + v * 0.88) | 0; d[i + 1] = (gr * 0.12 + v * 0.88) | 0; d[i + 2] = (b * 0.1 + 255 * 0.9) | 0;
    }
  }
  g.putImageData(img, 0, 0);
}

// A tree sprite with snow on every upward-facing edge (cached per sprite).
const snowCache = new Map();
function snowy(spr) {
  let out = snowCache.get(spr.cv);
  if (out) return out;
  const cv = document.createElement('canvas');
  cv.width = spr.cv.width; cv.height = spr.cv.height;
  const g = cv.getContext('2d');
  g.drawImage(spr.cv, 0, 0);
  const img = g.getImageData(0, 0, cv.width, cv.height), d = img.data, W = cv.width;
  const solid = (x, y) => y >= 0 && d[(y * W + x) * 4 + 3] > 0;
  const mark = [];
  for (let y = 0; y < cv.height; y++) for (let x = 0; x < W; x++) {
    if (!solid(x, y)) continue;
    const i = (y * W + x) * 4;
    const leafy = d[i + 1] > d[i] * 0.9 || d[i] > 150; // foliage, not trunk
    if (leafy && (!solid(x, y - 1) || !solid(x, y - 2))) mark.push(i);
  }
  for (const i of mark) { d[i] = 238; d[i + 1] = 244; d[i + 2] = 250; }
  g.putImageData(img, 0, 0);
  out = { ...spr, cv };
  snowCache.set(spr.cv, out);
  return out;
}

// Trees as pixel-art billboards. Returns entries for a BillboardSet.
export function treeCards(world, set) {
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    if (world.tiles[y * MAP_W + x] !== T.TREE) continue;
    const v = tileHash(x * 3, y * 7);
    // The town square gets blossom trees.
    const inSquare = x >= SQUARE.x && x < SQUARE.x + SQUARE.w && y >= SQUARE.y && y < SQUARE.y + SQUARE.h;
    let kind = inSquare ? 'blossom' : treeKind(v);
    // In fall, most broadleaf trees turn red, orange or gold.
    if (world.season?.fall && kind !== 'pine') {
      const f = tileHash(x * 11 + 5, y * 3 + 1);
      kind = inSquare ? (f < 0.5 ? 'maple' : 'amber') : f < 0.3 ? 'maple' : f < 0.55 ? 'amber' : f < 0.75 ? 'gold' : kind;
    }
    const spr = world.season?.winter ? snowy(treeSprite(v, kind)) : treeSprite(v, kind);
    // Trees are drawn 1.5x so they tower over houses and villagers.
    set.add(spr, 8, 14, x + 0.5, 0, y + 0.55, { shadow: 1.5, scale: 1.5 });
  }
}

// Fountain in the middle of the plaza (4x4 tiles).
export function buildFountain() {
  const grp = node('fountain');
  const stone = lambert({ map: stoneTex() });
  const light = lambert({ color: '#d3cdbf' });
  const water = lambert({ color: '#4aa2d6', emissive: '#12324a' });
  const parts = new Map();
  const add = (geo, mat, y) => { if (!parts.has(mat)) parts.set(mat, []); parts.get(mat).push(geo.translate(FOUNTAIN.cx, y, FOUNTAIN.cz)); };
  add(cylinder(1.85, 1.95, 0.45, 8), stone, 0.225);
  add(cylinder(1.88, 1.88, 0.06, 8), light, 0.47);
  add(cylinder(1.6, 1.6, 0.05, 8), water, 0.42);
  add(cylinder(0.28, 0.36, 1.2, 8), stone, 0.9);
  add(cylinder(0.75, 0.45, 0.2, 8), light, 1.4);
  add(cylinder(0.62, 0.62, 0.04, 8), water, 1.5);
  add(cylinder(0.1, 0.14, 0.55, 6), stone, 1.75);
  add(sphere(0.16, 8, 6), light, 2.08);
  for (const [mat, list] of parts) toMesh(merge(list), mat, { parent: grp, cast: true });
  return freeze(grp);
}

// Animated water spray particles for the fountain (one low-res pixel each).
export function fountainSpray() {
  const N = 40;
  const pos = new Float32Array(N * 3);
  const mesh = toMesh(new Geo(pos, [], [], Array.from({ length: N }, (_, i) => i)), basic({ color: '#d8f2ff', points: true }), { updatable: true, name: 'spray' });
  mesh.alwaysSelectAsActiveMesh = true;
  mesh.update = (now) => {
    for (let i = 0; i < N; i++) {
      const f = ((now / 1100) + i / N) % 1, ang = i * 2.39;
      pos[i * 3] = FOUNTAIN.cx + Math.cos(ang) * f * 0.7; pos[i * 3 + 1] = 2.1 + Math.sin(f * Math.PI) * 0.5 - f * 0.6; pos[i * 3 + 2] = FOUNTAIN.cz + Math.sin(ang) * f * 0.7;
    }
    mesh.updateVerticesData('position', pos, false, false);
  };
  return mesh;
}

export { PLAZA_LAMPS };
export function buildPlazaLamps() {
  const b = new Batch();
  for (const [x, z] of PLAZA_LAMPS) itemInto(b, 'lamppost', 0, x - 0.5, 0, z - 0.5);
  return freeze(buildInto(b, node('lamps')));
}

// ---------- shops ----------
const facadeTex = (id, w, h, paint) => paintTex(id, w, h, paint, false);

const doorTex = () => facadeTex('shopdoor', 16, 32, (c) => {
  r(c, 0, 0, 16, 32, '#4a2e18'); r(c, 1, 1, 14, 31, '#8a5a32'); r(c, 1, 1, 2, 31, '#a8703f');
  for (const x of [5, 9, 13]) r(c, x, 1, 1, 31, '#6b4424');
  r(c, 3, 4, 10, 8, '#9fd8ef'); r(c, 3, 4, 10, 1, '#6aa8c8'); px(c, 4, 5, '#e2f6ff'); r(c, 12, 18, 2, 2, '#f5c542');
});
const windowTex = (goods) => facadeTex(`shopwin|${goods}`, 24, 18, (c) => {
  r(c, 0, 0, 24, 18, '#6b4424'); r(c, 1, 1, 22, 14, '#9fd8ef'); r(c, 1, 1, 22, 3, '#d7f1fb');
  for (let i = 0; i < 4; i++) px(c, 3 + i, 9 - i, '#e2f6ff');
  r(c, 11, 1, 2, 14, '#6b4424');
  if (goods === 'rosa') { disc(c, 6, 12, 3, 2, '#e33b4a'); disc(c, 18, 12, 3, 2, '#f28a2e'); }
  else { r(c, 4, 9, 5, 6, '#a8703f'); r(c, 16, 7, 4, 8, '#c9a227'); }
  r(c, 0, 15, 24, 3, '#a8703f'); r(c, 0, 15, 24, 1, '#c99363');
});
const awningTex = (a, b) => facadeTex(`awning|${a}`, 16, 8, (c) => {
  for (let i = 0; i < 16; i += 4) r(c, i, 0, 4, 8, (i / 4) % 2 ? b : a);
  r(c, 0, 0, 16, 1, '#ffffff');
});

export function buildShop(shop) {
  const grp = node(`shop:${shop.id}`);
  const b = new Batch();
  const wall = lambert({ map: wallTex(shop.id === 'rosa' ? 'wall_white' : 'wall_wood') });
  const roofM = lambert({ map: roofTex(shop.id === 'rosa' ? 'roof_red' : 'roof_blue') });
  const trim = lambert({ color: '#4a2e18' });
  const found = lambert({ map: stoneTex() });
  const x0 = shop.x + 0.1, x1 = shop.x + shop.w - 0.1, z0 = shop.y + 0.1, z1 = shop.y + shop.h - 0.8; // leave room for goods inside the solid footprint
  b.add(found, boxAt(x0 - 0.05, 0, z0 - 0.05, x1 - x0 + 0.1, 0.25, z1 - z0 + 0.1));
  b.add(wall, boxAt(x0, 0.25, z0, x1 - x0, WALL_H, z1 - z0));
  for (const x of [x0, x1 - 0.12]) b.add(trim, boxAt(x - 0.02, 0.25, z1 - 0.02, 0.14, WALL_H, 0.06));
  gableRoof(b, x0, z0, x1, z1, 0.25 + WALL_H, roofM, wall, trim);
  if (shop.id === 'otto') b.add(found, boxAt(x1 - 1.2, 2.2, z0 + 0.4, 0.55, 2.0, 0.55));
  b.build(grp);

  const zf = z1 + 0.012, cx = (x0 + x1) / 2;
  const plane = (tex, w, h, x, y, z, rotX = 0) => toMesh(planeGeo(w, h).rotateX(rotX).translate(x, y, z), lambert({ map: tex, transparent: true, alphaTest: 0.5 }), { parent: grp });
  plane(doorTex(), 0.95, 1.9, cx, 0.25 + 0.95, zf);
  plane(signTex(shop.name), 2.4, 0.45, cx, 2.35, zf + 0.02);
  for (const wx of [x0 + 0.85, x1 - 0.85]) {
    plane(windowTex(shop.id), 1.3, 0.98, wx, 1.35, zf);
    plane(awningTex(...shop.awning), 1.5, 0.6, wx, 2.0, zf + 0.24, -Math.PI / 3);
  }
  // Goods out front
  const goods = new Batch();
  const crate = lambert({ map: woodTex() });
  if (shop.id === 'rosa') {
    for (const [gx, col] of [[x0 + 0.15, '#f28a2e'], [x1 - 0.95, '#e33b4a']]) {
      goods.add(crate, boxAt(gx, 0, z1 + 0.15, 0.8, 0.45, 0.5));
      const fruit = lambert({ color: col });
      for (let i = 0; i < 4; i++) goods.add(fruit, boxAt(gx + 0.08 + i * 0.18, 0.45, z1 + 0.25, 0.14, 0.12, 0.3));
    }
  } else {
    itemInto(goods, 'chair', 0, x0 + 0.2, 0, z1 + 0.1);
    itemInto(goods, 'dresser', 0, x1 - 1.1, 0, z1 + 0.05);
  }
  buildInto(goods, grp);
  return freeze(grp);
}

// ---------- public props & City Hall ----------
// Decorations in the public places (benches, lamps, Halloween pumpkins...): 3D models,
// pixel cards for scarecrows, plus corn on the fair's corn tiles. Returns { group, lights }.
export function buildDecor(world, cards) {
  const group = node('decor');
  const lights = [];
  // One batch per 16x16-tile chunk: few draw calls, still culled off-screen.
  const chunks = new Map();
  const chunk = (x, y) => { const k = `${Math.floor(x / 16)},${Math.floor(y / 16)}`; if (!chunks.has(k)) chunks.set(k, new Batch()); return chunks.get(k); };
  for (const d of world.decor) {
    const [w, h] = ITEMS[d.t]?.size || [1, 1];
    const [fw, fh] = d.r % 2 ? [h, w] : [w, h];
    if (d.t === 'scarecrow' || !hasModel(d.t)) cards.add(objectSprite(d.t, 0, 0), 8, 14, d.x + fw / 2, 0, d.y + fh - 0.35, { shadow: 0.5 });
    else {
      itemInto(chunk(d.x, d.y), d.t, d.r || 0, d.x, 0, d.y);
      if (d.stock) itemInto(chunk(d.x, d.y), d.t, d.r || 0, d.x, 0, d.y, 0, goodsBoxes(d.t, d.stock));
    }
    if (d.t === 'lamppost') lights.push({ x: d.x + 0.5, y: 2.2, z: d.y + 0.5, kind: 'post' });
    else if (d.t === 'jackolantern') lights.push({ x: d.x + 0.5, y: 0.5, z: d.y + fh / 2 + 0.3, kind: 'pumpkin' });
    else if (d.t === 'cauldron') lights.push({ x: d.x + 0.5, y: 0.9, z: d.y + 0.5, kind: 'cauldron' });
  }
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    if (world.tiles[y * MAP_W + x] === T.CORN) itemInto(chunk(x, y), 'cornstalks', 0, x, 0, y);
  }
  for (const b of chunks.values()) buildInto(b, group);
  return { group: freeze(group), lights };
}

const hallSign = () => signTex('CITY HALL', 80, 18);
const clockTex = () => paintTex('clockface', 16, 16, (c) => {
  disc(c, 8, 8, 7, 7, '#4a2e18'); disc(c, 8, 8, 6, 6, '#f4f1ea');
  for (const [x, y] of [[8, 2], [14, 8], [8, 14], [2, 8]]) px(c, x, y, '#4a2e18');
  r(c, 8, 4, 1, 4, '#2a1a12'); r(c, 8, 8, 3, 1, '#2a1a12');
}, false);

// A two-storey stone hall with a white portico, a clock tower and the town flag.
export function buildCityHall() {
  const grp = node('cityhall');
  const b = new Batch();
  const stone = lambert({ map: wallTex('wall_stone') });
  const plaster = lambert({ map: wallTex('wall_white') });
  const roofM = lambert({ map: roofTex('roof_blue') });
  const trim = lambert({ color: '#4a2e18' });
  const white = lambert({ color: '#f4f1ea' });
  const found = lambert({ map: stoneTex() });
  const x0 = HALL.x + 0.2, x1 = HALL.x + HALL.w - 0.2, z0 = HALL.y + 0.2, z1 = HALL.y + HALL.h - 1.6;
  const H = WALL_H * 2;
  b.add(found, boxAt(x0 - 0.1, 0, z0 - 0.1, x1 - x0 + 0.2, 0.3, z1 - z0 + 0.2));
  b.add(stone, boxAt(x0, 0.3, z0, x1 - x0, WALL_H, z1 - z0));
  b.add(plaster, boxAt(x0, 0.3 + WALL_H, z0, x1 - x0, WALL_H, z1 - z0));
  b.add(trim, boxAt(x0 - 0.05, 0.3 + WALL_H - 0.08, z0 - 0.05, x1 - x0 + 0.1, 0.16, z1 - z0 + 0.1));
  gableRoof(b, x0, z0, x1, z1, 0.3 + H, roofM, plaster, trim);
  // Portico: steps, six columns and a pediment over the doors.
  const cx = (x0 + x1) / 2, pw = 6;
  for (let i = 0; i < 3; i++) b.add(found, boxAt(cx - pw / 2 - 0.3 + i * 0.15, 0, z1 + 1.3 - i * 0.4, pw + 0.6 - i * 0.3, 0.12 + i * 0.1, 0.45));
  b.add(white, boxAt(cx - pw / 2, 0.3, z1, pw, 0.1, 1.3));
  for (let i = 0; i < 6; i++) b.add(white, boxAt(cx - pw / 2 + 0.15 + i * (pw - 0.45) / 5, 0.4, z1 + 0.95, 0.3, H - 0.2, 0.3));
  b.add(white, boxAt(cx - pw / 2 - 0.1, 0.2 + H, z1 - 0.05, pw + 0.2, 0.3, 1.45));
  b.add(trim, boxAt(cx - pw / 2 - 0.1, 0.5 + H, z1 - 0.05, pw + 0.2, 0.06, 1.45));
  // Clock tower
  const tx = cx - 0.9, tz = z0 + 0.8;
  b.add(plaster, boxAt(tx, 0.3 + H, tz, 1.8, 2.4, 1.8));
  b.add(trim, boxAt(tx - 0.08, 2.7 + H, tz - 0.08, 1.96, 0.12, 1.96));
  for (let i = 0; i < 4; i++) b.add(roofM, boxAt(tx - 0.1 + i * 0.25, 2.82 + H + i * 0.35, tz - 0.1 + i * 0.25, 2.0 - i * 0.5, 0.35, 2.0 - i * 0.5));
  b.build(grp);
  const plane = (tex, w, h, x, y, z) => toMesh(planeGeo(w, h).translate(x, y, z), lambert({ map: tex, transparent: true, alphaTest: 0.5 }), { parent: grp });
  plane(clockTex(), 1.2, 1.2, cx, 1.6 + H, tz + 1.81);
  plane(hallSign(), 3.4, 0.7, cx, 0.35 + H, z1 + 1.41);
  // Doors and windows on the front wall
  const door = paintTex('halldoor', 16, 24, (c) => {
    r(c, 0, 0, 16, 24, '#4a2e18'); r(c, 1, 1, 6, 23, '#7a4a28'); r(c, 9, 1, 6, 23, '#7a4a28'); r(c, 2, 2, 4, 8, '#9fd8ef'); r(c, 10, 2, 4, 8, '#9fd8ef'); px(c, 7, 13, '#f5c542'); px(c, 8, 13, '#f5c542');
  }, false);
  plane(door, 1.4, 2.0, cx, 1.3, z1 + 0.012);
  const win = paintTex('hallwin', 12, 16, (c) => {
    r(c, 0, 0, 12, 16, '#f4f1ea'); r(c, 1, 1, 10, 14, '#7fb8d8'); r(c, 1, 1, 10, 4, '#b6e0f2'); r(c, 5, 1, 2, 14, '#f4f1ea'); r(c, 1, 7, 10, 2, '#f4f1ea');
  }, false);
  for (let i = 0; i < 4; i++) {
    const wx = i < 2 ? x0 + 0.9 + i * 1.6 : x1 - 0.9 - (i - 2) * 1.6;
    for (const wy of [1.5, 1.5 + WALL_H]) plane(win, 0.9, 1.2, wx, wy, z1 + 0.012);
  }
  return freeze(grp);
}

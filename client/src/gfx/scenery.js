// The static village in 3D: terrain (the pixel-art ground painted in sprites.js),
// fences, rocks, trees, the fountain, plaza lamps and the two shops.
import * as THREE from 'three';
import { T, MAP_W, MAP_H, SHOPS, SQUARE, FOUNTAIN, PLAZA_LAMPS, HALL, tileHash } from '@shared/world.js';
import { ITEMS } from '@shared/catalog.js';
import { renderGround, treeSprite, treeKind, objectSprite, r, px, disc } from '../sprites.js';
import { canvasTex, paintTex, wallTex, roofTex, woodTex, stoneTex, signTex, WALL_H } from './textures.js';
export { woodTex };
import { Batch, boxAt, gableRoof } from './geom.js';
import { makeItem } from './models.js';

const lambert = (opts) => new THREE.MeshLambertMaterial(opts);

export function buildTerrain(world) {
  const cv = renderGround(world, { three: true });
  const mat = lambert({ map: canvasTex(cv) });
  const g = new THREE.PlaneGeometry(MAP_W, MAP_H);
  g.rotateX(-Math.PI / 2);
  g.translate(MAP_W / 2, 0, MAP_H / 2);
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  // A dark forest floor beyond the map edge.
  const skirt = new THREE.Mesh(new THREE.PlaneGeometry(MAP_W + 80, MAP_H + 80).rotateX(-Math.PI / 2).translate(MAP_W / 2, -0.02, MAP_H / 2), lambert({ color: '#2f5a2a' }));
  const grp = new THREE.Group();
  grp.add(mesh, skirt);
  return grp;
}

export function buildRocks(world) {
  const list = [];
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) if (world.tiles[y * MAP_W + x] === T.ROCK) list.push([x, y]);
  const geo = new THREE.DodecahedronGeometry(0.34, 0);
  const mat = lambert({ color: '#8d939b', flatShading: true });
  const mesh = new THREE.InstancedMesh(geo, mat, list.length);
  const m = new THREE.Matrix4();
  list.forEach(([x, y], i) => {
    const h = tileHash(x, y);
    m.compose(new THREE.Vector3(x + 0.5, 0.16, y + 0.55), new THREE.Quaternion().setFromEuler(new THREE.Euler(h * 2, h * 5, 0)), new THREE.Vector3(1.1, 0.7 + h * 0.3, 0.9));
    mesh.setMatrixAt(i, m);
  });
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
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
    const spr = treeSprite(v, kind);
    // Trees are drawn 1.5x so they tower over houses and villagers.
    set.add(spr, 8, 14, x + 0.5, 0, y + 0.55, { shadow: 1.5, scale: 1.5 });
  }
}

// Fountain in the middle of the plaza (4x4 tiles).
export function buildFountain() {
  const grp = new THREE.Group();
  const stone = lambert({ map: stoneTex() });
  const light = lambert({ color: '#d3cdbf' });
  const water = lambert({ color: '#4aa2d6', emissive: '#12324a' });
  const add = (geo, mat, y) => { const m = new THREE.Mesh(geo, mat); m.position.set(FOUNTAIN.cx, y, FOUNTAIN.cz); m.castShadow = true; m.receiveShadow = true; grp.add(m); return m; };
  add(new THREE.CylinderGeometry(1.85, 1.95, 0.45, 8), stone, 0.225);
  add(new THREE.CylinderGeometry(1.88, 1.88, 0.06, 8), light, 0.47);
  add(new THREE.CylinderGeometry(1.6, 1.6, 0.05, 8), water, 0.42);
  add(new THREE.CylinderGeometry(0.28, 0.36, 1.2, 8), stone, 0.9);
  add(new THREE.CylinderGeometry(0.75, 0.45, 0.2, 8), light, 1.4);
  add(new THREE.CylinderGeometry(0.62, 0.62, 0.04, 8), water, 1.5);
  add(new THREE.CylinderGeometry(0.1, 0.14, 0.55, 6), stone, 1.75);
  add(new THREE.SphereGeometry(0.16, 8, 6), light, 2.08);
  return grp;
}

// Animated water spray particles for the fountain.
export function fountainSpray() {
  const N = 40;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#d8f2ff', size: 0.09 }));
  pts.update = (now) => {
    const a = geo.attributes.position;
    for (let i = 0; i < N; i++) {
      const f = ((now / 1100) + i / N) % 1, ang = i * 2.39;
      a.setXYZ(i, FOUNTAIN.cx + Math.cos(ang) * f * 0.7, 2.1 + Math.sin(f * Math.PI) * 0.5 - f * 0.6, FOUNTAIN.cz + Math.sin(ang) * f * 0.7);
    }
    a.needsUpdate = true;
  };
  return pts;
}

export { PLAZA_LAMPS };
export function buildPlazaLamps() {
  const grp = new THREE.Group();
  for (const [x, z] of PLAZA_LAMPS) grp.add(makeItem('lamppost', 0, x - 0.5, 0, z - 0.5));
  return grp;
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
  const grp = new THREE.Group();
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
  const plane = (tex, w, h, x, y, z, rotX = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), lambert({ map: tex, transparent: true, alphaTest: 0.5 }));
    m.position.set(x, y, z); m.rotation.x = rotX; m.receiveShadow = true;
    grp.add(m); return m;
  };
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
    grp.add(makeItem('chair', 0, x0 + 0.2, 0, z1 + 0.1));
    grp.add(makeItem('dresser', 0, x1 - 1.1, 0, z1 + 0.05));
  }
  goods.build(grp);
  return grp;
}

// ---------- public props & City Hall ----------
// Decorations in the public places (benches, lamps, Halloween pumpkins...): 3D models,
// pixel cards for scarecrows, plus corn on the fair's corn tiles. Returns { group, lights }.
export function buildDecor(world, cards) {
  const group = new THREE.Group();
  const lights = [];
  for (const d of world.decor) {
    const [w, h] = ITEMS[d.t]?.size || [1, 1];
    const [fw, fh] = d.r % 2 ? [h, w] : [w, h];
    if (d.t === 'scarecrow') cards.add(objectSprite('scarecrow', 0, 0), 8, 14, d.x + 0.5, 0, d.y + 0.65, { shadow: 0.5 });
    else group.add(makeItem(d.t, d.r || 0, d.x, 0, d.y));
    if (d.t === 'lamppost') lights.push({ x: d.x + 0.5, y: 2.2, z: d.y + 0.5, kind: 'post' });
    else if (d.t === 'jackolantern') lights.push({ x: d.x + 0.5, y: 0.5, z: d.y + fh / 2 + 0.3, kind: 'pumpkin' });
    else if (d.t === 'cauldron') lights.push({ x: d.x + 0.5, y: 0.9, z: d.y + 0.5, kind: 'cauldron' });
  }
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    if (world.tiles[y * MAP_W + x] === T.CORN) group.add(makeItem('cornstalks', 0, x, 0, y));
  }
  return { group, lights };
}

const hallSign = () => signTex('CITY HALL', 80, 18);
const clockTex = () => paintTex('clockface', 16, 16, (c) => {
  disc(c, 8, 8, 7, 7, '#4a2e18'); disc(c, 8, 8, 6, 6, '#f4f1ea');
  for (const [x, y] of [[8, 2], [14, 8], [8, 14], [2, 8]]) px(c, x, y, '#4a2e18');
  r(c, 8, 4, 1, 4, '#2a1a12'); r(c, 8, 8, 3, 1, '#2a1a12');
}, false);

// A two-storey stone hall with a white portico, a clock tower and the town flag.
export function buildCityHall() {
  const grp = new THREE.Group();
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
  const plane = (tex, w, h, x, y, z) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), lambert({ map: tex, transparent: true, alphaTest: 0.5 }));
    m.position.set(x, y, z); m.receiveShadow = true; grp.add(m); return m;
  };
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
  return grp;
}

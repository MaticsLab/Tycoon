// The 3D view. Renders at a low resolution and scales up with sharp pixels so the
// world keeps its pixel-art look (HD-2D style). An isometric orthographic camera
// turns in 90° steps (Q/E or the ⟲ ⟳ buttons) and zooms; the sun casts blocky
// shadows; at night lamps, fireplaces and windows light up.
import * as THREE from 'three';
import { MAP_W, MAP_H, SHOPS, FOUNTAIN } from '@shared/world.js';
import { personSprite } from '../people.js';
import { petSprite } from '../pets.js';
import { sanitizeLook } from '@shared/look.js';
import { BillboardSet, texOf, blobMesh } from './billboards.js';
import { buildTerrain, buildRocks, treeCards, buildFountain, fountainSpray, buildPlazaLamps, PLAZA_LAMPS, buildShop, buildDecor, buildCityHall } from './scenery.js';
import { buildPlot, glassMat, LEVEL_H } from './houses.js';
import { TEXEL } from './textures.js';

const ELEV = 0.62; // camera pitch (radians)
const DIR_VEC = [[0, 1], [0, -1], [-1, 0], [1, 0]]; // world dir 0..3 -> (x, z)
// Villagers are drawn at 80% so they stand ~1.5 tiles tall: a bit shorter than a
// doorway (2.05) and well under a wall (2.5), like a person in a Sims house.
export const PERSON_SCALE = 0.8;

export class View {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.world = world;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#2a4f2c');
    this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 300);
    this.yaw = Math.PI / 4;   // camera heading (free orbit)
    this.yawGoal = this.yaw;  // Q/E and the ⟲ ⟳ buttons glide here in 90° steps
    this.pitch = ELEV;        // camera tilt
    this.offset = new THREE.Vector3(); // free-look pan away from the followed point
    this.basisVersion = 0; this.builtVersion = 0; this.lastCardBuild = 0;
    this.zoom = 15; // world units visible across the shorter side
    this.target = new THREE.Vector3(FOUNTAIN.cx, 0, FOUNTAIN.cz + 4);
    this.goal = this.target.clone();

    // Lighting
    this.hemi = new THREE.HemisphereLight('#dff0ff', '#6f8f4a', 1.6);
    this.sun = new THREE.DirectionalLight('#fff1d6', 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 1; sc.far = 80;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.pool = Array.from({ length: 12 }, () => {
      const l = new THREE.PointLight('#ffc878', 0, 7, 1.4);
      this.scene.add(l);
      return l;
    });

    // Static scenery
    this.terrain = buildTerrain(world);
    this.terrainRoads = world.roadsVersion;
    this.scene.add(this.terrain, buildRocks(world), buildFountain(), buildPlazaLamps(), buildCityHall());
    for (const shop of SHOPS) this.scene.add(buildShop(shop));
    this.spray = fountainSpray();
    this.scene.add(this.spray);
    this.trees = new BillboardSet();
    treeCards(world, this.trees);
    const decor = buildDecor(world, this.trees);
    this.scene.add(this.trees.group, decor.group);
    this.staticLights = [
      ...decor.lights,
      ...PLAZA_LAMPS.map(([x, z]) => ({ x, y: 2.2, z, kind: 'post' })),
      ...SHOPS.flatMap((s) => [{ x: s.x + 0.95, y: 1.4, z: s.y + s.h - 0.3, kind: 'window' }, { x: s.x + s.w - 0.95, y: 1.4, z: s.y + s.h - 0.3, kind: 'window' }]),
    ];

    this.plots = new Map(); // id -> { group, cards, lights, sig }
    this.actors = new Map(); // id -> { sprite, blob, vec }
    this.blobGroup = new THREE.Group();
    this.scene.add(this.blobGroup);
    this.raycaster = new THREE.Raycaster();
    this.resize();
    this.applyCamera(true);
  }

  // ---------- camera ----------
  get theta() { return this.yaw; }
  // Which of the four diagonal views we're closest to (cutaway is decided per quadrant).
  get quadrant() { return ((Math.round((this.yaw - Math.PI / 4) / (Math.PI / 2)) % 4) + 4) % 4; }
  basis() {
    const t = this.theta, c = Math.cos(this.pitch), s = Math.sin(this.pitch);
    return {
      right: new THREE.Vector3(Math.cos(t), 0, -Math.sin(t)),
      up: new THREE.Vector3(-Math.sin(t) * s, c, -Math.cos(t) * s),
      back: new THREE.Vector3(Math.sin(t) * c, s, Math.cos(t) * c),
    };
  }
  // Ground directions for movement: forward = away from the camera.
  ground() {
    const t = this.theta;
    return { fx: -Math.sin(t), fz: -Math.cos(t), rx: Math.cos(t), rz: -Math.sin(t) };
  }

  // Glide to the next 90° view.
  rotate(d) {
    this.yawGoal = Math.round((this.yawGoal - Math.PI / 4) / (Math.PI / 2)) * (Math.PI / 2) + Math.PI / 4 + d * (Math.PI / 2);
  }

  // Free orbit (middle-mouse drag / two-finger twist): turn and tilt.
  orbit(dYaw, dPitch) {
    this.yaw += dYaw;
    this.yawGoal = this.yaw;
    this.pitch = Math.max(0.3, Math.min(1.3, this.pitch + dPitch));
    this.basisVersion++;
  }

  // Pixel-art cards face the camera; rebuild them (throttled) when the view turns.
  updateCards(now, force) {
    if (this.builtVersion === this.basisVersion && !force) return;
    if (!force && now - this.lastCardBuild < 90) return;
    const b = this.basis();
    this.trees.build(b);
    for (const p of this.plots.values()) p.cards.build(b);
    this.builtVersion = this.basisVersion;
    this.lastCardBuild = now;
  }

  zoomBy(f) { this.zoom = Math.max(6, Math.min(this.maxZoom || 40, this.zoom * f)); this.resize(); }

  setTarget(x, z, snap = false, y = 0) {
    this.goal.set(x, y, z);
    if (snap) this.target.copy(this.goal);
  }

  resize() {
    const cssW = this.canvas.clientWidth || innerWidth, cssH = this.canvas.clientHeight || innerHeight;
    const dpr = Math.min(devicePixelRatio || 1, 3);
    // Aim for ~320 low-res pixels on the short side.
    this.pixel = Math.max(1, Math.round((Math.min(cssW, cssH) * dpr) / 320));
    const w = Math.max(1, Math.floor((cssW * dpr) / this.pixel)), h = Math.max(1, Math.floor((cssH * dpr) / this.pixel));
    this.renderer.setSize(w, h, false);
    // `zoom` is how many world units fit across the screen's shorter side.
    const aspect = w / h;
    const halfH = aspect >= 1 ? this.zoom / 2 : this.zoom / 2 / aspect, halfW = halfH * aspect;
    this.camera.top = halfH; this.camera.bottom = -halfH;
    this.camera.left = -halfW; this.camera.right = halfW;
    this.camera.updateProjectionMatrix();
  }

  applyCamera(first) {
    const { back, right, up } = this.basis();
    // Snap the view to whole low-res pixels so the world moves in clean pixel steps
    // instead of crawling (which shimmers like static when zoomed out).
    const unit = (this.camera.top - this.camera.bottom) / this.renderer.domElement.height;
    const eye = this.target.clone();
    const a = eye.dot(right), b = eye.dot(up);
    eye.addScaledVector(right, Math.round(a / unit) * unit - a).addScaledVector(up, Math.round(b / unit) * unit - b);
    this.camera.position.copy(eye).addScaledVector(back, 80);
    this.camera.lookAt(eye);
    this.camera.updateMatrixWorld();
    if (first) this.trees.build(this.basis());
    this.sun.position.set(this.target.x - 14, 26, this.target.z + 8);
    this.sun.target.position.copy(this.target);
  }

  // ---------- picking ----------
  // World point under a screen position, on the horizontal plane at height y.
  pick(clientX, clientY, y = 0) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), hit) ? { x: hit.x, z: hit.z } : null;
  }

  // CSS pixel position of a world point.
  toScreen(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  // Repaint the ground after the road layout changed.
  refreshTerrain() {
    if (this.terrainRoads === this.world.roadsVersion) return;
    this.terrainRoads = this.world.roadsVersion;
    this.scene.remove(this.terrain);
    this.terrain.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); });
    this.terrain = buildTerrain(this.world);
    this.scene.add(this.terrain);
  }

  // ---------- plots ----------
  // state: a live plot (with its own x, y, w, h). opts: { cut: 'up'|'cut'|'down', maxLevel, roofs, now }
  setPlot(state, opts) {
    const g = this.ground();
    const sig = JSON.stringify([state, opts.cut, opts.maxLevel, opts.roofs, opts.crops, this.quadrant, opts.entrance]);
    let p = this.plots.get(state.id);
    if (p && p.sig === sig) return;
    this.removePlot(state.id);
    const cards = new BillboardSet();
    const built = buildPlot(state, { cut: { mode: opts.cut, fx: g.fx, fz: g.fz }, maxLevel: opts.maxLevel, roofs: opts.roofs, cards, now: opts.now, entrance: opts.entrance });
    cards.build(this.basis());
    p = { group: built.group, cards, lights: built.lights, sig };
    this.plots.set(state.id, p);
    this.scene.add(p.group, p.cards.group);
  }

  removePlot(id) {
    const p = this.plots.get(id);
    if (!p) return;
    this.scene.remove(p.group, p.cards.group);
    disposeGroup(p.group);
    this.plots.delete(id);
  }

  // ---------- actors (players, NPCs and pets as pixel sprites) ----------
  // pet: { idx, sit } draws a pet instead of a villager.
  actor(id, x, z, dirWorld, moving, look, now, vis = true, y = 0, pet = null) {
    let a = this.actors.get(id);
    if (!a) {
      a = { sprite: new THREE.Sprite(), blob: null, vec: [0, 1], lx: x, lz: z, lookRef: null, look: null };
      a.sprite.renderOrder = 1;
      a.blob = blobMesh([[0, 0, 0, pet ? 0.26 : 0.36]]);
      this.scene.add(a.sprite);
      this.blobGroup.add(a.blob);
      this.actors.set(id, a);
    }
    a.seen = true;
    a.sprite.visible = a.blob.visible = vis;
    // Facing comes from actual motion when there is any, else the reported direction.
    const mx = x - a.lx, mz = z - a.lz;
    if (Math.hypot(mx, mz) > 0.004) a.vec = [mx, mz];
    else if (!moving && dirWorld != null && a.dirWorld !== dirWorld) a.vec = DIR_VEC[dirWorld];
    a.dirWorld = dirWorld;
    a.lx = x; a.lz = z;
    const g = this.ground();
    const along = a.vec[0] * g.rx + a.vec[1] * g.rz, away = a.vec[0] * g.fx + a.vec[1] * g.fz;
    const dir = Math.abs(along) > Math.abs(away) * 1.05 ? (along > 0 ? 3 : 2) : away > 0 ? 1 : 0;
    const frame = moving ? Math.floor(now / (pet ? 100 : 130)) % 4 : 0;
    let spr;
    if (pet) spr = petSprite(pet.idx, dir, frame, pet.sit);
    else {
      if (a.lookRef !== look) { a.lookRef = look; a.look = sanitizeLook(look); }
      spr = personSprite(a.look, dir, frame);
    }
    const tex = texOf(spr.cv);
    if (a.sprite.material.map !== tex) {
      a.sprite.material = spriteMat(tex);
      a.sprite.center.set(-spr.dx / spr.cv.width, 1 + spr.dy / spr.cv.height);
      a.sprite.scale.set((spr.cv.width / TEXEL) * PERSON_SCALE, (spr.cv.height / TEXEL) * PERSON_SCALE, 1);
    }
    a.sprite.position.set(x, y, z);
    a.blob.position.set(x, y, z);
  }

  pruneActors() {
    for (const [id, a] of this.actors) {
      if (!a.seen) { this.scene.remove(a.sprite); this.blobGroup.remove(a.blob); this.actors.delete(id); }
      a.seen = false;
    }
  }

  // ---------- frame ----------
  // dark: 0 (day) .. ~0.62 (night)
  render(now, dark, follow) {
    if (Math.abs(this.yawGoal - this.yaw) > 0.0005) { this.yaw += (this.yawGoal - this.yaw) * 0.2; this.basisVersion++; }
    this.updateCards(now);
    this.target.lerp(this.goal.clone().add(this.offset), follow ? 0.18 : 0.25);
    this.applyCamera(false);
    const night = Math.min(1, dark / 0.62);
    this.sun.intensity = 2.4 * (1 - night * 0.88);
    this.sun.color.setHSL(0.1 - night * 0.45, 0.55, 0.85 - night * 0.2);
    this.hemi.intensity = 1.6 - night * 1.05;
    this.hemi.color.set(night > 0.5 ? '#7d8fd6' : '#dff0ff');
    const tint = 1 - night * 0.55;
    for (const m of spriteMats.values()) m.color.setRGB(tint, tint, Math.min(1, tint + night * 0.15));
    glassMat().emissive.setRGB(night * 0.9, night * 0.7, night * 0.3);
    // Night light pool: nearest light sources to the camera target.
    const all = [...this.staticLights];
    for (const p of this.plots.values()) all.push(...p.lights);
    const tx = this.target.x, tz = this.target.z;
    all.sort((a, b) => (a.x - tx) ** 2 + (a.z - tz) ** 2 - ((b.x - tx) ** 2 + (b.z - tz) ** 2));
    this.pool.forEach((l, i) => {
      const s = all[i];
      if (!s || night < 0.05) { l.intensity = 0; return; }
      l.position.set(s.x, s.y, s.z);
      l.intensity = night * (s.kind === 'post' ? 9 : s.kind === 'fire' ? 7 : s.kind === 'window' ? 4 : s.kind === 'pumpkin' ? 4 : 6);
      l.color.set(s.kind === 'fire' || s.kind === 'pumpkin' ? '#ff9a4a' : s.kind === 'cauldron' ? '#8aff6a' : '#ffd08a');
      l.distance = s.kind === 'post' ? 8 : s.kind === 'pumpkin' ? 4 : 6;
    });
    this.spray.update(now);
    this.renderer.render(this.scene, this.camera);
  }
}

const spriteMats = new Map();
function spriteMat(tex) {
  let m = spriteMats.get(tex);
  if (!m) { m = new THREE.SpriteMaterial({ map: tex, alphaTest: 0.5 }); spriteMats.set(tex, m); }
  return m;
}

function disposeGroup(g) {
  g.traverse((o) => { if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose(); });
}

export { LEVEL_H, MAP_W, MAP_H };

// The 3D view (Babylon.js). Renders at a low resolution and scales up with sharp pixels
// so the world keeps its pixel-art look (HD-2D style). An isometric orthographic camera
// turns in 90° steps (Q/E or the ⟲ ⟳ buttons) and zooms; the sun casts blocky
// shadows; at night lamps, fireplaces and windows light up.
import { TargetCamera } from '@babylonjs/core/Cameras/targetCamera.js';
import { Camera } from '@babylonjs/core/Cameras/camera.js';
import { MAP_W, MAP_H, SHOPS, FOUNTAIN } from '@shared/world.js';
import { personSprite, sleeperSprite } from '../people.js';
import { petSprite } from '../pets.js';
import { animalSprite } from '../animals.js';
import { sanitizeLook } from '@shared/look.js';
import { BillboardSet, texOf, blobMesh } from './billboards.js';
import { buildTerrain, buildRocks, treeCards, buildFountain, fountainSpray, buildPlazaLamps, PLAZA_LAMPS, buildShop, buildDecor, buildCityHall } from './scenery.js';
import { buildPlot, glassMat, LEVEL_H } from './houses.js';
import { makeItem } from './models.js';
import { TEXEL } from './textures.js';
import { createScene, ctx, G, NPT, ShadowMap, TyMaterial, Vector3, Color4, Geo, toMesh, spriteGeo, disposeNode, freeze, linear, linearRGB, linearHSL, canvasTexture } from './bjs.js';

const ELEV = 0.62; // camera pitch (radians)
const DIR_VEC = [[0, 1], [0, -1], [-1, 0], [1, 0]]; // world dir 0..3 -> (x, z)
// Villagers are drawn at 80% so they stand ~1.5 tiles tall: a bit shorter than a
// doorway (2.05) and well under a wall (2.5), like a person in a Sims house.
export const PERSON_SCALE = 0.8;
const SUN_OFF = [-14, 26, 8]; // sun position relative to the point it lights
const SUN_DIR = (() => { const l = Math.hypot(...SUN_OFF); return new Vector3(SUN_OFF[0] / l, SUN_OFF[1] / l, SUN_OFF[2] / l); })();
const HEMI_GROUND = linear('#6f8f4a'), HEMI_DAY = linear('#dff0ff'), HEMI_NIGHT = linear('#7d8fd6');
const LIGHT_KIND = {
  post: { i: 9, c: linearRGB('#ffd08a'), d: 8 }, fire: { i: 7, c: linearRGB('#ff9a4a'), d: 6 }, window: { i: 4, c: linearRGB('#ffd08a'), d: 6 },
  pumpkin: { i: 4, c: linearRGB('#ff9a4a'), d: 4 }, cauldron: { i: 6, c: linearRGB('#8aff6a'), d: 6 }, lamp: { i: 6, c: linearRGB('#ffd08a'), d: 6 },
};

// three.js-style vector helpers the game code relies on (copy / multiplyScalar).
class Vec3 extends Vector3 {
  copy(v) { return this.copyFrom(v); }
  multiplyScalar(s) { return this.scaleInPlace(s); }
  clone() { return new Vec3(this.x, this.y, this.z); }
}

export class View {
  constructor(canvas, world) {
    this.canvas = canvas;
    this.world = world;
    const { engine, scene } = createScene(canvas);
    this.engine = engine;
    this.scene = scene;
    scene.clearColor = Color4.FromHexString('#2a4f2cff');
    this.camera = new TargetCamera('cam', new Vector3(0, 80, 0), scene, true);
    this.camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    this.camera.minZ = 0.1; this.camera.maxZ = 300;
    this.yaw = Math.PI / 4;   // camera heading (free orbit)
    this.yawGoal = this.yaw;  // Q/E and the ⟲ ⟳ buttons glide here in 90° steps
    this.pitch = ELEV;        // camera tilt
    this.offset = new Vec3(); // free-look pan away from the followed point
    this.basisVersion = 0; this.builtVersion = 0; this.lastCardBuild = 0;
    this.zoom = 15; // world units visible across the shorter side
    this.target = new Vec3(FOUNTAIN.cx, 0, FOUNTAIN.cz + 4);
    this.goal = this.target.clone();
    this.eye = new Vector3();
    this._want = new Vector3();
    this._b = { right: new Vector3(), up: new Vector3(), back: new Vector3() };

    // Lighting: sun shadows (the light values themselves are shader globals, see render)
    this.shadow = new ShadowMap(2048, 22);
    this.lightList = [];

    // Static scenery
    this.terrain = buildTerrain(world);
    this.terrainRoads = world.roadsVersion;
    this.rocks = buildRocks(world); buildFountain(); buildPlazaLamps(); buildCityHall();
    this.spray = fountainSpray();
    this.trees = new BillboardSet();
    this.treeSet = new BillboardSet(); // trees alone, rebuilt when the season changes
    treeCards(world, this.treeSet);
    const decor = buildDecor(world, this.trees);
    this.staticLights = [
      ...decor.lights,
      ...PLAZA_LAMPS.map(([x, z]) => ({ x, y: 2.2, z, kind: 'post' })),
      // The village shops glow warmly through their windows at night.
      ...SHOPS.flatMap((s) => [{ x: s.x + 1.5, y: 1.6, z: s.y + s.h - 1.2, kind: 'window' }, { x: s.x + s.w - 1.5, y: 1.6, z: s.y + s.h - 1.2, kind: 'window' }]),
    ];

    this.plots = new Map(); // id -> { group, cards, lights, sig }
    this.actors = new Map(); // id -> { sprite, blob, vec }
    this.vehicles = new Map(); // id -> { node, yaw, lx, lz }
    this.resize();
    this.applyCamera(true);
  }

  // ---------- camera ----------
  get theta() { return this.yaw; }
  // Which of the four diagonal views we're closest to (cutaway is decided per quadrant).
  get quadrant() { return ((Math.round((this.yaw - Math.PI / 4) / (Math.PI / 2)) % 4) + 4) % 4; }
  basis(out = null) {
    const t = this.theta, c = Math.cos(this.pitch), s = Math.sin(this.pitch);
    const b = out || { right: new Vector3(), up: new Vector3(), back: new Vector3() };
    b.right.set(Math.cos(t), 0, -Math.sin(t));
    b.up.set(-Math.sin(t) * s, c, -Math.cos(t) * s);
    b.back.set(Math.sin(t) * c, s, Math.cos(t) * c);
    return b;
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
    this.treeSet.build(b);
    for (const p of this.plots.values()) p.cards.build(b);
    this.builtVersion = this.basisVersion;
    this.lastCardBuild = now;
  }

  zoomBy(f) { this.zoom = Math.max(6, Math.min(this.maxZoom || 40, this.zoom * f)); this.resize(); }

  setTarget(x, z, snap = false, y = 0) {
    this.goal.set(x, y, z);
    if (snap) this.target.copyFrom(this.goal);
  }

  resize() {
    const cssW = this.canvas.clientWidth || innerWidth, cssH = this.canvas.clientHeight || innerHeight;
    const dpr = Math.min(devicePixelRatio || 1, 3);
    // Aim for ~320 low-res pixels on the short side.
    this.pixel = Math.max(1, Math.round((Math.min(cssW, cssH) * dpr) / 320));
    const w = Math.max(1, Math.floor((cssW * dpr) / this.pixel)), h = Math.max(1, Math.floor((cssH * dpr) / this.pixel));
    if (this.canvas.width !== w || this.canvas.height !== h) this.engine.setSize(w, h, true);
    this.height = h;
    // `zoom` is how many world units fit across the screen's shorter side.
    const aspect = w / h;
    const halfH = aspect >= 1 ? this.zoom / 2 : this.zoom / 2 / aspect, halfW = halfH * aspect;
    const c = this.camera;
    c.orthoTop = halfH; c.orthoBottom = -halfH; c.orthoLeft = -halfW; c.orthoRight = halfW;
    // three.js-style names (main.js reads top/bottom for drag panning)
    c.top = halfH; c.bottom = -halfH; c.left = -halfW; c.right = halfW;
    this.halfW = halfW; this.halfH = halfH;
  }

  applyCamera(first) {
    const { back, right, up } = this.basis(this._b);
    // Snap the view to whole low-res pixels so the world moves in clean pixel steps
    // instead of crawling (which shimmers like static when zoomed out).
    const unit = (this.halfH * 2) / this.height;
    const eye = this.eye.copyFrom(this.target);
    const a = Vector3.Dot(eye, right), b = Vector3.Dot(eye, up);
    const da = Math.round(a / unit) * unit - a, db = Math.round(b / unit) * unit - b;
    eye.x += right.x * da + up.x * db; eye.y += right.y * da + up.y * db; eye.z += right.z * da + up.z * db;
    this.snap = { right, up, unit }; // sprites snap to the same grid (see actor)
    this.camera.position.set(eye.x + back.x * 80, eye.y + back.y * 80, eye.z + back.z * 80);
    this.camera.setTarget(eye);
    if (first) { this.trees.build(this.basis()); this.treeSet.build(this.basis()); }
  }

  // ---------- picking ----------
  // World point under a screen position, on the horizontal plane at height y.
  pick(clientX, clientY, y = 0) {
    const rect = this.canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1, ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    const { right, up, back } = this._b;
    const ox = this.eye.x + right.x * nx * this.halfW + up.x * ny * this.halfH;
    const oy = this.eye.y + right.y * nx * this.halfW + up.y * ny * this.halfH;
    const oz = this.eye.z + right.z * nx * this.halfW + up.z * ny * this.halfH;
    if (Math.abs(back.y) < 1e-6) return null;
    const t = (oy - y) / back.y; // ray runs along -back
    return { x: ox - back.x * t, z: oz - back.z * t };
  }

  // CSS pixel position of a world point.
  toScreen(x, y, z) {
    const { right, up } = this._b, e = this.eye;
    const dx = x - e.x, dy = y - e.y, dz = z - e.z;
    const nx = (dx * right.x + dy * right.y + dz * right.z) / this.halfW, ny = (dx * up.x + dy * up.y + dz * up.z) / this.halfH;
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + ((nx + 1) / 2) * rect.width, y: rect.top + ((1 - ny) / 2) * rect.height };
  }

  // Repaint the ground after the road layout changed.
  // Trees chopped, rocks broken, new ones grown: rebuild them (at most a few times a second).
  refreshNature() {
    if (this.natureTimer) return;
    this.natureTimer = setTimeout(() => {
      this.natureTimer = null;
      this.treeSet.dispose();
      this.treeSet = new BillboardSet();
      treeCards(this.world, this.treeSet);
      this.treeSet.build(this.basis());
      disposeNode(this.rocks);
      this.rocks = buildRocks(this.world);
    }, 120);
  }

  // Soft cloud shadows drifting over the land (darker when it's overcast).
  makeClouds() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const g = cv.getContext('2d');
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 9; i++) {
      const x = rnd() * 128, y = rnd() * 128, r = 14 + rnd() * 26;
      for (const [dx, dy] of [[0, 0], [128, 0], [-128, 0], [0, 128], [0, -128]]) {
        const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        gr.addColorStop(0, 'rgba(10,20,40,0.85)'); gr.addColorStop(0.6, 'rgba(10,20,40,0.45)'); gr.addColorStop(1, 'rgba(10,20,40,0)');
        g.fillStyle = gr; g.beginPath(); g.ellipse(x + dx, y + dy, r, r * 0.7, 0, 0, Math.PI * 2); g.fill();
      }
    }
    const P = 48, x0 = -40 - P, z0 = -40, x1 = MAP_W + 40, z1 = MAP_H + 40, y = 0.05;
    const geo = new Geo([x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1], [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
      [0, 0, (x1 - x0) / P, 0, (x1 - x0) / P, (z1 - z0) / P, 0, (z1 - z0) / P], [0, 2, 1, 0, 3, 2]);
    this.cloudMat = new TyMaterial({ kind: 'basic', map: canvasTexture(cv, true, false), transparent: true, opacity: 0.24, depthWrite: false, doubleSided: true });
    this.clouds = toMesh(geo, this.cloudMat, { name: 'clouds' });
    this.clouds.alphaIndex = 1;
    this.cloudP = P;
    this.overcast = 0;
  }
  updateClouds(now) {
    if (!this.clouds) this.makeClouds();
    const P = this.cloudP, t = now / 1000;
    this.clouds.position.x = ((t * 0.35) % P);
    this.clouds.position.z = ((t * 0.12) % P) - P * 0.5;
    const want = 0.24 + this.overcast * 0.22;
    if (Math.abs((this.cloudMat.o.opacity ?? 0) - want) > 0.005) this.cloudMat.setOpacity(this.cloudMat.o.opacity + (want - this.cloudMat.o.opacity) * 0.05);
  }

  // The game's season: fall colours, snow in winter.
  setSeason(id) {
    const s = this.world.season || {};
    if (s.id === id) return;
    this.world.season = { ...s, id, fall: id === 'fall', winter: id === 'winter' };
    this.treeSet.dispose();
    this.treeSet = new BillboardSet();
    treeCards(this.world, this.treeSet);
    this.treeSet.build(this.basis());
    this.terrainRoads = null;
    this.refreshTerrain();
  }

  refreshTerrain() {
    if (this.terrainRoads === this.world.roadsVersion) return;
    this.terrainRoads = this.world.roadsVersion;
    for (const m of this.terrain.getChildMeshes()) { m.material?.o.map?.dispose(); m.material?.dispose(); }
    disposeNode(this.terrain);
    this.terrain = buildTerrain(this.world);
  }

  // ---------- plots ----------
  // state: a live plot (with its own x, y, w, h). opts: { cut: 'up'|'cut'|'down', maxLevel, roofs, now }
  setPlot(state, opts) {
    const g = this.ground();
    // Cheap change check: the server bumps a plot's rev on every edit (plus its size,
    // owner and content counts in case a plot was replaced). Returns true if rebuilt.
    const counts = [state.floor, state.obj, state.l1?.floor, state.l1?.obj, state.walls].map((o) => (o ? Object.keys(o).length : 0)).join('.');
    const sig = JSON.stringify([state.rev ?? 0, state.x, state.y, state.w, state.h, state.owner, counts, (state.roofs || []).length, opts.variant || '', opts.cut, opts.maxLevel, opts.roofs, opts.crops, this.quadrant, opts.entrance]);
    let p = this.plots.get(state.id);
    if (p && p.sig === sig) return false;
    this.removePlot(state.id);
    const cards = new BillboardSet();
    const built = buildPlot(state, { cut: { mode: opts.cut, fx: g.fx, fz: g.fz }, maxLevel: opts.maxLevel, roofs: opts.roofs, cards, now: opts.now, entrance: opts.entrance });
    cards.build(this.basis());
    freeze(built.group);
    p = { group: built.group, cards, lights: built.lights, sig };
    this.plots.set(state.id, p);
    return true;
  }

  removePlot(id) {
    const p = this.plots.get(id);
    if (!p) return;
    disposeNode(p.group);
    p.cards.dispose();
    this.plots.delete(id);
  }

  // ---------- actors (players, NPCs and pets as pixel sprites) ----------
  // pet: { idx, sit } draws a pet instead of a villager.
  // pose: null, or { kind: 'sit' } (seated sprite, no ground shadow), { kind: 'sleep', r, w, h, quilt }
  // (a flat top-down sleeper lying on the bed, head at the bed's head end), { kind: 'hidden' }.
  // The old string forms 'sit' and 'lie' (a turned upright sprite) still work.
  actor(id, x, z, dirWorld, moving, look, now, vis = true, y = 0, pet = null, pose = null) {
    const kind = typeof pose === 'string' ? pose : pose?.kind || null;
    const lie = kind === 'lie';
    let a = this.actors.get(id);
    if (!a) {
      const geo = spriteGeo(1, 1, 0.5, 0.5);
      a = { sprite: null, blob: null, geo, vec: [0, 1], lx: x, lz: z, lookRef: null, look: null, tex: null };
      a.sprite = toMesh(geo, null, { updatable: true, name: `actor:${id}` });
      a.sprite.alwaysSelectAsActiveMesh = true;
      a.blob = blobMesh([[0, 0, 0, pet ? 0.26 : 0.36]]);
      this.actors.set(id, a);
    }
    a.seen = true;
    // Facing comes from actual motion when there is any, else the reported direction.
    const mx = x - a.lx, mz = z - a.lz;
    if (Math.hypot(mx, mz) > 0.004) a.vec = [mx, mz];
    else if (!moving && dirWorld != null && a.dirWorld !== dirWorld) a.vec = DIR_VEC[dirWorld];
    a.dirWorld = dirWorld;
    a.lx = x; a.lz = z;
    const g = this.ground();
    const along = a.vec[0] * g.rx + a.vec[1] * g.rz, away = a.vec[0] * g.fx + a.vec[1] * g.fz;
    const dir = Math.abs(along) > Math.abs(away) * 1.05 ? (along > 0 ? 3 : 2) : away > 0 ? 1 : 0;
    const frame = moving ? Math.floor(now / (pet ? 100 : moving === 'run' ? 80 : 130)) % 4 : 0;
    let spr;
    if (pet) spr = pet.animal ? animalSprite(pet.animal, dir, frame, pet.sit ? 'sit' : null) : petSprite(pet.idx, dir, frame, pet.sit);
    else {
      if (a.lookRef !== look) { a.lookRef = look; a.look = sanitizeLook(look); }
      spr = personSprite(a.look, dir, frame, kind === 'sit' ? 'sit' : null);
    }
    const tex = texOf(spr.cv);
    if (a.tex !== tex || a.lie !== lie) {
      a.tex = tex; a.lie = lie;
      const sx = (spr.cv.width / TEXEL) * PERSON_SCALE, sy = (spr.cv.height / TEXEL) * PERSON_SCALE;
      if (lie) {
        // A turned copy of the sprite, centred on the bed.
        a.lieMats ||= new Map();
        let m = a.lieMats.get(tex);
        if (!m) { m = new TyMaterial({ kind: 'sprite', map: tex, alphaTest: 0.5 }); a.lieMats.set(tex, m); }
        a.sprite.material = m;
        spriteGeo(sx, sy, 0.5, 0.5, Math.PI / 2, a.geo);
      } else {
        a.sprite.material = spriteMat(tex);
        spriteGeo(sx, sy, -spr.dx / spr.cv.width, 1 + spr.dy / spr.cv.height, 0, a.geo);
      }
      a.sprite.updateVerticesData('position', a.geo.pos, false, false);
    }
    const p = a.sprite.position;
    p.set(x, y, z);
    // Land on the same low-res pixel grid as the camera, so walking characters glide in
    // even pixel steps instead of jittering against the ground.
    if (this.snap && !lie) {
      const { right, up, unit } = this.snap;
      const ra = Vector3.Dot(p, right), ub = Vector3.Dot(p, up);
      const da = Math.round(ra / unit) * unit - ra, db = Math.round(ub / unit) * unit - ub;
      p.set(p.x + right.x * da + up.x * db, p.y + right.y * da + up.y * db, p.z + right.z * da + up.z * db);
    }
    const sleep = kind === 'sleep' && !pet;
    a.sprite.isVisible = vis && !sleep && kind !== 'hidden';
    a.blob.position.set(x, y, z);
    a.blob.isVisible = vis && !kind; // no ground shadow while sitting or lying on things
    if (sleep) this.sleeper(a, x, y, z, pose, vis);
    else if (a.sleep) a.sleep.isVisible = false;
  }

  // Someone in bed, seen from above: a flat card on the mattress under the quilt art.
  sleeper(a, x, y, z, pose, vis) {
    if (!a.sleep) {
      // Unit quad in the ground plane; canvas top (the head) at -z, scaled per bed.
      const geo = new Geo([-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5], [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], [0, 1, 1, 1, 1, 0, 0, 0], [0, 2, 1, 0, 3, 2]);
      a.sleep = toMesh(geo, null, { name: 'sleeper' });
    }
    const tex = texOf(sleeperSprite(a.look, ...(pose.quilt ? [pose.quilt] : [])).cv);
    let m = sleepMats.get(tex);
    if (!m) {
      m = new TyMaterial({ kind: 'basic', map: tex, alphaTest: 0.5, tint: true, doubleSided: true });
      m.zOffset = -2; // over the bed's own quilt
      sleepMats.set(tex, m);
    }
    const s = a.sleep, w = pose.w || 1, h = pose.h || 2;
    s.material = m;
    s.scaling.set(Math.min(w, h) - 0.1, 1, Math.max(w, h) - 0.1);
    s.rotation.y = (-(pose.r || 0) * Math.PI) / 2;
    s.position.set(x, y + 0.01, z);
    s.isVisible = vis;
  }

  // Something you ride (the tractor), centred at (x, z) and turned to face where it's
  // going (the model's front is north, -z).
  vehicle(id, t, x, y, z, dirWorld) {
    let v = this.vehicles.get(id);
    if (!v) {
      v = { node: makeItem(t, 0, 0, 0, 0, 0, { cast: false }), yaw: null, lx: x, lz: z };
      this.vehicles.set(id, v);
    }
    v.seen = true;
    const mx = x - v.lx, mz = z - v.lz;
    let goal = v.goal ?? Math.atan2(-DIR_VEC[dirWorld ?? 1][0], -DIR_VEC[dirWorld ?? 1][1]);
    if (Math.hypot(mx, mz) > 0.01) goal = Math.atan2(-mx, -mz);
    v.goal = goal;
    v.lx = x; v.lz = z;
    if (v.yaw == null) v.yaw = goal;
    let d = goal - v.yaw;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    v.yaw += d * 0.25;
    v.node.position.set(x, y, z);
    v.node.rotation.y = v.yaw;
    return v.yaw;
  }

  pruneActors() {
    for (const [id, v] of this.vehicles) {
      if (!v.seen) { disposeNode(v.node); this.vehicles.delete(id); }
      v.seen = false;
    }
    for (const [id, a] of this.actors) {
      if (!a.seen) { a.sprite.dispose(false, false); a.blob.dispose(false, false); a.sleep?.dispose(false, false); this.actors.delete(id); }
      a.seen = false;
    }
  }

  // ---------- frame ----------
  // dark: 0 (day) .. ~0.62 (night)
  render(now, dark, follow) {
    if (Math.abs(this.yawGoal - this.yaw) > 0.0005) { this.yaw += (this.yawGoal - this.yaw) * 0.2; this.basisVersion++; }
    this.updateCards(now);
    this.updateClouds(now);
    // Follow the player rigidly (a trailing camera makes the character wobble against the
    // pixel grid); free-look panning eases, independent of the frame rate.
    const dt = Math.min(0.1, (now - (this.lastFrame ?? now)) / 1000);
    this.lastFrame = now;
    const want = this._want.copyFrom(this.goal).addInPlace(this.offset);
    if (follow) this.target.copyFrom(want);
    else { const k = 1 - Math.exp(-dt * 16); this.target.addInPlace(want.subtractInPlace(this.target).scaleInPlace(k)); }
    this.applyCamera(false);
    const night = Math.min(1, dark / 0.62);
    // Shader globals (linear colour × intensity, as three.js's physically based lights).
    const sunI = 2.4 * (1 - night * 0.88);
    linearHSL(0.1 - night * 0.45, 0.55, 0.85 - night * 0.2, G.sunColor).scaleInPlace(sunI);
    G.sunDir.copyFrom(SUN_DIR);
    const hemiI = 1.6 - night * 1.05;
    G.hemiSky.copyFrom(night > 0.5 ? HEMI_NIGHT : HEMI_DAY).scaleInPlace(hemiI);
    G.hemiGround.copyFrom(HEMI_GROUND).scaleInPlace(hemiI);
    const tint = 1 - night * 0.55;
    G.tint.set(tint, tint, Math.min(1, tint + night * 0.15));
    glassMat().emissive.set(night * 0.9, night * 0.7, night * 0.3);
    // Night light pool: nearest light sources to the camera target.
    G.ptCount = 0;
    if (night >= 0.05) {
      const all = this.lightList;
      all.length = 0;
      for (const s of this.staticLights) all.push(s);
      for (const p of this.plots.values()) for (const s of p.lights) all.push(s);
      const tx = this.target.x, tz = this.target.z;
      for (const s of all) s.d2 = (s.x - tx) ** 2 + (s.z - tz) ** 2;
      all.sort(byD2);
      const n = Math.min(NPT, all.length);
      for (let i = 0; i < n; i++) {
        const s = all[i], k = LIGHT_KIND[s.kind] || LIGHT_KIND.lamp, I = night * k.i;
        G.ptPos[i * 4] = s.x; G.ptPos[i * 4 + 1] = s.y; G.ptPos[i * 4 + 2] = s.z; G.ptPos[i * 4 + 3] = k.d;
        G.ptCol[i * 4] = k.c[0] * I; G.ptCol[i * 4 + 1] = k.c[1] * I; G.ptCol[i * 4 + 2] = k.c[2] * I; G.ptCol[i * 4 + 3] = 1.4;
      }
      G.ptCount = n;
    }
    // The sun's shadow frame moves in coarse steps, so the map is only redrawn now and then.
    this.shadow.update(Math.round(this.target.x / 2) * 2, Math.round(this.target.z / 2) * 2, SUN_OFF);
    this.spray.update(now);
    ctx.frame++;
    this.engine.beginFrame();
    this.scene.render();
    this.engine.endFrame();
  }
}
const byD2 = (a, b) => a.d2 - b.d2;

const spriteMats = new Map(), sleepMats = new Map();
// Villager and pet sprites face the camera, so on their own they lean back toward
// whatever stands behind them and a wall behind you slices through your head. Each
// pixel instead gets the depth it would have on an upright figure standing at the feet
// (the FEET define of the shader in bjs.js): walls behind you stay behind, while a bed
// or wall really in front still hides the parts of you it should.
function spriteMat(tex) {
  let m = spriteMats.get(tex);
  if (!m) {
    m = new TyMaterial({ kind: 'sprite', map: tex, alphaTest: 0.5, feet: true, tint: true });
    spriteMats.set(tex, m);
  }
  return m;
}

export { LEVEL_H, MAP_W, MAP_H };

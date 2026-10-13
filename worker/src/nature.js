// Nature on the server: chopping wild trees and breaking rocks, land cleared when it's
// claimed, trees and rocks growing back (and new ones appearing when the village runs
// low), planted trees on plots (chop them for wood, pick apples), and rain that waters
// everyone's outdoor crops.
import { ITEMS, cropStage, isWet } from '../../shared/catalog.js';
import { T, TILE, MAP_W, MAP_H, LAND, DAY_MS, worldClock, publicAreaAt, ROAD_PLANS } from '../../shared/world.js';
import { HOUR_MS } from '../../shared/needs.js';
import { objAt, footprint, levelView, roofAt } from '../../shared/plot.js';
import { WET_MS, waterCrop } from '../../shared/farm.js';
import { HITS, TOOL_FOR, TREES, treeOf, treeStage, fruitReady, applyNature, inLand, wildKind, weatherAt } from '../../shared/nature.js';

const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const REGROW_MS = DAY_MS;      // a stump grows back after at least a day
const inPlan = (x, y) => Object.values(ROAD_PLANS).some((p) => x >= p.x - 1 && x < p.x + p.w + 1 && y >= p.y - 1 && y < p.y + p.h + 1);

export class Nature {
  constructor(game, saved = {}) {
    this.game = game;
    this.s = { cut: saved.cut || {}, grown: saved.grown || {} };
    this.hits = new Map();       // tile index -> { n, t }
    this.nextTick = 0;
    this.nextRain = 0;
    const w = game.world;
    // How much of each there is on a fresh map: the regrowth target.
    this.target = { tree: 0, rock: 0 };
    for (let y = LAND.y; y < LAND.y + LAND.h; y++) for (let x = LAND.x; x < LAND.x + LAND.w; x++) {
      const k = wildKind(w, x, y);
      if (k) this.target[k]++;
    }
    applyNature(w, this.s);
  }
  save() { return this.s; }
  mark() { this.game.mark('nature'); }
  view() { return this.s; }

  // Land that's owned has no wild trees or rocks: clear them (the wood and stone go to
  // `p`, the new owner, if given).
  clearPlot(plot, p = null) {
    const w = this.game.world, cut = [], got = { wood: 0, stone: 0 };
    for (let y = plot.y; y < plot.y + plot.h; y++) for (let x = plot.x; x < plot.x + plot.w; x++) {
      const k = wildKind(w, x, y);
      if (!k) continue;
      const i = y * MAP_W + x;
      this.fell(i, k);
      cut.push(i);
      if (k === 'tree') got.wood += 3; else got.stone += 2;
    }
    if (!cut.length) return;
    this.mark();
    this.game.broadcast({ type: 'nature', cut });
    if (p) {
      for (const [item, n] of Object.entries(got)) if (n) this.game.farm.give(p, item, n);
      this.game.sessions.get(p.id)?.send({ type: 'toast', text: `🪓 Cleared your land: +${got.wood} wood${got.stone ? `, +${got.stone} stone` : ''}` });
    }
  }
  // Fell a tree / break a rock at tile i. Stumps remember when and what they were.
  fell(i, kind) {
    const w = this.game.world;
    if (this.s.grown[i]) delete this.s.grown[i]; else this.s.cut[i] = [this.game.now(), kind];
    w.tiles[i] = T.GRASS;
    w.natureVersion = (w.natureVersion || 0) + 1;
    this.hits.delete(i);
  }

  // A swing of the axe (at a tree) or the pickaxe (at a rock): { tx, ty }.
  hit(s, { tx, ty }) {
    const g = this.game, w = g.world;
    if (!Number.isInteger(tx) || !Number.isInteger(ty) || s.act || s.ride || s.level) return;
    const kind = wildKind(w, tx, ty);
    if (!kind) return;
    const tool = TOOL_FOR[kind];
    if (!(s.profile.inv[tool] > 0)) return s.send({ type: 'error', msg: `You need ${kind === 'tree' ? 'an axe' : 'a pickaxe'} (Juniper sells them)` });
    if (Math.hypot((tx + 0.5) * TILE - s.x, (ty + 0.5) * TILE - s.y) > TILE * 1.9) return s.send({ type: 'error', msg: 'Walk up to it first' });
    // On someone's land, only they (and their helpers) may clear it.
    const pid = w.plotAt[ty * MAP_W + tx];
    if (pid >= 0 && g.plots[pid]?.owner && !g.canWork(g.plots[pid], s.profile.id)) return s.send({ type: 'error', msg: 'That’s on someone else’s land' });
    const now = g.now();
    if (now - (s.lastSwing || 0) < 280) return;
    s.lastSwing = now;
    const i = ty * MAP_W + tx;
    const h = this.hits.get(i);
    const n = h && now - h.t < 20_000 ? h.n + 1 : 1;
    this.hits.set(i, { n, t: now });
    g.broadcast({ type: 'natureHit', i, n, of: HITS[kind], by: s.profile.id });
    if (n < HITS[kind]) return;
    this.fell(i, kind);
    this.mark();
    g.broadcast({ type: 'nature', cut: [i] });
    if (kind === 'tree') {
      const wood = rint(3, 5);
      g.bag(s, 'wood', wood);
      const sap = Math.random() < 0.3;
      if (sap) g.bag(s, 'sapling_oak', 1);
      g.count(s.profile, 'chop');
      s.send({ type: 'toast', text: `🌲 Timber! +${wood} wood${sap ? ' and an oak sapling 🌱' : ''}` });
    } else {
      const stone = rint(2, 4);
      g.bag(s, 'stone', stone);
      g.count(s.profile, 'mine');
      s.send({ type: 'toast', text: `🪨 Crack! +${stone} stone` });
    }
  }

  // Planted trees on a plot: { plotId, lx, ly, act: 'chop' | 'pick' }.
  tree(s, { plotId, lx, ly, act }) {
    const g = this.game;
    const plot = g.ownPlot(s, plotId, 'farm');
    if (!plot || !Number.isInteger(lx) || !Number.isInteger(ly) || s.level) return;
    const hit = objAt(plot, lx, ly);
    const d = hit && treeOf(hit.obj);
    if (!d) return;
    const [ax, ay] = hit.key.split(',').map(Number);
    if (Math.hypot((plot.x + ax + 0.5) * TILE - s.x, (plot.y + ay + 0.5) * TILE - s.y) > TILE * 2) return s.send({ type: 'error', msg: 'Walk up to the tree first' });
    const now = g.now(), o = hit.obj, stage = treeStage(o, now);
    if (act === 'pick') {
      if (!fruitReady(o, now)) return s.send({ type: 'error', msg: 'No fruit yet: apple trees fruit once a day when grown' });
      o.f = now;
      g.bag(s, d.fruit, d.fruitN);
      g.count(s.profile, 'harvest', d.fruitN);
      s.send({ type: 'harvested', items: { [d.fruit]: d.fruitN } });
    } else if (act === 'chop') {
      if (!(s.profile.inv.axe > 0)) return s.send({ type: 'error', msg: 'You need an axe (Juniper sells them)' });
      delete plot.obj[hit.key];
      const wood = stage === 2 ? rint(...d.wood) : stage === 1 ? 2 : 0;
      if (wood) g.bag(s, 'wood', wood);
      if (stage === 2) g.bag(s, o.t, 1); // a sapling to plant again
      g.count(s.profile, 'chop');
      s.send({ type: 'toast', text: stage === 2 ? `🌳 Timber! +${wood} wood and a ${ITEMS[o.t].name.toLowerCase()} to replant` : wood ? `🪓 +${wood} wood (it wasn’t fully grown)` : '🪓 Dug up the sapling' });
    } else return;
    g.plotChanged(plot);
  }

  // Every in-game hour: stumps grow back and new trees and rocks appear where the village
  // has cleared too many. While it rains, outdoor crops get watered.
  tick(now) {
    const g = this.game;
    if (now >= this.nextRain) {
      this.nextRain = now + HOUR_MS / 2;
      const { day, hours } = worldClock(now, g.epoch);
      const wx = weatherAt(day, hours);
      if (g.weather !== wx) { g.weather = wx; g.broadcast({ type: 'weather', now: wx }); }
      if (wx === 'rain' || wx === 'storm') this.rain(now);
    }
    if (now < this.nextTick) return;
    this.nextTick = now + HOUR_MS;
    for (const kind of ['tree', 'rock']) this.regrow(kind, now);
  }

  rain(now) {
    const g = this.game;
    for (const plot of Object.values(g.plots)) {
      if (!plot.owner) continue;
      let wet = false;
      for (const [k, o] of Object.entries(plot.obj)) {
        if (!ITEMS[o.t]?.crop || cropStage(o, now) >= 3 || isWet(o, now + WET_MS * 0.3)) continue;
        const [x, y] = k.split(',').map(Number);
        if (roofAt(plot, x, y, 0) >= 0) continue; // under glass: no rain
        waterCrop(o, now);
        wet = true;
      }
      if (wet) g.plotChanged(plot);
    }
  }

  regrow(kind, now) {
    const g = this.game, w = g.world;
    let live = 0;
    for (let y = LAND.y; y < LAND.y + LAND.h; y++) for (let x = LAND.x; x < LAND.x + LAND.w; x++) if (wildKind(w, x, y) === kind) live++;
    let want = Math.min(4, Math.ceil((this.target[kind] - live) * 0.05));
    if (want <= 0) return;
    const free = (i) => {
      const x = i % MAP_W, y = Math.floor(i / MAP_W);
      if (w.tiles[i] !== T.GRASS && w.tiles[i] !== T.TALLGRASS && w.tiles[i] !== T.FLOWERS) return false;
      if (w.plotAt[i] >= 0 || publicAreaAt(x, y) || inPlan(x, y) || !inLand(x, y)) return false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (w.tiles[(y + dy) * MAP_W + x + dx] === T.PATH) return false;
      for (const s of g.sessions.values()) if (Math.abs(s.x / TILE - x - 0.5) < 1.2 && Math.abs(s.y / TILE - y - 0.5) < 1.2) return false;
      return true;
    };
    const back = [];
    // Old stumps first (where this kind used to be)...
    const stumps = Object.entries(this.s.cut).filter(([, c]) => now - c[0] >= REGROW_MS && c[1] === kind).sort((a, b) => a[1][0] - b[1][0]);
    for (const [i] of stumps) {
      if (want <= 0) break;
      if (!free(+i)) continue;
      delete this.s.cut[i];
      w.tiles[+i] = kind === 'rock' ? T.ROCK : T.TREE;
      back.push([+i, kind]);
      want--;
    }
    // ...then somewhere new, next to others of its kind when possible.
    for (let tries = 0; want > 0 && tries < 400; tries++) {
      const x = LAND.x + Math.floor(Math.random() * LAND.w), y = LAND.y + Math.floor(Math.random() * LAND.h), i = y * MAP_W + x;
      if (!free(i)) continue;
      let near = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (wildKind(w, x + dx, y + dy) === kind) near++;
      if (!near && tries < 300) continue;
      this.s.grown[i] = kind;
      w.tiles[i] = kind === 'rock' ? T.ROCK : T.TREE;
      back.push([i, kind]);
      want--;
    }
    if (!back.length) return;
    w.natureVersion = (w.natureVersion || 0) + 1;
    this.mark();
    g.broadcast({ type: 'nature', grow: back });
  }
}

import { generateWorld, TILE, PLAYER_SPEED, WORLD_VERSION, STARTER_PLOTS } from '../../shared/world.js';
import { ITEMS, GOODS, CROPS, START_COINS, cropStage, itemName } from '../../shared/catalog.js';
import {
  key, inInterior, tilesOf, objAt, occChanged, placementError, canStand, levelView,
  edgeKey, wallError, wallTouchesFeet, roofError, roofAt, gateTiles, indexPlots,
  landError, contentFits, shiftContent, mergedRect, splitRects, hasContent, LAND_PRICE, stepLevel,
} from '../../shared/plot.js';
import { NPCS } from '../../shared/npcs.js';
import { Npc, parseAiReply, REPLY_SCHEMA } from './npc.js';

const COLORS = ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c', '#3498db', '#9b59b6', '#ec6fa4'];
const randomHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
const TALK_RANGE = TILE * 3.5;

// Authoritative game state. Transport-agnostic: each connection supplies sendRaw/close
// plus the identity that the host already verified (Better Auth user id, name, ...).
// Persistence is key/value: the host calls takeDirty() and stores what it returns.
//   meta            { epoch }
//   plot:<id>       plot state: geometry { x, y, w, h } in world tiles, owner, contents
//   profile:<uid>   player profile keyed by Better Auth user id (coins, bag, plot, position).
//                   profile.id is a separate public id that other players see.
//   npc:<id>        NPC mind
//   gossip          shared village news
export class Game {
  constructor(saved = {}, { now = () => Date.now(), ai = null, cheats = 'all', admins = [] } = {}) {
    this.now = now;
    this.cheatsMode = cheats; // 'all' | 'admins' | 'off'
    this.admins = admins;
    this.ai = ai; // async (messages, schema, parse) => parsed reply or null; null ai = scripted NPCs
    this.world = generateWorld();
    this.epoch = saved.meta?.epoch || this.now();
    this.profiles = saved.profiles || {}; // user id -> profile
    this.gossip = saved.gossip || [];
    // Plots are live data keyed by id. A save from an older map layout starts fresh land.
    const sameMap = (saved.meta?.version || 0) >= 3;
    this.plots = {};
    if (sameMap && saved.plots && Object.keys(saved.plots).length) {
      for (const s of Object.values(saved.plots)) if (s) this.plots[s.id] = normalizePlot(s);
      this.nextPlotId = saved.meta.nextPlotId ?? Math.max(...Object.keys(this.plots).map(Number)) + 1;
    } else {
      STARTER_PLOTS.forEach((r, i) => { this.plots[i] = blankPlot(i, r); });
      this.nextPlotId = STARTER_PLOTS.length;
      if (saved.meta) {
        for (const prof of Object.values(this.profiles)) { prof.plotId = null; prof.x = prof.y = null; }
        for (const uid of Object.keys(this.profiles)) this.dirtyLater = [...(this.dirtyLater || []), `profile:${uid}`];
      }
      this.freshLand = true;
    }
    indexPlots(this.world, this.plots);
    this.npcs = {};
    for (const id of Object.keys(NPCS)) this.npcs[id] = new Npc(id, saved.npcs?.[id]);
    this.sessions = new Map(); // player id -> session
    this.dirty = new Set(saved.meta && !this.freshLand ? [] : ['meta']);
    if (this.freshLand) for (const id of Object.keys(this.plots)) this.dirty.add(`plot:${id}`);
    for (const k of this.dirtyLater || []) this.dirty.add(k);
    this.lastTick = this.now();
  }

  // ---------- persistence ----------
  mark(k) { this.dirty.add(k); }
  takeDirty() {
    const out = {};
    for (const k of this.dirty) {
      const [kind, id] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
      if (k === 'meta') out[k] = { epoch: this.epoch, version: WORLD_VERSION, nextPlotId: this.nextPlotId };
      else if (k === 'gossip') out[k] = this.gossip;
      else if (kind === 'plot') out[k] = this.plots[id] ?? null;
      else if (kind === 'profile') out[k] = this.profiles[id] ?? null;
      else if (kind === 'npc') out[k] = this.npcs[id].s;
    }
    this.dirty.clear();
    return out; // null values mean "delete"
  }

  // Rebuild the constructor's `saved` shape from stored key/values.
  static fromEntries(entries) {
    const saved = { plots: {}, profiles: {}, npcs: {} };
    for (const [k, v] of entries) {
      const i = k.indexOf(':');
      const kind = i < 0 ? k : k.slice(0, i), id = k.slice(i + 1);
      if (kind === 'meta') saved.meta = v;
      else if (kind === 'gossip') saved.gossip = v;
      else if (kind === 'plot') saved.plots[id] = v;
      else if (kind === 'profile') saved.profiles[id] = v;
      else if (kind === 'npc') saved.npcs[id] = v;
    }
    return saved;
  }

  // ---------- connections ----------
  broadcast(msg, except) {
    const data = JSON.stringify(msg);
    for (const s of this.sessions.values()) if (s !== except) s.sendRaw(data);
  }

  publicPlayer(s) {
    const p = s.profile;
    return { id: p.id, name: p.name, color: p.color, x: s.x, y: s.y, dir: s.dir, moving: s.moving, level: s.level };
  }

  // identity: { userId, name, username, isAnonymous } — verified by the host.
  attach(conn, identity) {
    const s = { conn, identity, profile: null, cheats: {}, sendRaw: (d) => conn.sendRaw(d), send: (m) => conn.sendRaw(JSON.stringify(m)), lastChat: 0, lastTalk: 0, busy: false };
    return {
      onMessage: (raw) => {
        let msg;
        try { msg = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return; }
        if (!msg || typeof msg.type !== 'string') return;
        try {
          const r = this.handle(s, msg);
          if (r && r.catch) return r.catch((e) => console.error('handler error', e));
          return r;
        } catch (e) { console.error('handler error', e); }
      },
      onClose: () => this.leave(s),
    };
  }

  handle(s, msg) {
    if (msg.type === 'hello') return this.hello(s, msg);
    if (!s.profile) return;
    switch (msg.type) {
      case 'move': return this.move(s, msg);
      case 'chat': return this.chat(s, msg);
      case 'claim': return this.claim(s, msg);
      case 'place': return this.place(s, msg);
      case 'remove': return this.remove(s, msg);
      case 'floorRect': return this.floorRect(s, msg);
      case 'walls': return this.walls(s, msg);
      case 'feature': return this.feature(s, msg);
      case 'roof': return this.roof(s, msg);
      case 'resizePlot': return this.resizePlot(s, msg);
      case 'mergePlot': return this.mergePlot(s, msg);
      case 'splitPlot': return this.splitPlot(s, msg);
      case 'cheat': return this.cheat(s, msg);
      case 'harvest': return this.harvest(s, msg);
      case 'home': return this.home(s);
      case 'npcOpen': return this.npcOpen(s, msg);
      case 'npcClose': return this.npcClose(s, msg);
      case 'npcTalk': return this.npcTalk(s, msg);
      case 'buy': return this.buy(s, msg);
      case 'sell': return this.sell(s, msg);
      case 'gift': return this.gift(s, msg);
    }
  }

  // ---------- players ----------
  newProfile(uid, name, color) {
    const profile = { id: randomHex(6), uid, name, color, coins: START_COINS, plotId: null, x: null, y: null, inv: {}, created: this.now() };
    this.profiles[uid] = profile;
    this.markProfile(profile);
    return profile;
  }

  markProfile(profile) { this.mark(`profile:${profile.uid}`); }

  // hello: { name?, color? }. The account itself was verified before connecting.
  hello(s, msg) {
    if (s.profile) return;
    const id = s.identity;
    if (!id?.userId) return s.send({ type: 'error', msg: 'Not signed in' });
    // An existing profile keeps its name unless the client explicitly sends a new one.
    const asked = clean(msg.name, 16);
    const color = COLORS.includes(msg.color) ? msg.color : null;
    let profile = this.profiles[id.userId];
    if (!profile) profile = this.newProfile(id.userId, asked || clean(id.name, 16) || 'Villager', color || COLORS[Math.floor(Math.random() * COLORS.length)]);
    const name = asked || profile.name;
    if (name !== profile.name) {
      profile.name = name;
      const own = this.plots[profile.plotId];
      if (own) { own.ownerName = name; this.mark(`plot:${own.id}`); }
    }
    if (color) profile.color = color;
    profile.inv ||= {};
    if (profile.plotId != null && this.plots[profile.plotId]?.owner !== profile.id) profile.plotId = null;
    this.markProfile(profile);
    this.enter(s, profile);
  }

  // A guest signed up or logged in (Better Auth anonymous plugin's onLinkAccount).
  // A brand-new account inherits the guest's village life; an existing account keeps
  // its own, and the guest's plot goes back on the market.
  linkAccount(fromUid, toUid, info = {}) {
    const guest = this.profiles[fromUid];
    if (!guest || fromUid === toUid) return;
    if (!this.profiles[toUid]) {
      delete this.profiles[fromUid];
      this.mark(`profile:${fromUid}`);
      guest.uid = toUid;
      if (info.name && !guest.name) guest.name = clean(info.name, 16);
      this.profiles[toUid] = guest;
      this.markProfile(guest);
    } else {
      if (guest.plotId != null) {
        const plot = this.plots[guest.plotId];
        if (plot) { Object.assign(plot, blankPlot(plot.id, plot)); this.plotChanged(plot); }
      }
      delete this.profiles[fromUid];
      this.mark(`profile:${fromUid}`);
    }
    // The guest's open connection is about to be replaced by a fresh one.
    const live = this.sessions.get(guest.id);
    if (live) { this.leave(live); live.conn.close(); }
  }

  enter(s, profile) {
    // Same account connecting twice: drop the older connection.
    const old = this.sessions.get(profile.id);
    if (old) { this.leave(old); old.conn.close(); }

    s.profile = profile;
    const lvl = profile.level || 0;
    const ok = profile.x != null && canStand(this.world, this.plots, profile.x, profile.y, lvl);
    s.x = ok ? profile.x : this.world.spawn.x;
    s.y = ok ? profile.y : this.world.spawn.y;
    s.level = ok ? lvl : 0;
    s.dir = 0; s.moving = false; s.lastMove = this.now();
    s.greeted = {};
    this.sessions.set(profile.id, s);

    s.send({
      type: 'welcome', worldVersion: WORLD_VERSION, serverTime: this.now(), epoch: this.epoch,
      you: { id: profile.id, name: profile.name, color: profile.color, coins: profile.coins, plotId: profile.plotId, x: s.x, y: s.y, level: s.level, inv: profile.inv, username: s.identity.username || null, guest: !!s.identity.isAnonymous },
      players: [...this.sessions.values()].filter((o) => o !== s).map((o) => this.publicPlayer(o)),
      npcs: Object.values(this.npcs).map((n) => ({ id: n.id, x: n.x, y: n.y, dir: n.dir })),
      plots: Object.values(this.plots),
    });
    this.broadcast({ type: 'join', player: this.publicPlayer(s) }, s);
    if (profile.plotId != null) this.broadcast({ type: 'plot', plot: this.plots[profile.plotId] });
  }

  leave(s) {
    if (!s.profile || this.sessions.get(s.profile.id) !== s) return;
    this.sessions.delete(s.profile.id);
    s.profile.x = s.x; s.profile.y = s.y; s.profile.level = s.level;
    this.markProfile(s.profile);
    for (const n of Object.values(this.npcs)) if (n.talkingTo === s.profile.id) n.talkingTo = null;
    this.broadcast({ type: 'leave', id: s.profile.id });
  }

  // ---------- movement & chat ----------
  move(s, { x, y, d, m }) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const now = this.now();
    const dt = Math.min(1, (now - s.lastMove) / 1000);
    const dist = Math.hypot(x - s.x, y - s.y);
    const level = dist > PLAYER_SPEED * dt * 1.6 + 12 ? -1 : stepLevel(this.world, this.plots, x, y, s.level);
    if (level < 0) {
      s.send({ type: 'pos', x: s.x, y: s.y, level: s.level });
      return;
    }
    s.x = x; s.y = y; s.level = level; s.lastMove = now;
    s.dir = [0, 1, 2, 3].includes(d) ? d : s.dir;
    s.moving = !!m;
  }

  chat(s, msg) {
    const text = clean(msg.text, 120);
    const now = this.now();
    if (!text || now - s.lastChat < 400) return;
    s.lastChat = now;
    this.broadcast({ type: 'chat', id: s.profile.id, name: s.profile.name, text });
  }

  // ---------- plots ----------
  ownPlot(s, plotId) {
    const plot = this.plots[plotId];
    if (!plot) return null;
    if (plot.owner !== s.profile.id) { s.send({ type: 'error', msg: "That isn't your plot" }); return null; }
    return plot;
  }

  coins(s, delta) {
    s.profile.coins += delta;
    s.send({ type: 'coins', coins: s.profile.coins });
    this.markProfile(s.profile);
  }

  bag(s, item, delta) {
    const inv = s.profile.inv;
    inv[item] = (inv[item] || 0) + delta;
    if (inv[item] <= 0) delete inv[item];
    s.send({ type: 'inv', inv });
    this.markProfile(s.profile);
  }

  plotChanged(plot) {
    occChanged(plot);
    this.mark(`plot:${plot.id}`);
    this.broadcast({ type: 'plot', plot });
    // Removed stairs or floors can leave someone with nothing to stand on.
    for (const o of this.sessions.values()) {
      if (o.level && !canStand(this.world, this.plots, o.x, o.y, o.level)) this.home(o);
    }
  }

  claim(s, { plotId }) {
    const plot = this.plots[plotId];
    if (!plot) return;
    if (s.profile.plotId != null) return s.send({ type: 'error', msg: 'You already own a plot' });
    if (plot.owner) return s.send({ type: 'error', msg: 'That plot is taken' });
    plot.owner = s.profile.id;
    plot.ownerName = s.profile.name;
    s.profile.plotId = plot.id;
    this.markProfile(s.profile);
    s.send({ type: 'claimed', plotId: plot.id });
    this.plotChanged(plot);
    this.addGossip('the village', `${s.profile.name} just moved into plot ${plot.id + 1}`);
  }

  // ----- building (Sims-style) -----
  // All building messages take an optional `level` (0 = ground, 1 = upstairs).
  lvl(level) { return level === 1 ? 1 : 0; }

  place(s, { plotId, lx, ly, item, r = 0, level = 0 }) {
    const plot = this.ownPlot(s, plotId);
    if (!plot || !inInterior(plot, lx, ly)) return;
    if (![0, 1, 2, 3].includes(r)) r = 0;
    level = this.lvl(level);
    const def = ITEMS[item];
    const err = placementError(plot, lx, ly, item, r, level);
    if (err) return s.send({ type: 'error', msg: err });
    const view = levelView(plot, level);
    const k = key(lx, ly);
    const free = s.cheats.build;
    if (def.shop && !free) {
      if (!s.profile.inv[item]) return s.send({ type: 'error', msg: `Buy a ${def.name} from ${NPCS[def.shop].name} first` });
    } else if (!free) {
      const refund = def.layer === 'floor' && view.floor[k] ? ITEMS[view.floor[k]].price : 0;
      if (s.profile.coins + refund < def.price) return s.send({ type: 'error', msg: 'Not enough coins' });
    }
    if (def.solid && !level && this.someoneOn(plot, tilesOf(item, r, lx, ly))) return s.send({ type: 'error', msg: 'Someone is standing there' });
    if (def.layer === 'floor') {
      const refund = view.floor[k] ? ITEMS[view.floor[k]].price : 0;
      view.floor[k] = item;
      if (!free) this.coins(s, refund - def.price);
    } else {
      view.obj[k] = def.crop ? { t: item, p: this.now() } : r ? { t: item, r } : { t: item };
      if (def.stairs) {
        // Cut a stairwell through the floor above (refunding those tiles).
        const up = levelView(plot, 1);
        for (const [tx, ty] of tilesOf(item, r, lx, ly)) {
          const f = up.floor[key(tx, ty)];
          if (f) { delete up.floor[key(tx, ty)]; if (!free) this.coins(s, ITEMS[f].price); }
        }
      }
      if (free) { /* bb.enablefreebuild */ } else if (def.shop) this.bag(s, item, -1);
      else this.coins(s, -def.price);
    }
    this.plotChanged(plot);
  }

  // Fill a rectangle with a floor (the Sims floor drag tool).
  floorRect(s, { plotId, x, y, w, h, item, level = 0 }) {
    const plot = this.ownPlot(s, plotId);
    const def = ITEMS[item];
    if (!plot || def?.layer !== 'floor' || ![x, y, w, h].every(Number.isInteger) || w < 1 || h < 1 || w * h > 160) return;
    level = this.lvl(level);
    const view = levelView(plot, level);
    const tiles = [];
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (!placementError(plot, x + i, y + j, item, 0, level)) tiles.push(key(x + i, y + j));
    if (!tiles.length) return;
    const cost = s.cheats.build ? 0 : tiles.reduce((sum, k) => sum + def.price - (view.floor[k] ? ITEMS[view.floor[k]].price : 0), 0);
    if (cost > s.profile.coins) return s.send({ type: 'error', msg: `Not enough coins (needs 🪙${cost})` });
    for (const k of tiles) view.floor[k] = item;
    this.coins(s, -cost);
    this.plotChanged(plot);
  }

  // Build a run of wall segments: segs = [[d, x, y], ...] (the wall and room tools).
  walls(s, { plotId, segs, m, level = 0 }) {
    const plot = this.ownPlot(s, plotId);
    const def = ITEMS[m];
    if (!plot || def?.layer !== 'wall' || !Array.isArray(segs) || !segs.length || segs.length > 80) return;
    level = this.lvl(level);
    plot.walls ||= {};
    const todo = [];
    const seen = new Set();
    for (const seg of segs) {
      if (!Array.isArray(seg)) return;
      const [d, x, y] = seg;
      const k = edgeKey(level, d, x, y);
      if (seen.has(k)) continue;
      seen.add(k);
      const err = wallError(plot, level, d, x, y);
      if (err) return s.send({ type: 'error', msg: err });
      const old = plot.walls[k];
      if (old?.m === m) continue;
      if (!level) for (const o of this.sessions.values()) {
        if (wallTouchesFeet(plot, d, x, y, o.x, o.y)) return s.send({ type: 'error', msg: 'Someone is standing there' });
      }
      todo.push([k, old]);
    }
    if (!todo.length) return;
    const cost = s.cheats.build ? 0 : todo.reduce((sum, [, old]) => sum + def.price - (old ? ITEMS[old.m].price : 0), 0);
    if (cost > s.profile.coins) return s.send({ type: 'error', msg: `Not enough coins (needs 🪙${cost})` });
    for (const [k, old] of todo) plot.walls[k] = old?.f ? { m, f: old.f } : { m };
    this.coins(s, -cost);
    this.plotChanged(plot);
  }

  // Put a door or window into an existing wall segment.
  feature(s, { plotId, d, x, y, f, level = 0 }) {
    const plot = this.ownPlot(s, plotId);
    const def = ITEMS[f];
    if (!plot || def?.layer !== 'feature') return;
    level = this.lvl(level);
    const k = edgeKey(level, d, x, y);
    const wall = plot.walls?.[k];
    if (!wall) return s.send({ type: 'error', msg: 'Doors and windows go into a wall' });
    if (wall.f === f) return;
    const cost = s.cheats.build ? 0 : def.price - (wall.f ? ITEMS[wall.f].price : 0);
    if (cost > s.profile.coins) return s.send({ type: 'error', msg: 'Not enough coins' });
    wall.f = f;
    this.coins(s, -cost);
    this.plotChanged(plot);
  }

  roof(s, { plotId, x, y, w, h, m, level = 0 }) {
    const plot = this.ownPlot(s, plotId);
    const def = ITEMS[m];
    if (!plot || def?.layer !== 'roof') return;
    level = this.lvl(level);
    plot.roofs ||= [];
    const err = roofError(plot, x, y, w, h, level) || (plot.roofs.length >= 12 ? 'Too many roofs' : null);
    if (err) return s.send({ type: 'error', msg: err });
    const cost = s.cheats.build ? 0 : def.price * w * h;
    if (cost > s.profile.coins) return s.send({ type: 'error', msg: `Not enough coins (needs 🪙${cost})` });
    plot.roofs.push({ x, y, w, h, l: level, m });
    this.coins(s, -cost);
    this.plotChanged(plot);
  }

  someoneOn(plot, tiles) {
    const p = plot;
    for (const [lx, ly] of tiles) {
      const x0 = (p.x + lx) * TILE, y0 = (p.y + ly) * TILE;
      for (const o of this.sessions.values()) {
        if (o.x + 5 > x0 && o.x - 5 < x0 + TILE && o.y > y0 && o.y - 5 < y0 + TILE) return true;
      }
    }
    return false;
  }

  // The sledgehammer. Targets, in order: { edge: [d,x,y] } a wall (or just its door/window
  // with featureOnly), { roof: true } the roof over a tile, else the object then floor on a tile.
  remove(s, { plotId, lx, ly, level = 0, edge, featureOnly, roof }) {
    const plot = this.ownPlot(s, plotId);
    if (!plot) return;
    const refundOn = !s.cheats.build;
    level = this.lvl(level);
    if (Array.isArray(edge)) {
      const k = edgeKey(level, edge[0], edge[1], edge[2]);
      const wall = plot.walls?.[k];
      if (!wall) return;
      let refund = wall.f ? ITEMS[wall.f].price : 0;
      if (featureOnly && wall.f) delete wall.f;
      else { refund += ITEMS[wall.m].price; delete plot.walls[k]; }
      if (refundOn) this.coins(s, refund);
      return this.plotChanged(plot);
    }
    if (!Number.isInteger(lx) || !Number.isInteger(ly)) return;
    if (roof) {
      const i = roofAt(plot, lx, ly, level);
      if (i < 0) return;
      const [rf] = plot.roofs.splice(i, 1);
      if (refundOn) this.coins(s, ITEMS[rf.m].price * rf.w * rf.h);
      return this.plotChanged(plot);
    }
    const view = levelView(plot, level);
    const hit = objAt(view, lx, ly);
    if (hit) {
      delete view.obj[hit.key];
      const def = ITEMS[hit.obj.t];
      // Shop items go back in the bag, crops are lost, everything else is refunded.
      if (def.shop && refundOn) this.bag(s, hit.obj.t, 1);
      else if (!def.crop && refundOn) this.coins(s, def.price);
    } else {
      const k = key(lx, ly);
      if (!view.floor[k]) return;
      if (refundOn) this.coins(s, ITEMS[view.floor[k]].price);
      delete view.floor[k];
    }
    this.plotChanged(plot);
  }

  // ----- land: resize, merge, split -----
  landCost(s, tiles) { return s.cheats.land ? 0 : Math.max(0, tiles) * LAND_PRICE; }

  landChanged(changed, removed = []) {
    indexPlots(this.world, this.plots);
    for (const id of removed) { this.mark(`plot:${id}`); this.broadcast({ type: 'plotRemoved', id }); }
    for (const p of changed) this.plotChanged(p);
    this.mark('meta');
    // Anyone now standing inside a new fence line gets moved out to the road.
    for (const o of this.sessions.values()) {
      if (!canStand(this.world, this.plots, o.x, o.y, o.level || 0)) this.home(o);
    }
  }

  // New rectangle for your plot (drag its edges). Growing costs LAND_PRICE per new tile.
  resizePlot(s, { plotId, x, y, w, h }) {
    const plot = this.ownPlot(s, plotId);
    if (!plot) return;
    const rect = { x, y, w, h };
    const err = landError(this.plots, plot.id, rect) || (contentFits(plot, rect) ? null : 'Your house wouldn’t fit — move things first');
    if (err) return s.send({ type: 'error', msg: err });
    const ix = Math.max(0, Math.min(x + w, plot.x + plot.w) - Math.max(x, plot.x));
    const iy = Math.max(0, Math.min(y + h, plot.y + plot.h) - Math.max(y, plot.y));
    const cost = this.landCost(s, w * h - ix * iy);
    if (cost > s.profile.coins) return s.send({ type: 'error', msg: `Not enough coins (needs 🪙${cost})` });
    shiftContent(plot, plot.x - x, plot.y - y);
    Object.assign(plot, rect);
    if (cost) this.coins(s, -cost);
    this.landChanged([plot]);
  }

  // Absorb the empty plot next door (side by side, same depth).
  mergePlot(s, { plotId, other }) {
    const plot = this.ownPlot(s, plotId);
    const o = this.plots[other];
    if (!plot || !o || o.id === plot.id) return;
    if (o.owner) return s.send({ type: 'error', msg: 'That plot belongs to someone' });
    if (hasContent(o)) return s.send({ type: 'error', msg: 'That plot isn’t empty' });
    const rect = mergedRect(plot, o);
    if (!rect) return s.send({ type: 'error', msg: 'Only plots side by side with the same depth can merge' });
    const rest = Object.fromEntries(Object.entries(this.plots).filter(([id]) => +id !== o.id));
    const err = landError(rest, plot.id, rect);
    if (err) return s.send({ type: 'error', msg: err });
    const cost = this.landCost(s, o.w * o.h);
    if (cost > s.profile.coins) return s.send({ type: 'error', msg: `Not enough coins (needs 🪙${cost})` });
    shiftContent(plot, plot.x - rect.x, 0);
    Object.assign(plot, rect);
    delete this.plots[o.id];
    if (cost) this.coins(s, -cost);
    this.landChanged([plot], [o.id]);
  }

  // Cut your plot along a north-south line at world column `at`. You keep the side
  // with your house on it; the other side goes on the market as a new plot.
  splitPlot(s, { plotId, at }) {
    const plot = this.ownPlot(s, plotId);
    if (!plot) return;
    const parts = splitRects(plot, at);
    if (!parts) return s.send({ type: 'error', msg: 'Both halves must be at least 8 tiles wide' });
    const fits = parts.map((r) => contentFits(plot, r));
    let keep;
    if (fits[0] && fits[1]) keep = parts[0].w >= parts[1].w ? 0 : 1;
    else if (fits[0] || fits[1]) keep = fits[0] ? 0 : 1;
    else return s.send({ type: 'error', msg: 'Your house is on both sides of that line' });
    const kept = parts[keep], sold = parts[1 - keep];
    shiftContent(plot, plot.x - kept.x, 0);
    Object.assign(plot, kept);
    const fresh = blankPlot(this.nextPlotId++, sold);
    this.plots[fresh.id] = fresh;
    this.landChanged([plot, fresh]);
  }

  // ----- cheat console (Settings → Cheats) -----
  cheat(s, { cmd }) {
    const say = (text) => s.send({ type: 'console', text });
    if (this.cheatsMode === 'off') return say('Cheats are turned off on this server.');
    if (this.cheatsMode === 'admins' && !this.admins.includes(s.identity.username)) return say('Only village admins can use cheats here.');
    const [c, ...args] = clean(cmd, 80).toLowerCase().split(/\s+/);
    const on = (v) => ['true', 'on', '1', 'yes'].includes(v);
    const off = (v) => ['false', 'off', '0', 'no'].includes(v);
    if (!c) return;
    if (c === 'help') {
      return say('testingcheats true · money <amount> · motherlode · kaching · rosebud · freerealestate on/off · bb.enablefreebuild');
    }
    if (c === 'testingcheats') {
      if (on(args[0])) { s.cheats.testing = true; return say('Cheats are enabled.'); }
      if (off(args[0])) { s.cheats = {}; return say('Cheats are disabled.'); }
      return say('Usage: testingcheats true | false');
    }
    if (!s.cheats.testing) return say('Type "testingcheats true" first.');
    const MAX = 99_999_999;
    const set = (n) => this.coins(s, Math.max(0, Math.min(MAX, n)) - s.profile.coins);
    switch (c) {
      case 'money': {
        const n = Number(args[0]);
        if (!Number.isFinite(n) || n < 0) return say('Usage: money <amount>');
        set(Math.floor(n));
        return say(`Funds set to 🪙${s.profile.coins.toLocaleString()}.`);
      }
      case 'motherlode': set(s.profile.coins + 50_000); return say('+🪙50,000');
      case 'kaching': case 'rosebud': set(s.profile.coins + 1_000); return say('+🪙1,000');
      case 'freerealestate':
        if (on(args[0])) { s.cheats.land = true; return say('Free real estate: land changes cost nothing.'); }
        if (off(args[0])) { s.cheats.land = false; return say('Free real estate is off.'); }
        return say('Usage: freerealestate on | off');
      case 'bb.enablefreebuild':
        s.cheats.build = !s.cheats.build;
        s.send({ type: 'freebuild', on: s.cheats.build });
        return say(s.cheats.build ? 'Free build on: building costs nothing.' : 'Free build off.');
      default:
        return say(`Unknown cheat "${c}". Type help.`);
    }
  }

  // Harvest one tile ({lx, ly}) or, without coordinates, every ripe crop on the plot.
  // Produce goes into the bag; sell it at Rosa's Market.
  harvest(s, { plotId, lx, ly }) {
    const plot = this.ownPlot(s, plotId);
    if (!plot) return;
    const now = this.now();
    const keys = Number.isInteger(lx) ? [key(lx, ly)] : Object.keys(plot.obj);
    const got = {};
    for (const k of keys) {
      const o = plot.obj[k];
      if (!o || !ITEMS[o.t]?.crop || cropStage(o, now) < 3) continue;
      const crop = ITEMS[o.t].crop;
      got[crop] = (got[crop] || 0) + 1;
      delete plot.obj[k];
    }
    if (!Object.keys(got).length) return;
    for (const [crop, n] of Object.entries(got)) this.bag(s, crop, n);
    s.send({ type: 'harvested', items: got });
    this.plotChanged(plot);
  }

  home(s) {
    const id = s.profile.plotId;
    const p = id != null ? this.plots[id] : null;
    const target = p ? { x: (p.x + gateTiles(p)[1]) * TILE, y: (p.y + p.h) * TILE + 12 } : this.world.spawn;
    s.x = target.x; s.y = target.y; s.level = 0; s.lastMove = this.now();
    s.send({ type: 'pos', x: s.x, y: s.y, level: 0 });
  }

  // ---------- NPCs & shops ----------
  nearNpc(s, id) {
    const n = this.npcs[id];
    if (!n) return null;
    if (Math.hypot(n.x - s.x, n.y - s.y) > TALK_RANGE) { s.send({ type: 'error', msg: `Walk closer to ${n.def.name}` }); return null; }
    return n;
  }

  hold(n, s) {
    n.talkingTo = s.profile.id;
    n.talkUntil = this.now() + 45_000;
    n.faceToward(s.x, s.y);
  }

  npcOpen(s, { npc }) {
    const n = this.nearNpc(s, npc);
    if (!n) return;
    this.hold(n, s);
    const greeting = n.greeting(s.profile, this.now());
    s.send({ type: 'npc', ...n.view(s.profile, this.now()), say: greeting });
    this.broadcast({ type: 'npcBubble', id: n.id, text: greeting });
  }

  npcClose(s, { npc }) {
    const n = this.npcs[npc];
    if (n && n.talkingTo === s.profile.id) n.talkUntil = this.now() + 1500;
  }

  playerFacts(s) {
    const p = s.profile;
    const plot = p.plotId != null ? this.plots[p.plotId] : null;
    const facts = [];
    if (!plot) facts.push('they have not claimed a plot yet');
    else {
      const objs = [...Object.values(plot.obj), ...Object.values(plot.l1.obj)];
      const walls = Object.keys(plot.walls).length;
      const crops = objs.filter((o) => ITEMS[o.t]?.crop).length;
      const fancy = objs.filter((o) => ITEMS[o.t]?.shop).map((o) => ITEMS[o.t].name);
      facts.push(`they live on plot ${plot.id + 1}`);
      facts.push(walls > 8 ? (Object.keys(plot.walls).some((k) => k.startsWith('1:')) ? 'they have built a two-storey house' : 'they have built a house') : 'their house is barely started');
      if (crops) facts.push(`they are growing ${crops} crops`);
      if (fancy.length) facts.push(`their home has: ${[...new Set(fancy)].join(', ')}`);
    }
    facts.push(p.coins > 1000 ? 'they are quite well off' : p.coins < 50 ? 'they are short on money' : 'they have some savings');
    return facts.join('; ') + '.';
  }

  addGossip(by, text) {
    text = clean(text, 140);
    if (text.length < 6) return;
    this.gossip.push(`${text} (heard from ${by})`);
    if (this.gossip.length > 20) this.gossip.splice(0, this.gossip.length - 20);
    this.mark('gossip');
  }

  // Ask the NPC's mind for a reply. `forced` overrides the sentiment (used for gifts).
  async converse(s, n, text, forced) {
    const now = this.now();
    const ctx = { now, epoch: this.epoch, playerFacts: this.playerFacts(s), gossip: this.gossip.slice(-6) };
    let res = null;
    if (this.ai) {
      try { res = await this.ai(n.buildPrompt(s.profile, text, ctx), REPLY_SCHEMA, parseAiReply); } catch (e) { console.error('ai error', e); }
    }
    res ||= n.scriptedReply(s.profile, text, now);
    const sentiment = forced ?? res.sentiment;
    const r = n.rel(s.profile);
    r.talks++;
    n.addHistory(s.profile, s.profile.name, text);
    n.addHistory(s.profile, n.def.name, res.reply);
    if (res.remember) n.remember(s.profile, res.remember);
    if (res.gossip) this.addGossip(n.def.name, res.gossip);
    const changes = n.feel(s.profile, sentiment, this.now(), sentiment >= 0 ? `${s.profile.name} was kind to me` : `${s.profile.name} upset me`, this.epoch);
    this.mark(`npc:${n.id}`);
    this.hold(n, s);
    if (this.sessions.get(s.profile.id) === s) {
      s.send({ type: 'npcSay', text: res.reply, sentiment, changes, ...n.view(s.profile, this.now()) });
    }
    this.broadcast({ type: 'npcBubble', id: n.id, text: res.reply });
  }

  async npcTalk(s, { npc, text }) {
    text = clean(text, 160);
    const now = this.now();
    if (!text || s.busy) return;
    if (now - s.lastTalk < 1500) return s.send({ type: 'error', msg: 'Give them a moment to answer' });
    const n = this.nearNpc(s, npc);
    if (!n) return;
    s.lastTalk = now;
    s.busy = true;
    this.hold(n, s);
    this.broadcast({ type: 'chat', id: s.profile.id, name: s.profile.name, text, to: n.def.name });
    try { await this.converse(s, n, text); } finally { s.busy = false; }
  }

  async gift(s, { npc, item }) {
    const n = this.nearNpc(s, npc);
    if (!n || s.busy || !GOODS[item] || !s.profile.inv[item]) return;
    s.busy = true;
    this.bag(s, item, -1);
    const sentiment = n.def.likes.includes(item) ? 2 : n.def.dislikes.includes(item) ? -1 : 1;
    try { await this.converse(s, n, `*gives you a ${GOODS[item].name} as a gift*`, sentiment); } finally { s.busy = false; }
  }

  buy(s, { npc, item, qty = 1 }) {
    const n = this.nearNpc(s, npc);
    qty = Math.max(1, Math.min(20, Math.floor(qty) || 1));
    if (!n || !n.def.sells.includes(item)) return;
    const price = n.price(s.profile, item, true) * qty;
    if (s.profile.coins < price) return s.send({ type: 'error', msg: 'Not enough coins' });
    this.coins(s, -price);
    this.bag(s, item, qty);
    this.trade(s, n, 0.5, `${s.profile.name} bought from me`, `Thank you kindly! Enjoy your ${itemName(item)}.`);
  }

  sell(s, { npc, item, qty = 1 }) {
    const n = this.nearNpc(s, npc);
    qty = Math.max(1, Math.floor(qty) || 1);
    if (!n || !n.def.buys.includes(item)) return;
    qty = Math.min(qty, s.profile.inv[item] || 0);
    if (!qty) return s.send({ type: 'error', msg: `You don't have any ${itemName(item)}` });
    const price = n.price(s.profile, item, false) * qty;
    this.bag(s, item, -qty);
    this.coins(s, price);
    this.trade(s, n, 0.3, `${s.profile.name} sold me good produce`, `${qty} ${itemName(item)}${qty > 1 ? 's' : ''}? Lovely — here's ${price} coins.`);
  }

  trade(s, n, sentiment, why, line) {
    this.hold(n, s);
    const changes = n.feel(s.profile, sentiment, this.now(), why, this.epoch);
    this.mark(`npc:${n.id}`);
    s.send({ type: 'npcSay', text: line, sentiment, changes, ...n.view(s.profile, this.now()) });
  }

  // ---------- simulation ----------
  tick() {
    const now = this.now();
    const dt = Math.min(0.5, (now - this.lastTick) / 1000);
    this.lastTick = now;
    if (!this.sessions.size) return;
    for (const n of Object.values(this.npcs)) {
      n.tick(dt, now, this.world, this.plots);
      // Say hello to players walking past (at most every 5 minutes each).
      for (const s of this.sessions.values()) {
        if (Math.hypot(n.x - s.x, n.y - s.y) > TILE * 2.2) continue;
        if (now - (s.greeted[n.id] || 0) < 300_000 || n.talkingTo) continue;
        s.greeted[n.id] = now;
        this.broadcast({ type: 'npcBubble', id: n.id, text: n.passingLine(s.profile, now) });
      }
    }
    const p = [];
    for (const s of this.sessions.values()) p.push([s.profile.id, Math.round(s.x * 10) / 10, Math.round(s.y * 10) / 10, s.dir, s.moving ? 1 : 0, s.level || 0]);
    const npcs = Object.values(this.npcs).map((n) => [n.id, Math.round(n.x * 10) / 10, Math.round(n.y * 10) / 10, n.dir, n.moving ? 1 : 0]);
    this.broadcast({ type: 'state', t: now, p, n: npcs });
  }
}

function blankPlot(id, r) {
  return { id, x: r.x, y: r.y, w: r.w, h: r.h, owner: null, ownerName: null, floor: {}, obj: {}, l1: { floor: {}, obj: {} }, walls: {}, roofs: [] };
}

function normalizePlot(p) {
  return { ...blankPlot(p.id, p), ...p, l1: p.l1 || { floor: {}, obj: {} }, walls: p.walls || {}, roofs: p.roofs || [] };
}

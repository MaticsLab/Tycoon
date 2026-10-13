import { generateWorld, applyRoads, worldClock, publicAreaAt, plotIdAtPixel, TILE, PLAYER_SPEED, RUN_MULT, WORLD_VERSION, STARTER_PLOTS, MAP_W, CIVIC } from '../../shared/world.js';
import { City } from './city.js';
import { roomRegion, extract, stockFragment, rotateTimes, removeAt, placeError as fragError, applyAt, fragmentValue, cleanFragment } from '../../shared/blueprint.js';
import { STYLED_ROOMS } from '../../shared/rooms.js';
import { ITEMS, GOODS, CROPS, START_COINS, cropStage, itemName } from '../../shared/catalog.js';
import {
  key, inInterior, tilesOf, footprint, objAt, occChanged, placementError, canStand, levelView, canRotate,
  edgeKey, parseEdge, wallError, wallTouchesFeet, roofError, roofAt, indexPlots, roadIn, roadEditError, plotEntrance,
  landError, contentFits, shiftContent, mergedRect, splitRects, hasContent, LAND_PRICE, stepLevel,
} from '../../shared/plot.js';
import { NPCS } from '../../shared/npcs.js';
import { HOUR_MS, NEEDS, ACTIVITIES, FOODS, sanitizeNeeds, usesOf, advanceNeeds, activityDone, fullNeeds } from '../../shared/needs.js';
import { sanitizeLook, randomLook, shirtColor } from '../../shared/look.js';
import { Npc, parseAiReply, REPLY_SCHEMA } from './npc.js';

const randomHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
// Players hear every move of people within this many tiles; everyone else once a second.
export const AOI_RANGE = 48;
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
//   roads           player road edits { add: [tile index], del: [tile index] }
//   city            City Hall: officials, elections, proposals, treasury, city data
export class Game {
  constructor(saved = {}, { now = () => Date.now(), ai = null, cheats = 'all', admins = [] } = {}) {
    this.now = now;
    this.cheatsMode = cheats; // 'all' | 'admins' | 'off'
    this.admins = admins;
    this.ai = ai; // async (messages, schema, parse) => parsed reply or null; null ai = scripted NPCs
    this.world = generateWorld(undefined, { date: new Date(this.now()) });
    this.roads = { add: saved.roads?.add || [], del: saved.roads?.del || [] };
    applyRoads(this.world, this.roads);
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
    // v3 -> v4: roads got wider and plots lost their fences. Plots keep their place;
    // anything now standing on a public road is packed up and refunded.
    if (sameMap && (saved.meta?.version || 0) < 4) {
      for (const plot of Object.values(this.plots)) {
        const refund = clearRoadContent(this.world, plot);
        const owner = refund && Object.values(this.profiles).find((pr) => pr.id === plot.owner);
        if (owner) { owner.coins += refund; this.dirtyLater = [...(this.dirtyLater || []), `profile:${owner.uid}`]; }
        this.dirtyLater = [...(this.dirtyLater || []), `plot:${plot.id}`, 'meta'];
      }
    }
    this.npcs = {};
    for (const id of Object.keys(NPCS)) this.npcs[id] = new Npc(id, saved.npcs?.[id]);
    this.sessions = new Map(); // player id -> session
    this.city = new City(this, saved.city);
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
      else if (k === 'roads') out[k] = this.roads;
      else if (k === 'city') out[k] = this.city.s;
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
      else if (kind === 'roads') saved.roads = v;
      else if (kind === 'city') saved.city = v;
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
    return { id: p.id, name: p.name, color: p.color, look: p.look, x: s.x, y: s.y, dir: s.dir, moving: s.moving, level: s.level, act: s.act?.id || 0 };
  }

  // identity: { userId, name, username, isAnonymous } — verified by the host.
  attach(conn, identity) {
    const s = { conn, identity, profile: null, cheats: {}, sendRaw: (d) => conn.sendRaw(d), send: (m) => conn.sendRaw(JSON.stringify(m)), lastChat: 0, lastTalk: 0, busy: false };
    return {
      onMessage: (raw) => {
        let msg;
        try { msg = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return; }
        if (!msg || typeof msg.type !== 'string') return;
        s.quiet = 0;
        if (msg.type === 'ping') return;
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
      case 'road': return this.road(s, msg);
      case 'moveObj': return this.moveObj(s, msg);
      case 'design': return this.design(s, msg);
      case 'bulldoze': return this.bulldoze(s, msg);
      case 'moveRegion': return this.moveRegion(s, msg);
      case 'saveBlueprint': return this.saveBlueprint(s, msg);
      case 'deleteBlueprint': return this.deleteBlueprint(s, msg);
      case 'placeBlueprint': return this.placeBlueprint(s, msg);
      case 'cityRun': return this.cityAction(s, () => this.city.run(s, msg.office, msg.platform, this.day()));
      case 'cityVote': return this.cityAction(s, () => this.city.vote(s, msg.office, msg.candidate, this.day()));
      case 'cityPropose': return this.cityAction(s, () => this.city.propose(s, msg, this.day()));
      case 'councilVote': return this.cityAction(s, () => this.city.councilVote(s, msg.id, msg.vote));
      case 'mayorAct': return this.cityAction(s, () => this.city.mayorAct(s, msg.id, !!msg.sign, this.day()));
      case 'cheat': return this.cheat(s, msg);
      case 'setLook': return this.setLook(s, msg);
      case 'harvest': return this.harvest(s, msg);
      case 'use': return this.use(s, msg);
      case 'stop': return this.stopActivity(s, true);
      case 'eat': return this.eat(s, msg);
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
  newProfile(uid, name, look) {
    const profile = { id: randomHex(6), uid, name, look, color: shirtColor(look), farm: '', fav: '', coins: START_COINS, plotId: null, x: null, y: null, inv: {}, created: this.now() };
    this.profiles[uid] = profile;
    this.markProfile(profile);
    return profile;
  }

  markProfile(profile) { this.mark(`profile:${profile.uid}`); }

  // hello: { name?, look?, farm?, fav? }. The account itself was verified before connecting.
  // An existing profile keeps its name and appearance unless the client sends new ones
  // (it only does so straight after the character creator).
  hello(s, msg) {
    if (s.profile) return;
    const id = s.identity;
    if (!id?.userId) return s.send({ type: 'error', msg: 'Not signed in' });
    let profile = this.profiles[id.userId];
    if (!profile) profile = this.newProfile(id.userId, clean(msg.name, 16) || clean(id.name, 16) || 'Villager', msg.look ? sanitizeLook(msg.look) : randomLook());
    profile.look = profile.look ? sanitizeLook(profile.look) : randomLook();
    profile.inv ||= {};
    profile.needs = sanitizeNeeds(profile.needs);
    this.applyLook(profile, msg);
    if (profile.plotId != null && this.plots[profile.plotId]?.owner !== profile.id) profile.plotId = null;
    this.markProfile(profile);
    this.enter(s, profile);
  }

  // Name, appearance, farm name and favourite thing from the character creator.
  applyLook(profile, msg) {
    const name = clean(msg.name, 16);
    if (name) profile.name = name;
    if (msg.look) profile.look = sanitizeLook(msg.look);
    profile.color = shirtColor(profile.look);
    if (typeof msg.farm === 'string') profile.farm = clean(msg.farm, 16);
    if (typeof msg.fav === 'string') profile.fav = clean(msg.fav, 20);
    const own = this.plots[profile.plotId];
    if (own && own.owner === profile.id && (own.ownerName !== profile.name || own.farm !== profile.farm)) {
      own.ownerName = profile.name; own.farm = profile.farm || '';
      this.mark(`plot:${own.id}`);
      return own;
    }
    return null;
  }

  setLook(s, msg) {
    const plot = this.applyLook(s.profile, msg);
    this.markProfile(s.profile);
    const p = s.profile;
    this.broadcast({ type: 'look', id: p.id, name: p.name, color: p.color, look: p.look });
    s.send({ type: 'profile', name: p.name, look: p.look, farm: p.farm, fav: p.fav });
    if (plot) this.broadcast({ type: 'plot', plot });
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
    s.act = null; s.needsAt = this.now(); s.needsSent = 0;
    this.sessions.set(profile.id, s);

    s.send({
      type: 'welcome', worldVersion: WORLD_VERSION, serverTime: this.now(), epoch: this.epoch,
      you: { id: profile.id, name: profile.name, color: profile.color, look: profile.look, library: profile.library || [], needs: profile.needs, farm: profile.farm || '', fav: profile.fav || '', coins: profile.coins, plotId: profile.plotId, x: s.x, y: s.y, level: s.level, inv: profile.inv, username: s.identity.username || null, guest: !!s.identity.isAnonymous },
      players: [...this.sessions.values()].filter((o) => o !== s).map((o) => this.publicPlayer(o)),
      npcs: Object.values(this.npcs).map((n) => ({ id: n.id, x: n.x, y: n.y, dir: n.dir })),
      plots: Object.values(this.plots),
      roads: this.roads,
      city: this.city.view(this.day(), profile),
    });
    this.broadcast({ type: 'join', player: this.publicPlayer(s) }, s);
    if (profile.plotId != null) this.broadcast({ type: 'plot', plot: this.plots[profile.plotId] });
  }

  leave(s) {
    if (!s.profile || this.sessions.get(s.profile.id) !== s) return;
    if (s.act) this.stopActivity(s, false);
    this.sessions.delete(s.profile.id);
    s.profile.x = s.x; s.profile.y = s.y; s.profile.level = s.level;
    this.markProfile(s.profile);
    for (const n of Object.values(this.npcs)) if (n.talkingTo === s.profile.id) n.talkingTo = null;
    this.broadcast({ type: 'leave', id: s.profile.id });
  }

  // ---------- movement & chat ----------
  move(s, { x, y, d, m }) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || s.act) return;
    const now = this.now();
    // Speed check with a movement budget: time earns distance (up to a second's worth),
    // moves spend it. Moves that arrive bunched together after a network hiccup are fine;
    // only going faster than running speed overall gets you put back.
    const top = PLAYER_SPEED * RUN_MULT * 1.25;
    s.budget = Math.min(top + 24, (s.budget ?? top) + top * Math.max(0, now - s.lastMove) / 1000);
    s.lastMove = now;
    const dist = Math.hypot(x - s.x, y - s.y);
    const level = dist > s.budget ? -1 : stepLevel(this.world, this.plots, x, y, s.level);
    if (level < 0) {
      s.send({ type: 'pos', x: s.x, y: s.y, level: s.level });
      return;
    }
    s.budget -= dist;
    s.x = x; s.y = y; s.level = level;
    // City data: road traffic and visits to public places.
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    if (tx !== s.tx || ty !== s.ty) {
      s.tx = tx; s.ty = ty;
      this.city.onStep(tx, ty);
      const area = publicAreaAt(tx, ty)?.name || null;
      if (area && area !== s.area) this.city.onEnterArea(area);
      s.area = area;
    }
    s.dir = [0, 1, 2, 3].includes(d) ? d : s.dir;
    s.moving = m === 2 ? 2 : m ? 1 : 0; // 2 = running
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
    this.city.onCoins(delta);
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
    plot.rev = (plot.rev || 0) + 1; // clients rebuild a plot only when its rev changes
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
    plot.farm = s.profile.farm || '';
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
    const err = placementError(plot, lx, ly, item, r, level, this.world);
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
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (!placementError(plot, x + i, y + j, item, 0, level, this.world)) tiles.push(key(x + i, y + j));
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
      const err = wallError(plot, level, d, x, y, this.world);
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
    const err = roofError(plot, x, y, w, h, level, this.world) || (plot.roofs.length >= 12 ? 'Too many roofs' : null);
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

  // ----- Sims-style build tools -----
  // Select tool: pick up a piece of furniture and put it down elsewhere (free).
  moveObj(s, { plotId, level = 0, from, to, r }) {
    const plot = this.ownPlot(s, plotId);
    if (!plot || !Array.isArray(from) || !Array.isArray(to)) return;
    level = this.lvl(level);
    const view = levelView(plot, level);
    const hit = objAt(view, from[0], from[1]);
    if (!hit) return;
    const o = hit.obj, def = ITEMS[o.t];
    if (def.stairs) return s.send({ type: 'error', msg: 'Stairs can’t be moved: sledgehammer them and build new ones' });
    if (def.crop) return s.send({ type: 'error', msg: 'Crops can’t be moved' });
    const rot = canRotate(o.t) && [0, 1, 2, 3].includes(r) ? r : o.r || 0;
    delete view.obj[hit.key];
    occChanged(plot);
    const [tx, ty] = to;
    const err = !Number.isInteger(tx) || !Number.isInteger(ty) ? 'Bad spot' : placementError(plot, tx, ty, o.t, rot, level, this.world)
      || (def.solid && !level && this.someoneOn(plot, tilesOf(o.t, rot, tx, ty)) ? 'Someone is standing there' : null);
    if (err) { view.obj[hit.key] = o; occChanged(plot); return s.send({ type: 'error', msg: err }); }
    const n = { ...o };
    if (rot) n.r = rot; else delete n.r;
    view.obj[key(tx, ty)] = n;
    this.plotChanged(plot);
  }

  // Design tool: recolour furniture (6 colourways) or switch a roof's material. Free.
  design(s, { plotId, level = 0, lx, ly, roof, c }) {
    const plot = this.ownPlot(s, plotId);
    if (!plot || !Number.isInteger(lx) || !Number.isInteger(ly)) return;
    level = this.lvl(level);
    if (roof) {
      const i = roofAt(plot, lx, ly, level);
      if (i < 0) return;
      const mats = Object.keys(ITEMS).filter((k) => ITEMS[k].layer === 'roof');
      plot.roofs[i].m = mats[(mats.indexOf(plot.roofs[i].m) + 1) % mats.length];
      return this.plotChanged(plot);
    }
    const hit = objAt(levelView(plot, level), lx, ly);
    if (!hit || ITEMS[hit.obj.t].crop) return;
    const next = Number.isInteger(c) && c >= 0 && c < 6 ? c : ((hit.obj.c || 0) + 1) % 6;
    if (next) hit.obj.c = next; else delete hit.obj.c;
    this.plotChanged(plot);
  }

  // Bulldoze the lot (everything, refunded) or just the "terrain": soil, paths and crops.
  bulldoze(s, { plotId, terrain }) {
    const plot = this.ownPlot(s, plotId);
    if (!plot) return;
    const refundOn = !s.cheats.build;
    let coins = 0;
    const bag = {};
    const outdoor = (f) => f === 'soil' || f === 'floor_stone';
    for (let l = 0; l < 2; l++) {
      const view = levelView(plot, l);
      for (const [k, o] of Object.entries(view.obj)) {
        const def = ITEMS[o.t];
        if (terrain && !def.crop) continue;
        if (def.stairs && terrain) continue;
        delete view.obj[k];
        if (def.shop) bag[o.t] = (bag[o.t] || 0) + 1; else if (!def.crop) coins += def.price;
      }
      for (const [k, f] of Object.entries(view.floor)) {
        if (terrain && !(l === 0 && outdoor(f))) continue;
        if (terrain && objAt(view, ...k.split(',').map(Number))) continue;
        delete view.floor[k];
        coins += ITEMS[f]?.price || 0;
      }
    }
    if (!terrain) {
      for (const w of Object.values(plot.walls)) coins += (ITEMS[w.m]?.price || 0) + (ITEMS[w.f]?.price || 0);
      for (const rf of plot.roofs) coins += (ITEMS[rf.m]?.price || 0) * rf.w * rf.h;
      plot.walls = {}; plot.roofs = [];
    }
    occChanged(plot);
    if (refundOn) { if (coins) this.coins(s, coins); for (const [t, n] of Object.entries(bag)) this.bag(s, t, n); }
    s.send({ type: 'toast', text: terrain ? '🚜 Terrain cleared' : `🚜 Lot bulldozed${refundOn ? ` · +🪙${coins}` : ''}` });
    this.landChanged([plot]);
  }

  // Move (and turn) a room, or the whole house, as one piece. Free.
  // room: [lx, ly] of a floor tile in it (on `level`), or all: true for everything.
  moveRegion(s, { plotId, level = 0, room, all, dx = 0, dy = 0, rot = 0 }) {
    const plot = this.ownPlot(s, plotId);
    if (!plot || ![dx, dy, rot].every(Number.isInteger)) return;
    level = this.lvl(level);
    let region = null;
    if (!all) {
      if (!Array.isArray(room)) return;
      region = roomRegion(plot, level, room[0], room[1]);
      if (!region) return s.send({ type: 'error', msg: 'Point at a room’s floor' });
    }
    const frag = extract(plot, region);
    if (!frag) return s.send({ type: 'error', msg: all ? 'Nothing to move yet' : 'That room is empty' });
    const turned = rotateTimes(frag, rot);
    // Turn about the room's centre, then shift.
    const ox = frag.ox + Math.round((frag.w - turned.w) / 2) + dx, oy = frag.oy + Math.round((frag.h - turned.h) / 2) + dy;
    removeAt(plot, frag, frag.ox, frag.oy);
    const err = fragError(plot, turned, ox, oy, this.world);
    if (err) { applyAt(plot, frag, frag.ox, frag.oy); return s.send({ type: 'error', msg: err }); }
    applyAt(plot, turned, ox, oy);
    this.landChanged([plot]);
  }

  // Save to My Library: keep a room or the whole house as a blueprint (up to 12).
  saveBlueprint(s, { plotId, level = 0, room, name }) {
    const plot = this.ownPlot(s, plotId);
    if (!plot) return;
    level = this.lvl(level);
    let region = null;
    if (Array.isArray(room)) {
      region = roomRegion(plot, level, room[0], room[1]);
      if (!region) return s.send({ type: 'error', msg: 'Point at a room’s floor' });
    }
    const frag = extract(plot, region);
    if (!frag) return s.send({ type: 'error', msg: 'Nothing to save yet' });
    const lib = (s.profile.library ||= []);
    if (lib.length >= 12) return s.send({ type: 'error', msg: 'Your library is full (12): delete one first' });
    let f = cleanFragment(frag);
    if (region && level) f = { ...f, levels: [f.levels[1], { floor: {}, obj: {} }], walls: Object.fromEntries(Object.entries(f.walls).map(([k, w]) => [k.replace(/^1:/, '0:'), w])) };
    lib.push({ name: clean(name, 24) || (region ? 'My room' : 'My house'), frag: f, value: fragmentValue(f), saved: this.now() });
    this.markProfile(s.profile);
    s.send({ type: 'library', library: lib });
    s.send({ type: 'toast', text: '📚 Saved to your library' });
  }

  deleteBlueprint(s, { idx }) {
    const lib = s.profile.library || [];
    if (!Number.isInteger(idx) || !lib[idx]) return;
    lib.splice(idx, 1);
    this.markProfile(s.profile);
    s.send({ type: 'library', library: lib });
  }

  // Buy a styled room or a library blueprint onto your plot at (x, y), turned `rot` times.
  placeBlueprint(s, { plotId, src, id, x, y, rot = 0 }) {
    const plot = this.ownPlot(s, plotId);
    if (!plot || ![x, y, rot].every(Number.isInteger)) return;
    const bp = src === 'styled' ? STYLED_ROOMS[id]?.frag : (s.profile.library || [])[id]?.frag;
    if (!bp) return;
    // Shop furniture comes out of your bag; pieces you don't have are left out.
    const { frag, used, missing } = stockFragment(rotateTimes(bp, rot), s.profile.inv, s.cheats.build);
    const err = fragError(plot, frag, x, y, this.world);
    if (err) return s.send({ type: 'error', msg: err });
    const cost = s.cheats.build ? 0 : fragmentValue(frag);
    if (cost > s.profile.coins) return s.send({ type: 'error', msg: `Not enough coins (needs 🪙${cost})` });
    applyAt(plot, frag, x, y, { now: this.now() });
    if (cost) this.coins(s, -cost);
    for (const [t, n] of Object.entries(used)) this.bag(s, t, -n);
    const gone = Object.entries(missing).map(([t, n]) => `${n > 1 ? `${n}× ` : ''}${ITEMS[t].name}`);
    if (gone.length) s.send({ type: 'toast', text: `Placed without ${gone.join(', ')}: buy ${gone.length > 1 ? 'them' : 'it'} from ${NPCS[ITEMS[Object.keys(missing)[0]].shop].name}` });
    this.landChanged([plot]);
  }

  // ----- land: resize, merge, split -----
  landCost(s, tiles) { return s.cheats.land ? 0 : Math.max(0, tiles) * this.city.landPrice; }
  payLand(s, cost) { if (cost) { this.coins(s, -cost); this.city.onLand(cost); } }

  landChanged(changed, removed = []) {
    indexPlots(this.world, this.plots);
    for (const id of removed) { this.mark(`plot:${id}`); this.broadcast({ type: 'plotRemoved', id }); }
    for (const p of changed) this.plotChanged(p);
    this.mark('meta');
    // Anyone now stuck (inside a wall line, say) gets moved out to the road.
    for (const o of this.sessions.values()) {
      if (o.act && ACTIVITIES[o.act.id]?.seat) continue; // they're in a bed or a shower
      if (!canStand(this.world, this.plots, o.x, o.y, o.level || 0)) this.home(o);
    }
  }

  // New rectangle for your plot (drag its edges). Growing costs LAND_PRICE per new tile.
  resizePlot(s, { plotId, x, y, w, h }) {
    const plot = this.ownPlot(s, plotId);
    if (!plot) return;
    const rect = { x, y, w, h };
    const err = landError(this.plots, plot.id, rect, this.world) || (contentFits(plot, rect) ? null : 'Your house wouldn’t fit — move things first');
    if (err) return s.send({ type: 'error', msg: err });
    const ix = Math.max(0, Math.min(x + w, plot.x + plot.w) - Math.max(x, plot.x));
    const iy = Math.max(0, Math.min(y + h, plot.y + plot.h) - Math.max(y, plot.y));
    const cost = this.landCost(s, w * h - ix * iy);
    if (cost > s.profile.coins) return s.send({ type: 'error', msg: `Not enough coins (needs 🪙${cost})` });
    shiftContent(plot, plot.x - x, plot.y - y);
    Object.assign(plot, rect);
    this.payLand(s, cost);
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
    if (!rect) return s.send({ type: 'error', msg: 'Plots must line up exactly to merge' });
    const rest = Object.fromEntries(Object.entries(this.plots).filter(([id]) => +id !== o.id));
    const err = landError(rest, plot.id, rect, this.world);
    if (err) return s.send({ type: 'error', msg: err });
    const cost = this.landCost(s, o.w * o.h);
    if (cost > s.profile.coins) return s.send({ type: 'error', msg: `Not enough coins (needs 🪙${cost})` });
    shiftContent(plot, plot.x - rect.x, plot.y - rect.y);
    Object.assign(plot, rect);
    delete this.plots[o.id];
    this.payLand(s, cost);
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

  // ----- roads -----
  // Pave (on) or dig up (off) road tiles on your own plot. Roads stay public, so a
  // road crossing your land can be moved but not cut (see roadEditError).
  road(s, { plotId, tiles, on }) {
    const plot = this.ownPlot(s, plotId);
    if (!plot || !Array.isArray(tiles) || tiles.length > 400) return;
    const list = tiles.filter((t) => Array.isArray(t) && t.length === 2 && t.every(Number.isInteger));
    const err = roadEditError(this.world, plot, list, !!on);
    if (err) return s.send({ type: 'error', msg: err });
    const add = new Set(this.roads.add), del = new Set(this.roads.del);
    for (const [lx, ly] of list) {
      const i = (plot.y + ly) * MAP_W + plot.x + lx;
      if (on) { if (this.world.baseRoads[i]) del.delete(i); else add.add(i); }
      else { if (this.world.baseRoads[i]) del.add(i); else add.delete(i); }
    }
    this.setRoads({ add: [...add], del: [...del] });
  }

  // City Hall approved closing the roads on this plot: every road tile on it goes.
  closeRoadsOn(plot) {
    const add = new Set(this.roads.add), del = new Set(this.roads.del);
    for (let ly = 0; ly < plot.h; ly++) for (let lx = 0; lx < plot.w; lx++) {
      if (!roadIn(this.world, plot, lx, ly)) continue;
      const i = (plot.y + ly) * MAP_W + plot.x + lx;
      if (this.world.baseRoads[i]) del.add(i); else add.delete(i);
    }
    this.setRoads({ add: [...add], del: [...del] });
  }

  // ----- City Hall -----
  day() { return worldClock(this.now(), this.epoch).day; }

  // Government business happens in person, at City Hall.
  cityAction(s, fn) {
    const tx = Math.floor(s.x / TILE), ty = Math.floor(s.y / TILE);
    const here = tx >= CIVIC.x && ty >= CIVIC.y && tx < CIVIC.x + CIVIC.w && ty < CIVIC.y + CIVIC.h;
    const err = here ? fn() : 'Come to City Hall to do that';
    if (err) return s.send({ type: 'error', msg: err });
    this.sendCity();
  }

  sendCity() {
    this.city.dirtyView = false;
    const day = this.day();
    for (const o of this.sessions.values()) o.send({ type: 'city', city: this.city.view(day, o.profile) });
  }

  setRoads(roads) {
    this.roads = roads;
    applyRoads(this.world, roads);
    this.mark('roads');
    this.broadcast({ type: 'roads', roads });
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
      return say('testingcheats true · money <amount> · motherlode · kaching · rosebud · freerealestate on/off · bb.enablefreebuild · tp cityhall|park|fair|square · fillneeds · needs <need> <0-100>');
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
      case 'tp': {
        const spots = { cityhall: [139.5, 37.5], hall: [139.5, 37.5], park: [138.5, 47.5], fair: [129.5, 69.5], square: [60, 59.5], plaza: [60, 59.5] };
        const to = spots[args[0]] || (args.length === 2 && args.every((a) => Number.isFinite(+a)) ? [+args[0], +args[1]] : null);
        if (!to) return say('Usage: tp cityhall | park | fair | square | <x> <y> (tiles)');
        if (s.act) { this.stopActivity(s, false); this.sendNeeds(s); }
        s.x = to[0] * TILE; s.y = to[1] * TILE; s.level = 0; s.lastMove = this.now();
        s.send({ type: 'pos', x: s.x, y: s.y, level: 0 });
        return say(spots[args[0]] ? `Whoosh! You’re at the ${args[0]}.` : 'Whoosh!');
      }
      case 'fillneeds': case 'sims.fill_all_commodities':
        Object.assign(s.profile.needs, fullNeeds(), { hunger: 100, energy: 100, bladder: 100, hygiene: 100, fun: 100 });
        this.sendNeeds(s);
        return say('All needs filled.');
      case 'needs': {
        const [need, v] = [args[0], Number(args[1])];
        if (!(need in s.profile.needs) || !Number.isFinite(v)) return say('Usage: needs hunger|energy|bladder|hygiene|fun|health <0-100>');
        s.profile.needs[need] = Math.max(0, Math.min(100, v));
        this.sendNeeds(s);
        return say(`${need} set to ${s.profile.needs[need]}.`);
      }
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
    const target = p ? plotEntrance(this.world, p) : this.world.spawn;
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
    const ctx = { now, epoch: this.epoch, playerFacts: this.playerFacts(s), gossip: this.gossip.slice(-6), city: n.def.clerk ? this.city.brief() : null };
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

  // ---------- needs & activities ----------
  // Needs run down while you're online; activities fill them back up.
  tickNeeds(s, now) {
    const pr = s.profile;
    // (capped, so a stalled server or a skipped clock never drains needs in one go)
    const { needs, low, faint } = advanceNeeds(pr.needs, Math.min(5000, now - s.needsAt) / HOUR_MS, s.act?.id);
    s.needsAt = now;
    pr.needs = needs;
    if (s.act) {
      const view = this.plots[s.act.plotId] && levelView(this.plots[s.act.plotId], s.act.level);
      if (view?.obj[s.act.key]?.t !== s.act.item) this.stopActivity(s, true);
      else if (activityDone(s.act.id, needs, (now - s.act.t0) / HOUR_MS)) this.stopActivity(s, true);
    }
    for (const id of low) s.send({ type: 'toast', text: `${NEEDS.find((n) => n.id === id).icon} ${NEEDS.find((n) => n.id === id).low}` });
    if (faint) return this.faint(s);
    if (now - s.needsSent >= 2000) this.sendNeeds(s);
    if (now - (s.needsSaved || 0) >= 20_000) { s.needsSaved = now; this.markProfile(pr); }
  }

  sendNeeds(s) {
    s.needsSent = this.now();
    const n = s.profile.needs;
    s.send({ type: 'needs', needs: Object.fromEntries(Object.entries(n).map(([k, v]) => [k, Math.round(v * 10) / 10])), act: s.act?.id || null });
  }

  // Health hit zero: you pass out and wake up at home, patched up by the village doctor.
  faint(s) {
    if (s.act) this.stopActivity(s, false);
    const n = s.profile.needs;
    Object.assign(n, { health: 45, energy: Math.max(n.energy, 50), hunger: Math.max(n.hunger, 40), bladder: Math.max(n.bladder, 60), hygiene: Math.max(n.hygiene, 30), fun: Math.max(n.fun, 30) });
    const fee = Math.min(25, s.profile.coins);
    if (fee) this.coins(s, -fee);
    this.home(s);
    s.send({ type: 'toast', text: `😵 You fainted! The village doctor patched you up${fee ? ` (🪙${fee})` : ''}. Look after your needs!` });
    this.sendNeeds(s);
  }

  // Use a piece of furniture: { plotId, level, lx, ly, act }. Your own home, or a home
  // whose owner is there with you.
  use(s, { plotId, level = 0, lx, ly, act }) {
    const plot = this.plots[plotId];
    const a = ACTIVITIES[act];
    if (!plot || !a || !Number.isInteger(lx) || !Number.isInteger(ly)) return;
    level = this.lvl(level);
    if (plot.owner !== s.profile.id) {
      const host = plot.owner && this.sessions.get(plot.owner);
      if (!host || plotIdAtPixel(this.world, host.x, host.y) !== plot.id) return s.send({ type: 'error', msg: 'You can only use things in someone’s home while they’re in' });
    }
    const view = levelView(plot, level);
    const hit = objAt(view, lx, ly);
    if (!hit || !usesOf(hit.obj.t).includes(act)) return;
    const [ax, ay] = hit.key.split(',').map(Number);
    const [w, h] = footprint(hit.obj.t, hit.obj.r || 0);
    // Close enough? (within about a tile of the item, on its floor)
    const x0 = (plot.x + ax) * TILE, y0 = (plot.y + ay) * TILE, x1 = x0 + w * TILE, y1 = y0 + h * TILE;
    const dx = Math.max(x0 - s.x, 0, s.x - x1), dy = Math.max(y0 - s.y, 0, s.y - y1);
    if ((s.level || 0) !== level || Math.hypot(dx, dy) > TILE * 1.6) return s.send({ type: 'error', msg: `Walk up to the ${ITEMS[hit.obj.t].name.toLowerCase()} first` });
    if (a.stove && ![plot, plot.l1].some((v) => v && Object.values(v.obj).some((o) => o.t === 'stove'))) return s.send({ type: 'error', msg: 'You need a stove to cook' });
    for (const o of this.sessions.values()) if (o !== s && o.act?.plotId === plot.id && o.act.key === hit.key && o.act.level === level) return s.send({ type: 'error', msg: `${o.profile.name} is using that` });
    const cost = a.cost || 0;
    if (cost > s.profile.coins) return s.send({ type: 'error', msg: `Not enough coins (needs 🪙${cost})` });
    if (s.act) this.stopActivity(s, false);
    if (cost) this.coins(s, -cost);
    s.act = { id: act, t0: this.now(), plotId: plot.id, level, key: hit.key, item: hit.obj.t, back: { x: s.x, y: s.y, level: s.level } };
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    if (a.seat) {
      // Sit or lie on it, facing its front.
      s.x = cx; s.y = cy;
      s.dir = [0, 2, 1, 3][hit.obj.r || 0];
      s.send({ type: 'pos', x: s.x, y: s.y, level });
    } else {
      s.dir = Math.abs(cx - s.x) > Math.abs(cy - s.y) ? (cx < s.x ? 2 : 3) : (cy < s.y ? 1 : 0);
    }
    s.moving = 0;
    this.sendNeeds(s);
  }

  // Stop what you're doing (walking away, or it's done); `send` tells your client.
  stopActivity(s, send = true) {
    const act = s.act;
    if (!act) return;
    s.act = null;
    if (ACTIVITIES[act.id]?.seat) {
      s.x = act.back.x; s.y = act.back.y; s.level = act.back.level;
      s.lastMove = this.now();
      if (send) s.send({ type: 'pos', x: s.x, y: s.y, level: s.level });
    }
    if (send) this.sendNeeds(s);
  }

  // Eat something from your bag.
  eat(s, { item }) {
    const food = FOODS[item];
    if (!food || !(s.profile.inv[item] > 0)) return;
    if (s.profile.needs.hunger >= 98 && !food.energy) return s.send({ type: 'error', msg: 'You’re full!' });
    this.bag(s, item, -1);
    for (const [k, v] of Object.entries(food)) s.profile.needs[k] = Math.min(100, s.profile.needs[k] + v);
    s.send({ type: 'toast', text: `${GOODS[item].icon} Yum! ${GOODS[item].name}` });
    this.sendNeeds(s);
  }

  // ---------- simulation ----------
  tick() {
    const now = this.now();
    const dt = Math.min(0.5, (now - this.lastTick) / 1000);
    this.lastTick = now;
    this.city.update(this.day());
    if (this.city.dirtyView && now - (this.lastCitySend || 0) > 1000) { this.lastCitySend = now; this.sendCity(); }
    if (this.city.statsDirty && now - (this.lastCitySave || 0) > 30_000) { this.lastCitySave = now; this.city.statsDirty = false; this.mark('city'); }
    if (!this.sessions.size) return;
    // Drop players we haven't heard from for 450 ticks, about 45 s (a phone that went to
    // sleep mid-game). Counted in ticks so a stalled server never drops everyone at once.
    for (const o of [...this.sessions.values()]) {
      o.quiet = (o.quiet || 0) + 1;
      if (o.quiet > 450) { this.leave(o); try { o.conn.close(); } catch { /* gone */ } }
    }
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
    for (const s of this.sessions.values()) if (now - s.needsAt >= 1000) this.tickNeeds(s, now);
    this.sendState(now);
  }

  // Positions, with interest management: each player hears about the people near them
  // (within AOI_RANGE) whenever they move, and about everyone once a second (for the map,
  // and as a heartbeat). Rows that didn't change since last tick aren't sent at all.
  sendState(now) {
    const round = (v) => Math.round(v * 10) / 10;
    const rows = [], changed = new Set();
    this.lastRows ||= new Map();
    for (const o of this.sessions.values()) {
      const row = [o.profile.id, round(o.x), round(o.y), o.dir, o.moving || 0, o.level || 0, o.act?.id || 0];
      const k = row.join(',');
      if (this.lastRows.get(o.profile.id) !== k) { changed.add(o.profile.id); this.lastRows.set(o.profile.id, k); }
      rows.push([o, row]);
    }
    for (const id of this.lastRows.keys()) if (!this.sessions.has(id)) this.lastRows.delete(id);
    const npcRows = Object.values(this.npcs).map((n) => [n.id, round(n.x), round(n.y), n.dir, n.moving ? 1 : 0]);
    const npcSig = JSON.stringify(npcRows);
    const npcMoved = npcSig !== this.lastNpcSig;
    this.lastNpcSig = npcSig;
    const full = now - (this.lastFull || 0) >= 1000;
    if (full) this.lastFull = now;
    const R = AOI_RANGE * TILE;
    for (const s of this.sessions.values()) {
      let p;
      if (full) p = rows.map(([, row]) => row);
      else p = rows.filter(([o, row]) => o !== s && changed.has(row[0]) && Math.abs(o.x - s.x) < R && Math.abs(o.y - s.y) < R).map(([, row]) => row);
      if (!full && !p.length && !npcMoved) continue;
      s.send({ type: 'state', t: now, p, n: full || npcMoved ? npcRows : [] });
    }
  }
}

function blankPlot(id, r) {
  return { id, x: r.x, y: r.y, w: r.w, h: r.h, owner: null, ownerName: null, farm: null, floor: {}, obj: {}, l1: { floor: {}, obj: {} }, walls: {}, roofs: [] };
}

// Remove (and price up) everything on a plot that sits on a public road tile.
function clearRoadContent(world, plot) {
  let refund = 0;
  const onRoad = (x, y) => inInterior(plot, x, y) && roadIn(world, plot, x, y);
  for (const view of [plot, plot.l1]) {
    if (!view) continue;
    for (const k of Object.keys(view.floor)) {
      const [x, y] = k.split(',').map(Number);
      if (onRoad(x, y)) { refund += ITEMS[view.floor[k]]?.price || 0; delete view.floor[k]; }
    }
    for (const [k, o] of Object.entries(view.obj)) {
      const [x, y] = k.split(',').map(Number);
      if (tilesOf(o.t, o.r || 0, x, y).some(([tx, ty]) => onRoad(tx, ty))) { refund += ITEMS[o.t]?.price || 0; delete view.obj[k]; }
    }
  }
  for (const [k, w] of Object.entries(plot.walls)) {
    const e = parseEdge(k);
    const [ax, ay] = e.d === 'h' ? [e.x, e.y - 1] : [e.x - 1, e.y];
    if (onRoad(ax, ay) || onRoad(e.x, e.y)) { refund += (ITEMS[w.m]?.price || 0) + (ITEMS[w.f]?.price || 0); delete plot.walls[k]; }
  }
  plot.roofs = plot.roofs.filter((rf) => {
    for (let j = 0; j < rf.h; j++) for (let i = 0; i < rf.w; i++) if (onRoad(rf.x + i, rf.y + j)) { refund += (ITEMS[rf.m]?.price || 0) * rf.w * rf.h; return false; }
    return true;
  });
  occChanged(plot);
  return refund;
}

function normalizePlot(p) {
  return { ...blankPlot(p.id, p), ...p, l1: p.l1 || { floor: {}, obj: {} }, walls: p.walls || {}, roofs: p.roofs || [] };
}

import { generateWorld, applyRoads, worldClock, publicAreaAt, plotIdAtPixel, TILE, PLAYER_SPEED, RUN_MULT, WORLD_VERSION, STARTER_PLOTS, MAP_W, CIVIC, T, STEP_MS } from '../../shared/world.js';
import { City } from './city.js';
import { roomRegion, roomTiles as roomTilesOf, extract, stockFragment, rotateTimes, removeAt, placeError as fragError, applyAt, fragmentValue, cleanFragment } from '../../shared/blueprint.js';
import { STYLED_ROOMS } from '../../shared/rooms.js';
import { ITEMS, GOODS, CROPS, START_COINS, cropStage, isWet, isSoil, itemName } from '../../shared/catalog.js';
import {
  key, inInterior, tilesOf, footprint, objAt, featurePair, wallRun, featureWidth, occChanged, placementError, canStand, levelView, canRotate,
  edgeKey, parseEdge, wallError, wallTouchesFeet, roofError, roofAt, indexPlots, roadIn, roadEditError, plotEntrance,
  landError, contentFits, shiftContent, mergedRect, splitRects, hasContent, LAND_PRICE, stepLevel, buryPipes } from '../../shared/plot.js';
import { NPCS, heartsOf, HEART_GIFTS } from '../../shared/npcs.js';
import { HOUR_MS, NEEDS, ACTIVITIES, FOODS, PLATES, sanitizeNeeds, usesOf, advanceNeeds, activityDone, fullNeeds } from '../../shared/needs.js';
import { sanitizeLook, randomLook, shirtColor } from '../../shared/look.js';
import { Npc, parseAiReply, REPLY_SCHEMA, setMarket } from './npc.js';
import { Life } from './life.js';
import { Mood } from './mood.js';
import { Business } from './business.js';
import { Farm } from './farm.js';
import { Social } from './social.js';
import { Fishing } from './fishing.js';
import { Events } from './events.js';
import { Nature } from './nature.js';
import { Agents, applyHomeEdits } from './agents.js';
import { VENTURES, AMBITIONS } from '../../shared/agents.js';
import { townShopPlots, TOWN_PLOT_BASE } from '../../shared/townshops.js';
import { waterCrop, WET_MS, QUALITY, ANIMALS } from '../../shared/farm.js';
import { NPC_ACTS, readTone, blendTone } from '../../shared/village.js';

// Change a bag's contents, keeping count of silver and gold ones (profile.qual[item] =
// [silver, gold]; the rest are normal).
export function changeInv(p, item, delta, q = 0, best = false) {
  const inv = p.inv;
  const have = Math.max(0, inv[item] || 0);
  const qual = (p.qual ||= {});
  const ql = qual[item] ? [...qual[item]] : [0, 0];
  const took = [0, 0, 0];
  if (delta > 0 && q) ql[q - 1] += delta;
  else if (delta < 0) {
    let n = Math.min(-delta, have);
    for (const t of best ? [2, 1, 0] : [0, 1, 2]) {
      const avail = t ? ql[t - 1] : Math.max(0, have - ql[0] - ql[1]);
      const k = Math.min(n, avail);
      took[t] += k; n -= k;
      if (t) ql[t - 1] -= k;
    }
  }
  inv[item] = have + delta;
  if (inv[item] <= 0) delete inv[item];
  if (inv[item] && (ql[0] > 0 || ql[1] > 0)) qual[item] = ql; else delete qual[item];
  return took;
}

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
    // v6 widened the map (168 -> 256 tiles): tile indices saved before then move.
    const oldW = (saved.meta?.version || 0) < 6 && saved.meta ? 168 : 0;
    const remap = (i) => (oldW ? (Math.floor(+i / oldW) * MAP_W + (+i % oldW)) : +i);
    if (oldW && saved.nature) {
      for (const k of ['cut', 'grown']) if (saved.nature[k]) saved.nature[k] = Object.fromEntries(Object.entries(saved.nature[k]).map(([i, v]) => [remap(i), v]));
    }
    this.roads = { add: (saved.roads?.add || []).map(remap), del: (saved.roads?.del || []).map(remap) };
    applyRoads(this.world, this.roads);
    this.epoch = saved.meta?.epoch || this.now();
    // The clock's speed changed since this world was saved: keep today's date and time
    // where they were (time so far, rescaled to the new speed).
    const savedStep = saved.meta ? saved.meta.stepMs || 6000 : STEP_MS;
    if (savedStep !== STEP_MS) { this.epoch = this.now() - (this.now() - this.epoch) * (STEP_MS / savedStep); this.dirtyLater = [...(this.dirtyLater || []), 'meta']; }
    this.profiles = saved.profiles || {}; // user id -> profile
    this.gossip = saved.gossip || [];
    // Plots are live data keyed by id. A save from an older map layout starts fresh land.
    const sameMap = (saved.meta?.version || 0) >= 3;
    this.plots = {};
    if (sameMap && saved.plots && Object.keys(saved.plots).length) {
      for (const s of Object.values(saved.plots)) if (s) this.plots[s.id] = normalizePlot(s);
      this.nextPlotId = saved.meta.nextPlotId ?? Math.max(...Object.keys(this.plots).map(Number).filter((n) => n < TOWN_PLOT_BASE)) + 1;
    } else {
      [...STARTER_PLOTS, ...this.world.lots].forEach((r, i) => { this.plots[i] = blankPlot(i, r); });
      this.nextPlotId = STARTER_PLOTS.length + this.world.lots.length;
      if (saved.meta) {
        for (const prof of Object.values(this.profiles)) { prof.plotId = null; prof.x = prof.y = null; }
        for (const uid of Object.keys(this.profiles)) this.dirtyLater = [...(this.dirtyLater || []), `profile:${uid}`];
      }
      this.freshLand = true;
    }
    // v6: the countryside's lots go on the market (wherever nobody has built already).
    if (oldW && !this.freshLand) {
      const mine = Object.values(this.plots).filter((p) => p && Number(p.id) < TOWN_PLOT_BASE);
      const clear = (r) => !mine.some((p) => r.x < p.x + p.w && p.x < r.x + r.w && r.y < p.y + p.h && p.y < r.y + r.h);
      for (const r of this.world.lots) if (clear(r)) { const p = blankPlot(this.nextPlotId++, r); this.plots[p.id] = p; this.dirtyLater = [...(this.dirtyLater || []), `plot:${p.id}`]; }
      this.dirtyLater = [...(this.dirtyLater || []), 'meta', 'roads', 'nature'];
    }
    // The village shops (walk-in buildings) are rebuilt from their layout every start.
    for (const id of Object.keys(this.plots)) if (Number(id) >= TOWN_PLOT_BASE) delete this.plots[id];
    for (const p of townShopPlots(saved.city?.projects || [])) this.plots[p.id] = p;
    // Pipes and cables used to be ground objects; they're buried now.
    for (const p of Object.values(this.plots)) if (buryPipes(p)) { p.rev = (p.rev || 0) + 1; this.dirtyLater = [...(this.dirtyLater || []), `plot:${p.id}`]; }
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
    this.life = new Life(this);
    this.mood = new Mood(this);
    this.biz = new Business(this);
    this.farm = new Farm(this, saved.farm);
    this.social = new Social(this, saved.social);
    this.fishing = new Fishing(this);
    this.events = new Events(this, saved.events);
    setMarket((item) => this.farm.sellMult(item));
    for (const id of Object.keys(NPCS)) this.npcs[id] = new Npc(id, saved.npcs?.[id]);
    applyHomeEdits(this.plots, this.npcs);
    this.agents = new Agents(this, saved.agents);
    this.sessions = new Map(); // player id -> session
    this.city = new City(this, saved.city);
    this.dirty = new Set(saved.meta && !this.freshLand ? [] : ['meta']);
    if (this.freshLand) for (const id of Object.keys(this.plots)) this.dirty.add(`plot:${id}`);
    for (const k of this.dirtyLater || []) this.dirty.add(k);
    // Wild trees and rocks (cleared from land people own).
    this.nature = new Nature(this, saved.nature);
    for (const p of Object.values(this.plots)) if (p.owner) this.nature.clearPlot(p);
    // Older homes and shops get their mailbox too.
    for (const p of Object.values(this.plots)) if (this.ensureMailbox(p)) { p.rev = (p.rev || 0) + 1; this.dirty.add(`plot:${p.id}`); }
    this.lastTick = this.now();
  }

  // ---------- persistence ----------
  mark(k) { this.dirty.add(k); }
  takeDirty() {
    const out = {};
    for (const k of this.dirty) {
      const [kind, id] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
      if (k === 'meta') out[k] = { epoch: this.epoch, version: WORLD_VERSION, nextPlotId: this.nextPlotId, stepMs: STEP_MS };
      else if (k === 'gossip') out[k] = this.gossip;
      else if (k === 'roads') out[k] = this.roads;
      else if (k === 'city') out[k] = this.city.s;
      else if (k === 'farm') out[k] = this.farm.save();
      else if (k === 'social') out[k] = this.social.save();
      else if (k === 'events') out[k] = this.events.save();
      else if (k === 'nature') out[k] = this.nature.save();
      else if (k === 'agents') out[k] = this.agents.save();
      else if (kind === 'plot') { if (this.plots[id]?.town) continue; out[k] = this.plots[id] ?? null; }
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
      else if (kind === 'farm') saved.farm = v;
      else if (kind === 'social') saved.social = v;
      else if (kind === 'events') saved.events = v;
      else if (kind === 'nature') saved.nature = v;
      else if (kind === 'agents') saved.agents = v;
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
    return { id: p.id, name: p.name, color: p.color, look: p.look, x: s.x, y: s.y, dir: s.dir, moving: s.moving, level: s.level, act: s.ride ? 'drive' : s.fish ? 'fish' : s.act?.id || 0, carry: s.carry?.food || 0 };
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
      case 'wallPaint': return this.wallPaint(s, msg);
      case 'wallHeight': return this.wallHeight(s, msg);
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
      case 'cityWithdraw': return this.cityAction(s, () => this.city.withdraw(s, this.day()));
      case 'cityVote': return this.cityAction(s, () => this.city.vote(s, msg.office, msg.candidate, this.day()));
      case 'cityPropose': return this.cityAction(s, () => this.city.propose(s, msg, this.day()));
      case 'councilVote': return this.cityAction(s, () => this.city.councilVote(s, msg.id, msg.vote));
      case 'mayorAct': return this.cityAction(s, () => this.city.mayorAct(s, msg.id, !!msg.sign, this.day()));
      case 'cheat': return this.cheat(s, msg);
      case 'setLook': return this.setLook(s, msg);
      case 'harvest': return this.harvest(s, msg);
      case 'use': return this.use(s, msg);
      case 'questAccept': return this.life.accept(s, msg);
      case 'bizStart': return this.cityAction(s, () => this.biz.start(s, msg));
      case 'bizRename': return this.biz.rename(s, msg);
      case 'bizClosed': return this.biz.setClosed(s, msg);
      case 'bizHire': return this.biz.hire(s, msg);
      case 'bizFire': return this.biz.fire(s);
      case 'stock': return this.biz.stock(s, msg);
      case 'restock': return this.biz.restock(s, msg);
      case 'buyStock': return this.biz.buy(s, msg);
      case 'buyCart': return this.biz.buyCart(s, msg);
      case 'stallRent': return this.agents.rent(s, msg);
      case 'craft': return this.biz.craft(s, msg);
      case 'collect': return this.biz.collect(s, msg);
      case 'questDecline': return this.life.decline(s, msg);
      case 'questAbandon': return this.life.abandon(s, msg);
      case 'questTurnIn': return this.life.turnIn(s, msg);
      case 'stop': return this.stopActivity(s, true);
      case 'eat': return this.eat(s, msg);
      case 'home': return this.home(s);
      case 'npcOpen': return this.npcOpen(s, msg);
      case 'npcClose': return this.npcClose(s, msg);
      case 'npcTalk': return this.npcTalk(s, msg);
      case 'convoJoin': return this.agents.join(s, msg);
      case 'convoSay': return this.agents.say(s, msg);
      case 'convoLeave': return this.agents.leave(s, msg);
      case 'offerAccept': return this.agents.offerAccept(s, msg);
      case 'offerDecline': return this.agents.offerDecline(s, msg);
      case 'buy': return this.buy(s, msg);
      case 'sell': return this.sell(s, msg);
      case 'gift': return this.gift(s, msg);
      case 'drop': return this.farm.drop(s, msg);
      case 'trash': return this.farm.trash(s, msg);
      case 'whimDismiss': return this.mood.dismiss(s);
      case 'giveTo': return this.farm.giveTo(s, msg);
      case 'utilStart': return this.cityAction(s, () => this.farm.utilStart(s, msg));
      case 'utilPay': return this.cityAction(s, () => this.farm.utilPay(s, msg));
      case 'utilStop': return this.cityAction(s, () => this.farm.utilStop(s, msg));
      case 'hireHand': return this.cityAction(s, () => this.farm.hireHand(s, msg));
      case 'fireHand': return this.cityAction(s, () => this.farm.fireHand(s));
      case 'drive': return this.farm.mount(s, msg);
      case 'park': return this.farm.park(s);
      case 'rideMode': return this.farm.rideMode(s, msg);
      case 'farmWork': return this.farm.work(s, msg);
      case 'animal': return this.farm.animal(s, msg);
      case 'tradeAsk': return this.social.tradeAsk(s, msg);
      case 'tradeSet': return this.social.tradeSet(s, msg);
      case 'tradeOk': return this.social.tradeOk(s);
      case 'tradeCancel': return this.social.tradeCancel(s);
      case 'boardPost': return this.social.boardPost(s, msg);
      case 'boardBuy': return this.social.boardBuy(s, msg);
      case 'boardCancel': return this.social.boardCancel(s, msg);
      case 'mailSend': return this.social.mailSend(s, msg);
      case 'mailTake': return this.social.mailTake(s, msg);
      case 'mailRead': return this.social.mailRead(s, msg);
      case 'mailDelete': return this.social.mailDelete(s, msg);
      case 'helperAdd': return this.social.helperAdd(s, msg);
      case 'helperRemove': return this.social.helperRemove(s, msg);
      case 'store': return this.social.store(s, msg);
      case 'fishCast': return this.fishing.cast(s);
      case 'fishReel': return this.fishing.reel(s);
      case 'fishStop': return this.fishing.stop(s);
      case 'festEnter': return this.events.enter(s, msg);
      case 'chop': return this.nature.hit(s, msg);
      case 'tree': return this.nature.tree(s, msg);
      case 'date': return this.date(s, msg);
      case 'loanTake': return this.cityAction(s, () => this.city.loan(s, msg.amount, this.day()));
      case 'loanRepay': return this.cityAction(s, () => this.city.repay(s, msg.amount));
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
      drops: this.farm.drops,
      nature: this.nature.view(), weather: this.weather || null, convos: this.agents.list(),
      market: this.farm.marketView(),
      util: profile.util || {}, hand: profile.hand || null, qual: profile.qual || {},
    });
    this.broadcast({ type: 'join', player: this.publicPlayer(s) }, s);
    this.life.send(s);
    this.biz.send(s);
    this.farm.syncUtil(profile);
    this.social.sendMail(s); this.social.sendBoard(s);
    this.events.send(s); this.events.sendGoals(s); this.events.sendPaper(s);
    if (profile.plotId != null) this.broadcast({ type: 'plot', plot: this.plots[profile.plotId] });
  }

  leave(s) {
    if (!s.profile || this.sessions.get(s.profile.id) !== s) return;
    if (s.act) this.stopActivity(s, false);
    if (s.ride) this.farm.park(s, true);
    if (s.trade) this.social.tradeCancel(s);
    s.fish = null;
    this.sessions.delete(s.profile.id);
    s.profile.x = s.x; s.profile.y = s.y; s.profile.level = s.level;
    this.markProfile(s.profile);
    for (const n of Object.values(this.npcs)) if (n.talkingTo === s.profile.id) n.talkingTo = null;
    for (const c of this.agents.convos.values()) if (c.players.has(s.profile.id)) this.agents.leave(s, { id: c.id });
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
  // A plot you may work on: your own, or one whose owner made you a helper (need:
  // 'farm' for farming, 'build' for building).
  ownPlot(s, plotId, need = 'build') {
    const plot = this.plots[plotId];
    if (!plot) return null;
    if (!this.canWork(plot, s.profile.id, need)) { s.send({ type: 'error', msg: "That isn't your plot" }); return null; }
    return plot;
  }
  canWork(plot, pid, need = 'farm') {
    if (!plot?.owner) return false;
    if (plot.owner === pid) return true;
    const h = plot.helpers?.[pid];
    return !!h && (h.role === 'build' || need === 'farm');
  }

  // Count something a player did (for goals and quests).
  count(p, key, n = 1) {
    if (!p || !n) return;
    p.stats ||= {};
    p.stats[key] = (p.stats[key] || 0) + n;
    this.markProfile(p);
    this.events.onStat(p);
  }

  // Village plots for public projects the council has built.
  addTownPlots() {
    let added = false;
    for (const p of townShopPlots(this.city.s.projects)) {
      if (this.plots[p.id]) continue;
      this.plots[p.id] = p;
      added = true;
      this.broadcast({ type: 'plot', plot: p });
    }
    if (added) indexPlots(this.world, this.plots);
  }

  coins(s, delta, quiet = false) {
    if (delta > 0 && !quiet) this.count(s.profile, 'earned', delta);
    s.profile.coins += delta;
    this.city.onCoins(delta);
    s.send({ type: 'coins', coins: s.profile.coins });
    this.markProfile(s.profile);
  }

  // Add (or take, delta < 0) items. q: quality of what's added (0, 1 ★, 2 ★★). Taking
  // uses up normal ones first, or the best first (best: selling). Returns how many of
  // each quality were taken.
  bag(s, item, delta, q = 0, best = false) {
    const took = changeInv(s.profile, item, delta, q, best);
    s.send({ type: 'inv', inv: s.profile.inv, qual: s.profile.qual || {} });
    this.markProfile(s.profile);
    return took;
  }

  plotChanged(plot) {
    plot.rev = (plot.rev || 0) + 1; // clients rebuild a plot only when its rev changes
    occChanged(plot);
    this.mark(`plot:${plot.id}`);
    this.broadcast({ type: 'plot', plot });
    // Removed stairs or floors can leave someone with nothing to stand on.
    for (const o of this.sessions.values()) {
      if (o.level && !canStand(this.world, this.plots, o.x, o.y, o.level)) this.unstick(o);
    }
  }

  claim(s, { plotId, business }) {
    const plot = this.plots[plotId];
    if (!plot) return;
    if (business) { const r = this.biz.claimShop(s, plot); if (plot.owner === s.profile.id) this.nature.clearPlot(plot, s.profile); return r; }
    if (s.profile.plotId != null) return s.send({ type: 'error', msg: 'You already own a plot' });
    if (plot.owner) return s.send({ type: 'error', msg: 'That plot is taken' });
    plot.owner = s.profile.id;
    plot.ownerName = s.profile.name;
    plot.farm = s.profile.farm || '';
    s.profile.plotId = plot.id;
    this.markProfile(s.profile);
    s.send({ type: 'claimed', plotId: plot.id });
    this.plotChanged(plot);
    this.nature.clearPlot(plot, s.profile);
    if (this.ensureMailbox(plot)) this.plotChanged(plot);
    this.addGossip('the village', `${s.profile.name} just moved into plot ${plot.id + 1}`);
  }

  // Every home and shop gets a mailbox by the road (mail is sent and read from one).
  // Returns true if it added one.
  ensureMailbox(plot) {
    if (!plot?.owner || plot.town || Object.values(plot.obj).some((o) => o.t === 'mailbox')) return false;
    const w = this.world, best = [];
    for (let ly = 0; ly < plot.h; ly++) for (let lx = 0; lx < plot.w; lx++) {
      if (lx > 0 && ly > 0 && lx < plot.w - 1 && ly < plot.h - 1) continue; // edge tiles only
      if (placementError(plot, lx, ly, 'mailbox', 0, 0, w) || this.someoneOn(plot, [[lx, ly]])) continue;
      // By the road, near a corner, is best.
      const x = plot.x + lx, y = plot.y + ly;
      const road = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => w.tiles[(y + dy) * MAP_W + x + dx] === T.PATH && w.plotAt[(y + dy) * MAP_W + x + dx] !== plot.id);
      const corner = Math.min(lx, plot.w - 1 - lx) + Math.min(ly, plot.h - 1 - ly);
      best.push([(road ? 0 : 100) + Math.abs(corner - 1), lx, ly]);
    }
    if (!best.length) return false;
    best.sort((a, b) => a[0] - b[0]);
    plot.obj[key(best[0][1], best[0][2])] = { t: 'mailbox' };
    return true;
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
    const err = placementError(plot, lx, ly, item, r, level, this.world) || (def?.crop && this.farm.seasonError(def.crop, plot, lx, ly));
    const fromBag = def && (def.shop || (def.layer === 'obj' && !def.crop && s.profile.inv[item] > 0));
    if (err) return s.send({ type: 'error', msg: err });
    const view = levelView(plot, level);
    const k = key(lx, ly);
    const free = s.cheats.build;
    if (fromBag && !free) {
      if (!s.profile.inv[item]) return s.send({ type: 'error', msg: `Buy a ${def.name} from ${NPCS[def.shop].name} first` });
    } else if (!free) {
      const refund = def.layer === 'floor' && view.floor[k] ? ITEMS[view.floor[k]].price : 0;
      if (s.profile.coins + refund < def.price) return s.send({ type: 'error', msg: 'Not enough coins' });
    }
    if (def.solid && !level && this.someoneOn(plot, tilesOf(item, r, lx, ly))) return s.send({ type: 'error', msg: 'Someone is standing there' });
    if (def.layer === 'under') {
      ((plot.under ||= {})[item] ||= {})[k] = 1;
      if (!free) this.coins(s, -def.price);
    } else if (def.layer === 'floor') {
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
      if (free) { /* bb.enablefreebuild */ } else if (fromBag) this.bag(s, item, -1);
      else this.coins(s, -def.price);
      if (def.crop) this.count(s.profile, 'plant');
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
    if (ITEMS[wall.m]?.fence) return s.send({ type: 'error', msg: 'Fences take a gate, not a door: pick one from Fences' });
    if (wall.f === f && featureWidth(f) < 2) return;
    // Double doors take this segment and the next one along the wall.
    const keys = [k];
    if (featureWidth(f) === 2) {
      const k2 = d === 'h' ? edgeKey(level, d, x + 1, y) : edgeKey(level, d, x, y + 1);
      if (!plot.walls[k2]) return s.send({ type: 'error', msg: `${def.name} need two wall segments side by side` });
      keys.push(k2);
    }
    // Whatever was there goes (both halves of an old double door).
    let refund = 0;
    for (const kk of keys) {
      const w = plot.walls[kk];
      if (!w.f) continue;
      const e = parseEdge(kk), pair = featurePair(plot, level, e.d, e.x, e.y);
      refund += ITEMS[w.f].price / (featureWidth(w.f));
      if (pair.partner && !keys.includes(pair.partner)) { refund += ITEMS[w.f].price / 2; delete plot.walls[pair.partner].f; }
    }
    const cost = s.cheats.build ? 0 : Math.round(def.price - refund);
    if (cost > s.profile.coins) return s.send({ type: 'error', msg: 'Not enough coins' });
    for (const kk of keys) { plot.walls[kk].f = f; delete plot.walls[kk].fc; }
    this.coins(s, -cost);
    this.plotChanged(plot);
  }

  // Wall paint: one face of a wall (side 0 = north/west, 1 = south/east), or with
  // fill 'room' every inside face of that room, or 'outside' every outward face.
  // Short, medium or tall walls (free): the whole run of joined walls changes together.
  wallHeight(s, { plotId, d, x, y, h, level = 0 }) {
    const plot = this.ownPlot(s, plotId);
    if (!plot || ![1, 2, 3, 4, 5].includes(h) || !['h', 'v'].includes(d)) return;
    level = this.lvl(level);
    const run = wallRun(plot, level, d, x, y);
    if (!run.length) return;
    for (const k of run) { if (h === 2) delete plot.walls[k].ht; else plot.walls[k].ht = h; }
    this.plotChanged(plot);
  }

  wallPaint(s, { plotId, d, x, y, side, m, fill, level = 0 }) {
    const plot = this.ownPlot(s, plotId);
    const def = ITEMS[m];
    if (!plot || def?.layer !== 'wall' || ![0, 1].includes(side)) return;
    level = this.lvl(level);
    const k0 = edgeKey(level, d, x, y);
    if (!plot.walls[k0] || !!ITEMS[plot.walls[k0].m]?.fence !== !!def.fence) return;
    const faces = [[k0, side]];
    const view = levelView(plot, level);
    const tileOn = (e, sd) => (e.d === 'h' ? [e.x, e.y - 1 + sd] : [e.x - 1 + sd, e.y]);
    if (fill === 'room' || fill === 'outside') {
      const e0 = parseEdge(k0);
      const [tx, ty] = tileOn(e0, side);
      const room = fill === 'room' && roomTilesOf(plot, level, tx, ty);
      // Outside: only this building (walls joined to the clicked one at their ends).
      const building = fill === 'outside' && connectedWalls(plot, level, k0);
      for (const [k, w] of Object.entries(plot.walls)) {
        const e = parseEdge(k);
        if (e.l !== level || k === k0 || (building && !building.has(k))) continue;
        for (const sd of [0, 1]) {
          const [ax, ay] = tileOn(e, sd);
          if (room ? room.has(key(ax, ay)) : fill === 'outside' && !view.floor[key(ax, ay)]) faces.push([k, sd]);
        }
      }
    }
    const todo = faces.filter(([k, sd]) => (sd ? plot.walls[k].o || plot.walls[k].m : plot.walls[k].m) !== m);
    const cost = s.cheats.build ? 0 : Math.ceil(def.price / 2) * todo.length;
    if (!todo.length) return;
    if (cost > s.profile.coins) return s.send({ type: 'error', msg: `Not enough coins (needs 🪙${cost})` });
    for (const [k, sd] of todo) {
      const w = plot.walls[k];
      if (sd) w.o = m;
      else { if (!w.o) w.o = w.m; w.m = m; }
      if (w.o === w.m) delete w.o;
    }
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
  remove(s, { plotId, lx, ly, level = 0, edge, featureOnly, roof, under }) {
    const plot = this.ownPlot(s, plotId);
    if (!plot) return;
    const refundOn = !s.cheats.build;
    level = this.lvl(level);
    if (Array.isArray(edge)) {
      const k = edgeKey(level, edge[0], edge[1], edge[2]);
      const wall = plot.walls?.[k];
      if (!wall) return;
      let refund = wall.f ? ITEMS[wall.f].price : 0;
      // A double door comes out as a pair.
      const pair = wall.f ? featurePair(plot, level, edge[0], edge[1], edge[2]) : null;
      if (pair?.partner) delete plot.walls[pair.partner].f;
      if (featureOnly && wall.f) { delete wall.f; delete wall.fc; }
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
    // Dig up a buried pipe or cable (the pipe tool on a tile that has one, or the
    // sledgehammer on bare ground).
    const dig = (id) => {
      delete plot.under[id][key(lx, ly)];
      if (refundOn) this.coins(s, ITEMS[id].price);
      return this.plotChanged(plot);
    };
    if (under) return !level && plot.under?.[under]?.[key(lx, ly)] ? dig(under) : undefined;
    const view = levelView(plot, level);
    const hit = objAt(view, lx, ly);
    if (!hit && !level) { const id = Object.keys(plot.under || {}).find((t) => plot.under[t][key(lx, ly)]); if (id) return dig(id); }
    if (hit?.obj.animals?.length) return s.send({ type: 'error', msg: `Sell or move out the animals first (tap the ${ITEMS[hit.obj.t].name.toLowerCase()})` });
    if (hit) {
      if (hit.obj.inv) this.social.emptyInto(s, hit.obj);
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
  design(s, { plotId, level = 0, lx, ly, roof, c, edge }) {
    const plot = this.ownPlot(s, plotId);
    if (!plot) return;
    level = this.lvl(level);
    if (Array.isArray(edge)) {
      // Doors and windows: cycle their paint colour (both halves of a double door).
      const w = plot.walls?.[edgeKey(level, edge[0], edge[1], edge[2])];
      if (!w?.f) return;
      const next = Number.isInteger(c) && c >= 0 && c < 6 ? c : ((w.fc || 0) + 1) % 6;
      const pair = featurePair(plot, level, edge[0], edge[1], edge[2]);
      for (const ww of [w, pair.partner && plot.walls[pair.partner]]) if (ww) { if (next) ww.fc = next; else delete ww.fc; }
      return this.plotChanged(plot);
    }
    if (!Number.isInteger(lx) || !Number.isInteger(ly)) return;
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
    const outdoor = (f) => isSoil(f) || f === 'floor_stone';
    for (let l = 0; l < 2; l++) {
      const view = levelView(plot, l);
      for (const [k, o] of Object.entries(view.obj)) {
        const def = ITEMS[o.t];
        if (terrain && !def.crop) continue;
        if (def.stairs && terrain) continue;
        if (o.inv) this.social.emptyInto(s, o);
        delete view.obj[k];
        if (def.shop) bag[o.t] = (bag[o.t] || 0) + 1; else if (!def.crop) coins += def.price;
        for (const a of o.animals || []) coins += Math.round(ANIMALS[a.k].price / 2); // sold off
      }
      for (const [k, f] of Object.entries(view.floor)) {
        if (terrain && !(l === 0 && outdoor(f))) continue;
        if (terrain && objAt(view, ...k.split(',').map(Number))) continue;
        delete view.floor[k];
        coins += ITEMS[f]?.price || 0;
      }
    }
    for (const [id, tiles] of Object.entries(plot.under || {})) coins += (ITEMS[id]?.price || 0) * Object.keys(tiles).length;
    plot.under = {};
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
    for (const p of changed) if (p?.owner && this.nature) this.nature.clearPlot(p, Object.values(this.profiles).find((x) => x.id === p.owner));
    indexPlots(this.world, this.plots);
    for (const id of removed) { this.mark(`plot:${id}`); this.broadcast({ type: 'plotRemoved', id }); }
    for (const p of changed) this.plotChanged(p);
    this.mark('meta');
    // Anyone on that land now stuck (inside a new wall line, say) steps to the nearest
    // free spot. Nobody anywhere else is touched.
    const near = (o, p) => o.x >= (p.x - 1) * TILE && o.x <= (p.x + p.w + 1) * TILE && o.y >= (p.y - 1) * TILE && o.y <= (p.y + p.h + 1) * TILE;
    for (const o of this.sessions.values()) {
      if (o.act && ACTIVITIES[o.act.id]?.seat) continue; // they're in a bed or a shower
      if (!changed.some((p) => p && near(o, p))) continue;
      if (!canStand(this.world, this.plots, o.x, o.y, o.level || 0)) this.unstick(o);
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
      return say('testingcheats true · time <hour> · venture <npc> [partner] [kind] · convo <npc> <npc> · seekme <npc> · money <amount> · motherlode · kaching · rosebud · freerealestate on/off · bb.enablefreebuild · tp cityhall|park|fair|square · fillneeds · needs <need> <0-100> · give <item> <n>');
    }
    if (c === 'testingcheats') {
      if (on(args[0])) { s.cheats.testing = true; return say('Cheats are enabled.'); }
      if (off(args[0])) { s.cheats = {}; return say('Cheats are disabled.'); }
      return say('Usage: testingcheats true | false');
    }
    if (!s.cheats.testing) return say('Type "testingcheats true" first.');
    const MAX = 99_999_999;
    const set = (n) => this.coins(s, Math.max(0, Math.min(MAX, n)) - s.profile.coins, true);
    switch (c) {
      case 'money': {
        const n = Number(args[0]);
        if (!Number.isFinite(n) || n < 0) return say('Usage: money <amount>');
        set(Math.floor(n));
        return say(`Funds set to 🪙${s.profile.coins.toLocaleString()}.`);
      }
      case 'motherlode': set(s.profile.coins + 50_000); return say('+🪙50,000');
      // Villager agents: build a venture on the spot, start a chat, come and find me.
      case 'venture': {
        const ids = args.filter((a) => this.npcs[a]);
        const kind = args.find((a) => VENTURES[a]) || AMBITIONS[ids[0]]?.kind;
        if (!ids.length || !kind) return say('Usage: venture <npc> [partner] [kind]');
        for (const id of ids) this.npcs[id].s.wallet = Math.max(this.npcs[id].s.wallet, 3000);
        const v = this.agents.found(this.npcs[ids[0]], ids, kind);
        const lot = this.agents.chooseLot(this.npcs[ids[0]], kind);
        if (!lot) return say('No lot found');
        this.agents.buyLot(this.npcs[ids[0]], v, lot);
        if (!args.includes('plot')) for (let st = 0; st < 3; st++) this.agents.finishStage(this.npcs[ids[0]], v, st);
        this.npcs[ids[0]].clearAgenda();
        return say(`${v.name} on plot ${lot.id + 1}`);
      }
      case 'convo': {
        const ids = args.filter((a) => this.npcs[a]);
        if (ids.length < 2) return say('Usage: convo <npc> <npc> [npc…]');
        for (const id of ids.slice(1)) { const n = this.npcs[id]; n.x = this.npcs[ids[0]].x + TILE * (1 + Math.random()); n.y = this.npcs[ids[0]].y; n.path = null; n.clearAgenda?.(); }
        const c = this.agents.start(ids, null, '', true);
        return say(c ? `Conversation ${c.id} started` : 'They’re busy');
      }
      case 'time': {
        const h = Number(args[0]);
        if (!(h >= 0 && h < 24)) return say('Usage: time <hour 0-23>');
        const cur = worldClock(this.now(), this.epoch).hours;
        this.epoch -= (((h - cur) % 24 + 24) % 24) * HOUR_MS;
        this.mark('meta');
        this.broadcast({ type: 'epoch', epoch: this.epoch });
        return say(`It’s now ${h}:00`);
      }
      case 'seekme': {
        const n = this.npcs[args[0]];
        if (!n) return say('Usage: seekme <npc>');
        n.x = s.x + TILE * 6; n.y = s.y; n.path = null; n.talkingTo = null;
        (n.sought ||= {})[s.profile.id] = 0;
        this.agents.send(n, { kind: 'seek', verb: `looking for ${s.profile.name}`, act: 'stroll', x: s.x + TILE, y: s.y, chase: s.profile.id, hours: 1, arrive: () => this.agents.approach(n, s.profile.id) });
        return say(`${n.def.name} is coming over`);
      }
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
      case 'give': {
        const item = args[0], n = Math.max(1, Math.min(99, Number(args[1]) || 1));
        if (!GOODS[item] && !ITEMS[item]) return say(`Unknown item. Try: ${Object.keys(GOODS).join(', ')}`);
        this.bag(s, item, n);
        return say(`+${n} ${itemName(item)}`);
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
  // Harvest one tile (lx, ly), a list of tiles (a row you walked into), or everything.
  harvest(s, { plotId, lx, ly, tiles }) {
    const plot = this.ownPlot(s, plotId, 'farm');
    if (!plot) return;
    const now = this.now();
    const keys = Array.isArray(tiles) ? tiles.slice(0, 64).filter((t) => Array.isArray(t) && t.every(Number.isInteger)).map(([x, y]) => key(x, y))
      : Number.isInteger(lx) ? [key(lx, ly)] : Object.keys(plot.obj);
    const got = {}, hq = [];
    const can = s.profile.inv.wateringcan > 0 || s.profile.inv.bigcan > 0;
    let watered = 0;
    for (const k of keys) {
      const o = plot.obj[k];
      if (!o || !ITEMS[o.t]?.crop) continue;
      if (cropStage(o, now) < 3) {
        // With a watering can, walking through your crops waters the dry ones.
        if (can && Array.isArray(tiles) && !isWet(o, now + WET_MS * 0.3)) { waterCrop(o, now); watered++; }
        continue;
      }
      const { crop, q } = this.farm.yieldOf(plot, k, now);
      got[crop] = (got[crop] || 0) + 1;
      hq.push([crop, q]);
      delete plot.obj[k];
    }
    if (watered) this.count(s.profile, 'water', watered);
    if (!Object.keys(got).length) { if (watered) this.plotChanged(plot); return; }
    this.count(s.profile, 'harvest', hq.length);
    for (const [crop, q] of hq) this.bag(s, crop, 1, q);
    s.send({ type: 'harvested', items: got, ...this.farm.qualCount(hq) });
    this.plotChanged(plot);
  }

  // Step to the nearest spot you can stand on (same floor first, then the ground);
  // only if there's none nearby, go home.
  unstick(s) {
    const lv = s.level || 0;
    for (let r = 1; r <= 6; r++) for (const level of lv ? [lv, 0] : [0]) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = (Math.floor(s.x / TILE) + dx + 0.5) * TILE, y = (Math.floor(s.y / TILE) + dy + 0.6) * TILE;
        if (!canStand(this.world, this.plots, x, y, level)) continue;
        s.x = x; s.y = y; s.level = level; s.lastMove = this.now();
        s.send({ type: 'pos', x, y, level });
        return;
      }
    }
    this.home(s);
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
    // Anywhere inside their shop counts as close enough.
    const shop = plotIdAtPixel(this.world, s.x, s.y);
    const inShop = shop >= 0 && this.plots[shop]?.town && plotIdAtPixel(this.world, n.x, n.y) === shop;
    if (!inShop && Math.hypot(n.x - s.x, n.y - s.y) > TALK_RANGE) { s.send({ type: 'error', msg: `Walk closer to ${n.def.name}` }); return null; }
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
    if (n.asleep) return s.send({ type: 'error', msg: `${n.def.name} is fast asleep. Zzz… (try again in the morning)` });
    // Chatting with friends? Join the group.
    if (n.convo) return this.agents.join(s, { id: n.convo });
    this.hold(n, s);
    const today = this.day();
    if (s.talkedDay !== today) { s.talkedDay = today; s.talked = new Set(); }
    if (!s.talked.has(n.id)) { s.talked.add(n.id); this.count(s.profile, 'talk'); }
    const greeting = n.greeting(s.profile, this.now());
    s.send({ type: 'npc', ...n.view(s.profile, this.now()), doing: n.doing(), thought: n.thought, say: greeting, ventures: this.agents.venturesOf(n.id), stall: this.agents.stallOf(n.id) });
    this.broadcast({ type: 'npcBubble', id: n.id, text: greeting });
    return this.life.onOpen(s, n);
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

  // Friendship milestones: a letter (and a gift) the first time you reach 3, 4 and 5 hearts.
  hearts(p, n) {
    const r = n.rel(p);
    const h = heartsOf(r.affinity);
    r.hearts ||= 0;
    while (r.hearts < h) {
      r.hearts++;
      const gift = HEART_GIFTS[n.id]?.[r.hearts];
      if (gift) this.social.mail(p, { from: n.def.name, text: gift.text, items: gift.items || null, coins: gift.coins || 0 });
      else if (r.hearts === 5) this.social.mail(p, { from: n.def.name, text: `I don’t say this to many people, ${p.name}, but you’re my best friend in this village. If you ever fancy spending an afternoon together… just ask.` });
      if (r.hearts >= 3) this.events.note(`${p.name} and ${n.def.name} have become ${r.hearts === 5 ? 'best friends' : 'good friends'}`);
    }
    this.mark(`npc:${n.id}`);
  }

  // Spend the afternoon with a best friend (5 hearts). Three dates and you're sweethearts.
  async date(s, { npc }) {
    const n = this.nearNpc(s, npc);
    if (!n || s.busy) return;
    if (n.asleep) return s.send({ type: 'error', msg: `${n.def.name} is asleep` });
    const r = n.rel(s.profile);
    if (r.affinity < 90) return s.send({ type: 'error', msg: `You and ${n.def.name} aren’t that close yet (5 ♥)` });
    const day = this.day();
    if (r.dateDay === day) return s.send({ type: 'error', msg: `You’ve already spent today together. Maybe tomorrow?` });
    r.dateDay = day;
    r.dates = (r.dates || 0) + 1;
    const nd = s.profile.needs;
    nd.fun = Math.min(100, nd.fun + 40);
    this.sendNeeds(s);
    if (r.dates >= 3 && !r.dating) {
      r.dating = true;
      this.addGossip(n.def.name, `${s.profile.name} and ${n.def.name} are sweethearts now!`);
      this.events.note(`${s.profile.name} and ${n.def.name} are an item, the whole village is talking`);
      s.send({ type: 'toast', text: `💕 You and ${n.def.name} are sweethearts!` });
    } else s.send({ type: 'toast', text: `💕 A lovely afternoon with ${n.def.name} (+40 fun)` });
    this.mark(`npc:${n.id}`);
    s.busy = true;
    try { await this.converse(s, n, r.dating ? '*spends a sweet afternoon with you, holding hands*' : '*asks you to spend the afternoon together*', 2); } finally { s.busy = false; }
  }

  // Ask the NPC's mind for a reply. `forced` overrides the sentiment (used for gifts).
  async converse(s, n, text, forced) {
    const now = this.now();
    // How this player writes, averaged over time, so the villager can match it.
    if (!text.startsWith('*')) { const r0 = n.rel(s.profile); r0.tone = blendTone(r0.tone, readTone(text)); }
    const ctx = { now, epoch: this.epoch, playerFacts: this.playerFacts(s), gossip: this.gossip.slice(-6), city: n.def.clerk ? this.city.brief() : null, quests: this.life.promptFor(s, n), agent: this.agents.context(n) };
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
    if (res.bit) n.addBit(s.profile, res.bit);
    if (res.callback) n.addCallback(s.profile, res.callback);
    if (res.gossip) this.addGossip(n.def.name, res.gossip);
    const changes = n.feel(s.profile, sentiment, this.now(), sentiment >= 0 ? `${s.profile.name} was kind to me` : `${s.profile.name} upset me`, this.epoch);
    this.hearts(s.profile, n);
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
    try { await this.converse(s, n, text); this.mood.chatted(s); } finally { s.busy = false; }
  }

  async gift(s, { npc, item }) {
    const n = this.nearNpc(s, npc);
    if (!n || s.busy || !GOODS[item] || !s.profile.inv[item]) return;
    s.busy = true;
    this.bag(s, item, -1);
    this.count(s.profile, 'gift');
    const sentiment = n.def.likes.includes(item) ? 2 : n.def.dislikes.includes(item) ? -1 : 1;
    try { await this.converse(s, n, `*gives you a ${GOODS[item].name} as a gift*`, sentiment); this.mood.gave(s); } finally { s.busy = false; }
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
    const unit = n.price(s.profile, item, false);
    const took = this.bag(s, item, -qty, 0, true); // the best ones first
    const price = took.reduce((a, k, q) => a + k * Math.round(unit * QUALITY[q].mult), 0);
    this.farm.onSold(item, qty, s.profile);
    this.count(s.profile, 'sold', qty);
    this.coins(s, price);
    this.trade(s, n, 0.3, `${s.profile.name} sold me good produce`, `${qty} ${itemName(item)}${qty > 1 ? 's' : ''}? Lovely — here's ${price} coins.`);
  }

  trade(s, n, sentiment, why, line) {
    this.hold(n, s);
    const changes = n.feel(s.profile, sentiment, this.now(), why, this.epoch);
    this.hearts(s.profile, n);
    this.mark(`npc:${n.id}`);
    s.send({ type: 'npcSay', text: line, sentiment, changes, ...n.view(s.profile, this.now()) });
  }

  // ---------- needs & activities ----------
  // Needs run down while you're online; activities fill them back up.
  tickNeeds(s, now) {
    const pr = s.profile;
    // (capped, so a stalled server or a skipped clock never drains needs in one go)
    const before = pr.needs.hunger;
    const { needs, low, faint, weak } = advanceNeeds(pr.needs, Math.min(5000, now - s.needsAt) / HOUR_MS, s.act?.id, this.mood.decay(s, now));
    s.needsAt = now;
    // Eating fills you up only as far as the food on your plate goes.
    if (ACTIVITIES[s.act?.id]?.carry && s.carry) {
      const ate = Math.min(Math.max(0, needs.hunger - before), s.carry.left);
      needs.hunger = before + ate;
      s.carry.left -= ate;
      if (PLATES[s.carry.food]?.fun) needs.fun = Math.min(100, needs.fun + PLATES[s.carry.food].fun * ate / PLATES[s.carry.food].hunger);
    }
    pr.needs = needs;
    if (s.act) {
      const a = ACTIVITIES[s.act.id];
      const view = s.act.plotId != null && this.plots[s.act.plotId] && levelView(this.plots[s.act.plotId], s.act.level);
      const gone = s.act.plotId != null && view?.obj[s.act.key]?.t !== s.act.item;
      const hours = (now - s.act.t0) / HOUR_MS;
      if (gone) this.stopActivity(s, true);
      else if (a.carry && (!s.carry || s.carry.left <= 0.05 || needs.hunger >= 99.9)) {
        const full = s.carry && s.carry.left > 0.05;
        this.mood.ate(s, { plate: s.carry?.food });
        s.carry = null;
        this.stopActivity(s, true);
        s.send({ type: 'toast', text: full ? '😋 You’re full! (you left the rest)' : '😋 All gone. Delicious!' });
      } else if (!a.carry && activityDone(s.act.id, needs, hours)) this.stopActivity(s, true, true);
    }
    for (const id of low) s.send({ type: 'toast', text: `${NEEDS.find((n) => n.id === id).icon} ${NEEDS.find((n) => n.id === id).low}` });
    if (weak) s.send({ type: 'toast', text: '❤️ You’re feeling faint! Eat, rest and look after yourself soon, or you’ll pass out.' });
    if (faint) return this.faint(s);
    this.mood.tick(s, now);
    if (now - s.needsSent >= 2000) this.sendNeeds(s);
    if (now - (s.needsSaved || 0) >= 20_000) { s.needsSaved = now; this.markProfile(pr); }
  }

  sendNeeds(s) {
    s.needsSent = this.now();
    const n = s.profile.needs;
    s.send({ type: 'needs', needs: Object.fromEntries(Object.entries(n).map(([k, v]) => [k, Math.round(v * 10) / 10])), act: s.act?.id || null, carry: s.carry ? { food: s.carry.food, left: Math.round(s.carry.left) } : null, mood: this.mood.view(s) });
  }

  // Health hit zero: you pass out where you are (no more being whisked home mid-errand)
  // and the village doctor patches you up.
  faint(s) {
    if (s.act) this.stopActivity(s, true);
    this.mood.fainted(s);
    const n = s.profile.needs;
    Object.assign(n, { health: 45, energy: Math.max(n.energy, 50), hunger: Math.max(n.hunger, 40), bladder: Math.max(n.bladder, 60), hygiene: Math.max(n.hygiene, 30), fun: Math.max(n.fun, 30) });
    const fee = Math.min(25, s.profile.coins);
    if (fee) this.coins(s, -fee);
    s.send({ type: 'toast', text: `😵 You fainted! The village doctor patched you up right here${fee ? ` (🪙${fee})` : ''}. Look after your needs!` });
    this.sendNeeds(s);
  }

  // Use a piece of furniture: { plotId, level, lx, ly, act }. Your own home, or a home
  // whose owner is there with you.
  use(s, { plotId, level = 0, lx, ly, act }) {
    const a = ACTIVITIES[act];
    if (!a) return;
    if (s.ride) return s.send({ type: 'error', msg: 'Park the tractor first' });
    if (a.carry && !s.carry) return s.send({ type: 'error', msg: 'Get some food first: grab a snack or cook at the fridge' });
    if (a.makes && s.carry) return s.send({ type: 'error', msg: `You’re already holding ${PLATES[s.carry.food].name.toLowerCase()}: eat it first` });
    if (act === 'eatHere') {
      // Eat where you stand.
      if (s.act) this.stopActivity(s, false);
      s.act = { id: act, t0: this.now(), plotId: null, back: null };
      s.moving = 0;
      return this.sendNeeds(s);
    }
    const plot = this.plots[plotId];
    if (!plot || !Number.isInteger(lx) || !Number.isInteger(ly)) return;
    level = this.lvl(level);
    if (plot.owner !== s.profile.id && !plot.town && !plot.venture && !this.canWork(plot, s.profile.id)) {
      const host = plot.owner && this.sessions.get(plot.owner);
      if (!host || plotIdAtPixel(this.world, host.x, host.y) !== plot.id) return s.send({ type: 'error', msg: 'You can only use things in someone’s home while they’re in' });
    }
    const view = levelView(plot, level);
    const hit = objAt(view, lx, ly);
    if (!hit || !usesOf(hit.obj.t).includes(act)) return;
    if (a.shop && (plot.owner !== s.profile.id || !plot.biz)) return s.send({ type: 'error', msg: 'You can only run the till in your own shop (get a business licence at City Hall)' });
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
    s.act = { id: act, t0: this.now(), plotId: plot.id, level, key: hit.key, item: hit.obj.t, back: { x: s.x, y: s.y, level: s.level }, paid: cost };
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
  // done: it finished by itself (cooking hands you the plate).
  stopActivity(s, send = true, done = false) {
    const act = s.act;
    if (!act) return;
    s.act = null;
    const a = ACTIVITIES[act.id];
    // Count it (for villagers' "do" requests) if it finished or went on a while.
    if (done || (this.now() - act.t0) / HOUR_MS >= 0.2) this.life.onActivity(s, act.id === 'eatHere' ? 'eat' : act.id);
    this.mood.activityEnded(s, act.id, done, (this.now() - act.t0) / HOUR_MS);
    if (a?.makes) {
      if (done) {
        const plate = PLATES[a.makes];
        s.carry = { food: a.makes, left: plate.hunger };
        s.send({ type: 'toast', text: `${plate.icon} ${plate.name} ready! Sit down somewhere to eat it` });
      } else if (act.paid) this.coins(s, act.paid); // walked off before it was ready: money back
    }
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
    this.mood.ate(s, { food });
    s.send({ type: 'toast', text: `${GOODS[item].icon} Yum! ${GOODS[item].name}` });
    this.sendNeeds(s);
  }

  // ---------- sleeping through the night ----------
  // The village shares one clock, so the night only passes when everyone online is
  // asleep in bed (for a few seconds). Then it's 6:00 AM the next day.
  checkSleep(now) {
    const all = [...this.sessions.values()];
    const asleep = all.filter((o) => o.act?.id === 'sleep');
    const sig = `${asleep.length}/${all.length}`;
    if (asleep.length && sig !== this.sleepSig) {
      this.sleepSig = sig;
      if (asleep.length < all.length) for (const o of asleep) o.send({ type: 'toast', text: `💤 ${sig} asleep: the night passes when everyone online is in bed` });
    }
    if (!asleep.length) { this.sleepSig = ''; return; }
    if (asleep.length === all.length && asleep.every((o) => now - o.act.t0 > 3000)) this.skipNight(now, asleep);
  }

  skipNight(now, sleepers) {
    const { hours } = worldClock(now, this.epoch);
    const sinceFive = (hours - 5 + 24) % 24;
    const skipH = sinceFive < 1 ? 1 - sinceFive : 25 - sinceFive;   // to the next 6:00 AM
    const delta = Math.round(skipH * HOUR_MS);
    this.epoch -= delta;
    this.mark('meta');
    // Crops grow and machines work through the night.
    for (const plot of Object.values(this.plots)) {
      let changed = false;
      for (const v of [plot, plot.l1]) for (const o of Object.values(v?.obj || {})) {
        if (ITEMS[o.t]?.crop && o.p) { o.p -= delta; if (isWet(o, now)) o.b = (o.b || 0) + Math.min(delta, o.wu - now); changed = true; }
        if (o.job) { o.job.ready -= delta; changed = true; }
      }
      if (changed) this.plotChanged(plot);
    }
    const day = worldClock(now, this.epoch).day;
    for (const s of sleepers) {
      const n = s.profile.needs;
      // A full night's sleep: rested, a bit hungry, needing the loo.
      Object.assign(n, { energy: 100, health: Math.min(100, n.health + 15), hunger: Math.max(5, n.hunger - skipH * 1.5), bladder: Math.max(5, n.bladder - skipH * 2.5), hygiene: Math.max(5, n.hygiene - skipH * 1), fun: Math.max(5, n.fun - skipH * 0.5) });
      s.needsAt = now;
      this.stopActivity(s, true);
      s.send({ type: 'toast', text: `☀️ Good morning! It’s 6:00 AM, day ${day}.` });
    }
    this.sleepSig = '';
    this.broadcast({ type: 'epoch', epoch: this.epoch, slept: Math.round(skipH * 10) / 10 });
  }

  // ---------- simulation ----------
  tick() {
    const now = this.now();
    const dt = Math.min(0.5, (now - this.lastTick) / 1000);
    this.lastTick = now;
    this.city.update(this.day());
    if (this.city.dirtyView && now - (this.lastCitySend || 0) > 1000) { this.lastCitySend = now; this.sendCity(); }
    if (this.city.statsDirty && now - (this.lastCitySave || 0) > 30_000) { this.lastCitySave = now; this.city.statsDirty = false; this.mark('city'); }
    this.biz.tick(now);
    this.farm.tick(now);
    this.events.tick(now);
    this.nature.tick(now);
    this.fishing.tick(now);
    if (!this.sessions.size) return;
    // Drop players we haven't heard from for 450 ticks, about 45 s (a phone that went to
    // sleep mid-game). Counted in ticks so a stalled server never drops everyone at once.
    for (const o of [...this.sessions.values()]) {
      o.quiet = (o.quiet || 0) + 1;
      if (o.quiet > 450) { this.leave(o); try { o.conn.close(); } catch { /* gone */ } }
    }
    const clock = worldClock(now, this.epoch);
    this.life.ensurePlans(clock.day);
    const hours = clock.hours; // fractional, 0..24
    this.life.tickMeetups(now);
    this.agents.tick(now, clock);
    for (const n of Object.values(this.npcs)) {
      n.tick(dt, now, this.world, this.plots, hours);
      if (n.asleep) continue;
      // Say hello to players walking past (at most every 5 minutes each).
      for (const s of this.sessions.values()) {
        if (Math.hypot(n.x - s.x, n.y - s.y) > TILE * 2.2) continue;
        if (now - (s.greeted[n.id] || 0) < 300_000 || n.talkingTo) continue;
        s.greeted[n.id] = now;
        this.broadcast({ type: 'npcBubble', id: n.id, text: n.passingLine(s.profile, now) });
      }
    }
    for (const s of this.sessions.values()) if (now - s.needsAt >= 1000) this.tickNeeds(s, now);
    this.checkSleep(now);
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
      const row = [o.profile.id, round(o.x), round(o.y), o.dir, o.moving || 0, o.level || 0, o.ride ? 'drive' : o.fish ? 'fish' : o.act?.id || 0, o.carry?.food || 0];
      const k = row.join(',');
      if (this.lastRows.get(o.profile.id) !== k) { changed.add(o.profile.id); this.lastRows.set(o.profile.id, k); }
      rows.push([o, row]);
    }
    for (const id of this.lastRows.keys()) if (!this.sessions.has(id)) this.lastRows.delete(id);
    const npcRows = Object.values(this.npcs).map((n) => [n.id, round(n.x), round(n.y), n.dir, n.moving ? 1 : 0, n.act || 0]);
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

// Walls joined end to end with the wall `k0` (one building's worth), on one level.
function connectedWalls(plot, level, k0) {
  const ends = (e) => (e.d === 'h' ? [[e.x, e.y], [e.x + 1, e.y]] : [[e.x, e.y], [e.x, e.y + 1]]);
  const byCorner = new Map();
  for (const k of Object.keys(plot.walls)) {
    const e = parseEdge(k);
    if (e.l !== level) continue;
    for (const [x, y] of ends(e)) { const c = `${x},${y}`; if (!byCorner.has(c)) byCorner.set(c, []); byCorner.get(c).push(k); }
  }
  const seen = new Set([k0]), stack = [k0];
  while (stack.length) {
    const k = stack.pop();
    for (const [x, y] of ends(parseEdge(k))) for (const n of byCorner.get(`${x},${y}`) || []) if (!seen.has(n)) { seen.add(n); stack.push(n); }
  }
  return seen;
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

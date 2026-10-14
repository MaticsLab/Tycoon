// Villagers as agents. Between the beats of their daily routine each villager decides
// what they want: drop in on a friend, seek out a player, mind their shop, spruce up
// their home, go shopping, or chase their dream (a bakery, a forge, a cabin in the
// woods). Dreams need money and often a partner: they pitch the idea to a friend in
// conversation, buy a real lot, and build it a stage at a time. Their shops have shelves
// players can buy from; they sell to each other and to you, and come and find you with
// an offer. When two or more get talking it's a proper group conversation: anyone
// nearby can walk up, join in and be answered.
import { NPCS, moodLabel } from '../../shared/npcs.js';
import { VOICES, voiceOf, VENTURES, AMBITIONS, WARES, WAGE, START_WALLET, STAGES, ventureCost, DECOR, YARD_DECOR, siteFor, buildStage } from '../../shared/agents.js';
import { ITEMS, GOODS, itemName } from '../../shared/catalog.js';
import { slotsOf, valueOf, shopOpen } from '../../shared/business.js';
import { placementError, plotEntrance, footprint, inInterior, indexPlots, canStand } from '../../shared/plot.js';
import { TILE, worldClock, publicAreaAt, plotIdAtPixel, PUBLIC_AREAS, MAP_W, MAP_H } from '../../shared/world.js';
import { HOUR_MS } from '../../shared/needs.js';
import { NPC_ACTS, PLACES } from '../../shared/village.js';
import { TOWN_PLOT_BASE } from '../../shared/townshops.js';

const CONVO_SCHEMA = {
  type: 'object',
  properties: {
    lines: { type: 'array', items: { type: 'object', properties: { who: { type: 'string' }, text: { type: 'string', maxLength: 160 } }, required: ['who', 'text'] } },
    outcome: { type: 'string', enum: ['none', 'yes', 'no', 'end'] },
    name: { type: 'string', maxLength: 30 },
    sentiment: { type: 'integer', enum: [-2, -1, 0, 1, 2] },
  },
  required: ['lines'],
};
const LINE_SCHEMA = { type: 'object', properties: { text: { type: 'string', maxLength: 160 } }, required: ['text'] };
const asJson = (out) => {
  if (out && typeof out === 'object') return out;
  const m = String(out || '').match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
};
const tidy = (t, n) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, n);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const MAX_CONVOS = 4;
const MAX_VENTURES = 10;
const JOIN_RANGE = TILE * 7;
const HEAR_RANGE = TILE * 14;
// Market stalls: a handful of villagers each week get a pitch somewhere busy and sell
// what they make for a few hours a day, calling out to people walking by.
const STALL_AREAS = ['Town Square', 'Willow Park', 'Harvest Fair', 'Seashell Beach', 'Duck Pond', 'Riverside Green', 'Pine Hollow Campsite'];
const STALL_HOURS = [[8, 12], [9, 13], [11, 15], [13, 17], [15, 19]];
const STALLS_A_WEEK = 6;
const STALL_BASE = TOWN_PLOT_BASE + 200;
const CALL_RANGE = TILE * 5;

export class Agents {
  constructor(game, saved = {}) {
    this.game = game;
    this.s = { ventures: saved.ventures || {}, nextId: saved.nextId || 1, wageDay: saved.wageDay || 0 };
    this.sought = {}; // player id -> when a villager last came over to them
    this.convos = new Map();
    this.nextConvo = 1;
    this.offers = new Map(); // offer id -> { pid, npc, item, price, venture, until }
    this.nextOffer = 1;
    this.nextSale = 0;
    this.pairCool = new Map(); // "a|b" -> time they last talked
    this.called = new Map(); // "npc|player" -> when they last called out to them
    this.s.stalls = saved.stalls || null;
    for (const n of Object.values(game.npcs)) this.init(n);
    this.buildStalls(false);
  }
  get npcs() { return this.game.npcs; }
  save() { return this.s; }
  mark() { this.game.mark('agents'); }
  init(n) {
    const s = n.s;
    if (s.wallet == null) s.wallet = START_WALLET(n.id);
    s.bonds ||= {};
  }
  name(id) { return NPCS[id]?.name || id; }
  names(ids) { const a = ids.map((i) => this.name(i)); return a.length < 2 ? a[0] : `${a.slice(0, -1).join(', ')} & ${a[a.length - 1]}`; }
  bond(a, b) { return this.npcs[a]?.s.bonds?.[b] || 0; }
  addBond(a, b, d) {
    for (const [x, y] of [[a, b], [b, a]]) { const n = this.npcs[x]; if (n) { n.s.bonds[y] = clamp((n.s.bonds[y] || 0) + d, -100, 100); this.game.mark(`npc:${x}`); } }
  }
  ventureOf(id) { return Object.values(this.s.ventures).find((v) => v.owners.includes(id)) || null; }
  venturesOf(id) {
    return Object.values(this.s.ventures).filter((v) => v.owners.includes(id)).map((v) => ({ name: v.name, kind: v.kind, icon: VENTURES[v.kind].icon, label: VENTURES[v.kind].label, with: v.owners.filter((o) => o !== id).map((o) => this.name(o)), stage: v.stage, built: v.stage >= STAGES.length - 1, plotId: v.plotId }));
  }
  // Pay villagers for their day jobs (in the morning).
  wages(day) {
    if (this.s.wageDay === day) return;
    this.s.wageDay = day;
    for (const n of Object.values(this.npcs)) { n.s.wallet = Math.round((n.s.wallet || 0) + (WAGE[n.id] || 50)); this.game.mark(`npc:${n.id}`); }
    for (const v of Object.values(this.s.ventures)) if (v.stage >= STAGES.length - 1) this.restock(v);
    for (const st of this.s.stalls?.list || []) this.restockStall(st);
    this.mark();
  }

  // ---------- the loop ----------
  tick(now, clock) {
    this.planStalls(clock.day);
    this.wages(clock.day);
    this.tickConvos(now);
    this.tickSales(now, clock.hours);
    this.tickStalls(now, clock.hours);
    for (const [id, o] of this.offers) if (now > o.until) this.offers.delete(id);
    for (const n of Object.values(this.npcs)) {
      if (n.agenda) { this.follow(n, now, clock); continue; }
      if (now < (n.nextThink || 0)) continue;
      n.nextThink = now + 15000 + Math.random() * 25000;
      this.decide(n, now, clock.hours);
    }
  }

  // Free to choose? Not asleep, not mid-conversation, not at a planned meet-up.
  free(n, hours) {
    if (n.asleep || n.convo || n.talkingTo || n.path) return false;
    if (hours < 7 || hours >= 21) return false;
    const st = n.step;
    if (st?.with || st?.side || NPC_ACTS[st?.act]?.hidden) return false;
    return true;
  }

  // What do I feel like doing? A weighted choice shaped by personality, money, friends
  // and dreams.
  decide(n, now, hours) {
    if (!this.free(n, hours)) return;
    const t = n.s.traits, g = this.game;
    const v = this.ventureOf(n.id), amb = AMBITIONS[n.id];
    const opts = [['routine', 4]];
    if (v && v.plotId == null && v.owners[0] === n.id) opts.push(['scout', 6]);
    else if (v && v.stage < STAGES.length - 1 && v.plotId != null) opts.push(['build', 5]);
    else if (v?.stage >= STAGES.length - 1) {
      if (VENTURES[v.kind].biz && hours >= 9 && hours < 18) opts.push(['mind', 2.2]);
      opts.push(['tend', 0.9]);
    }
    if (!v && amb && Object.keys(this.s.ventures).length < MAX_VENTURES && n.s.wallet >= ventureCost(amb.kind) * 0.45 && now > (n.s.pitchAt || 0)) opts.push(['dream', 1.4 + t.energy / 60]);
    opts.push(['visit', 0.6 + t.warmth / 45]);
    opts.push(['home', 0.5]);
    if (g.sessions.size) opts.push(['seek', 0.15 + t.warmth / 400]);
    if (n.s.wallet > 60) opts.push(['shop', 0.3 + t.generosity / 90]);
    let r = Math.random() * opts.reduce((a, o) => a + o[1], 0), choice = 'routine';
    for (const [k, w] of opts) { r -= w; if (r <= 0) { choice = k; break; } }
    const fn = { scout: () => this.goScout(n, v), build: () => this.goBuild(n, v), mind: () => this.goMind(n, v), tend: () => this.goTend(n, v), dream: () => this.goDream(n, amb), visit: () => this.goVisit(n), home: () => this.goTend(n, null), seek: () => this.goSeek(n), shop: () => this.goShop(n) }[choice];
    if (fn) fn();
  }

  // Head somewhere for a while. `arrive` runs once when they get there.
  send(n, a) {
    const g = this.game;
    n.setAgenda({ until: g.now() + (a.hours || 1) * HOUR_MS, ...a }, g.world, g.plots);
  }
  follow(n, now, clock) {
    const a = n.agenda;
    if (!a) return;
    if (a.chase && !a.arrived && now > (a.rechase || 0)) {
      // Following a player who's on the move.
      const s = this.game.sessions.get(a.chase);
      if (!s) { n.clearAgenda(); return; }
      a.rechase = now + 4000;
      if (Math.hypot(s.x - a.x, s.y - a.y) > TILE * 3) { a.x = s.x + TILE; a.y = s.y; n.setAgenda(a, this.game.world, this.game.plots); }
    }
    if (!a.arrived || a.done) return;
    a.done = true;
    try { a.arrive?.(now, clock); } catch (e) { console.error('agent arrive', e); }
  }

  // ---------- going places ----------
  plotSpot(plot, lx, ly) { return { x: (plot.x + lx + 0.5) * TILE, y: (plot.y + ly + 0.5) * TILE }; }
  homePlot(id) { return Object.values(this.game.plots).find((p) => p.home === id) || null; }

  goVisit(n) {
    // Someone you like (or someone new), who's up and about.
    const others = Object.values(this.npcs).filter((o) => o !== n && !o.asleep && !NPC_ACTS[o.act]?.hidden && !o.def.clerk);
    if (!others.length) return;
    others.sort((a, b) => (this.bond(n.id, b.id) + Math.random() * 40) - (this.bond(n.id, a.id) + Math.random() * 40));
    const o = others[0];
    this.send(n, { kind: 'visit', verb: `going to see ${o.def.name}`, act: 'stroll', x: o.x + TILE, y: o.y, hours: 1, target: o.id, arrive: () => this.meet(n, o) });
  }
  // Got there: start talking (or join the conversation they're already in).
  meet(n, o, purpose = null) {
    if (Math.hypot(o.x - n.x, o.y - n.y) > TILE * 4) { n.clearAgenda(); return; }
    if (o.convo) { const c = this.convos.get(o.convo); if (c && c.members.length < 4) return this.addMember(c, n); }
    if (o.asleep || o.talkingTo || o.path || NPC_ACTS[o.act]?.hidden) { this.bubble(n, `${o.def.name} looks busy. Another time.`); n.clearAgenda(); return; }
    const near = Object.values(this.npcs).filter((x) => x !== n && x !== o && !x.convo && !x.talkingTo && !x.asleep && !x.path && !NPC_ACTS[x.act]?.hidden && Math.hypot(x.x - n.x, x.y - n.y) < TILE * 4 && Math.random() < 0.5).slice(0, 2);
    this.start([n.id, o.id, ...near.map((x) => x.id)], purpose);
  }

  // Only friends come looking for you, now and then, with something to say.
  goSeek(n) {
    const g = this.game, now = g.now();
    const ss = [...g.sessions.values()].filter((s) => n.affinity(s.profile) >= 30 && Math.hypot(s.x - n.x, s.y - n.y) < TILE * 70
      && now - (n.sought?.[s.profile.id] || 0) > HOUR_MS * 24 && now - (this.sought[s.profile.id] || 0) > HOUR_MS * 4);
    if (!ss.length) return;
    const s = pick(ss);
    (n.sought ||= {})[s.profile.id] = now;
    this.sought[s.profile.id] = now;
    this.send(n, { kind: 'seek', verb: `looking for ${s.profile.name}`, act: 'stroll', x: s.x + TILE, y: s.y, chase: s.profile.id, hours: 1, arrive: () => this.approach(n, s.profile.id) });
  }
  // Walk up to a friend to say hello (and ask after something they remember).
  async approach(n, pid) {
    const g = this.game, s = g.sessions.get(pid);
    if (!s || Math.hypot(s.x - n.x, s.y - n.y) > TILE * 4) return;
    n.faceToward(s.x, s.y);
    if (n.agenda) { n.agenda.until = g.now() + HOUR_MS * 0.4; n.agenda.still = true; }
    const r = n.rel(s.profile);
    const about = r.callbacks?.length ? ` You'd like to ask them: "${r.callbacks.at(-1)}".` : r.notes.length ? ` You remember: ${r.notes.at(-1)}.` : '';
    const text = await this.oneLine(n, s.profile, `You spotted your friend ${s.profile.name} and walked over to say hello.${about} Say one short, warm opening line (max 22 words), speaking straight to them.`)
      || (r.callbacks?.length ? `${s.profile.name}! ${r.callbacks.at(-1)}` : `${pick(voiceOf(n.id).quirks)} Got a minute, ${s.profile.name}?`);
    this.bubble(n, text);
    if (g.sessions.has(pid)) s.send({ type: 'npcApproach', npc: n.id, text });
  }
  offerAccept(s, { id }) {
    const g = this.game, o = this.offers.get(id);
    if (!o || o.pid !== s.profile.id) return s.send({ type: 'error', msg: 'That offer has gone' });
    const n = this.npcs[o.npc];
    if (Math.hypot(n.x - s.x, n.y - s.y) > TILE * 8) return s.send({ type: 'error', msg: `${n.def.name} has wandered off` });
    if (s.profile.coins < o.price) return s.send({ type: 'error', msg: 'Not enough coins' });
    if (o.plotId != null) {
      const plot = g.plots[o.plotId], hit = plot && this.shelves(plot).find(({ sl }) => sl.item === o.item && sl.n > 0);
      if (!hit) { this.offers.delete(id); return s.send({ type: 'error', msg: 'Sold out!' }); }
      hit.sl.n -= 1;
      if (hit.sl.n <= 0) { hit.o.stock.splice(hit.o.stock.indexOf(hit.sl), 1); if (!hit.o.stock.length) delete hit.o.stock; }
      g.plotChanged(plot);
      this.payPlot(plot, o.price, s.profile.name, o.item);
    } else { n.s.wallet += o.price; g.mark(`npc:${n.id}`); }
    this.offers.delete(id);
    g.coins(s, -o.price);
    g.bag(s, o.item, 1);
    n.feel(s.profile, 1, g.now(), `${s.profile.name} bought from me`, g.epoch);
    g.hearts(s.profile, n);
    g.mark(`npc:${n.id}`);
    this.bubble(n, pick([`Pleasure doing business!`, `Enjoy it, ${s.profile.name}!`, pick(voiceOf(n.id).quirks)]));
    s.send({ type: 'toast', text: `🛍️ Bought ${GOODS[o.item].name} from ${n.def.name} for 🪙${o.price}` });
  }
  offerDecline(s, { id }) {
    const o = this.offers.get(id);
    if (!o || o.pid !== s.profile.id) return;
    this.offers.delete(id);
    const n = this.npcs[o.npc];
    this.bubble(n, pick(['Suit yourself!', 'Another time, then.', 'No worries.']));
    if (n.agenda) n.agenda.until = this.game.now() + 3000;
  }

  goShop(n) {
    // Somewhere open with something on the shelves that isn't your own.
    const g = this.game, { hours } = worldClock(g.now(), g.epoch);
    const open = (p) => {
      if (!p.biz) return false;
      if (p.biz.npc) return shopOpen(p.biz, hours, false);
      const o = g.biz.ownerProfile(p);
      return o?.biz?.plotId === p.id && g.biz.isOpen(o, p);
    };
    const mine = (p) => p.venture && this.s.ventures[p.venture]?.owners.includes(n.id);
    const shops = Object.values(g.plots).filter((p) => p && open(p) && !mine(p));
    const withStock = shops.map((p) => ({ p, sl: this.shelves(p).filter(({ sl }) => sl.n > 0 && sl.price <= n.s.wallet) })).filter((x) => x.sl.length);
    if (!withStock.length) return;
    withStock.sort((a, b) => Math.hypot(a.p.x - n.x / TILE, a.p.y - n.y / TILE) - Math.hypot(b.p.x - n.x / TILE, b.p.y - n.y / TILE));
    const { p } = withStock[Math.floor(Math.random() * Math.min(3, withStock.length))];
    const e = plotEntrance(g.world, p);
    this.send(n, { kind: 'shop', verb: `shopping at ${p.biz.name}`, act: 'stroll', x: e.x, y: e.y - TILE, hours: 0.8, arrive: () => this.shopAt(n, p) });
  }
  shopAt(n, p) {
    const g = this.game;
    const all = this.shelves(p).filter(({ sl }) => sl.n > 0 && sl.price <= n.s.wallet);
    if (!all.length) return this.bubble(n, 'Sold out? Typical.');
    // Things they like first, then whatever's good value.
    all.sort((a, b) => (n.def.likes.includes(b.sl.item) - n.def.likes.includes(a.sl.item)) || (a.sl.price / valueOf(a.sl.item)) - (b.sl.price / valueOf(b.sl.item)));
    const { o, sl } = all[0];
    const price = sl.price, item = sl.item;
    n.s.wallet -= price;
    g.mark(`npc:${n.id}`);
    if (p.venture) {
      const v = this.s.ventures[p.venture];
      sl.n -= 1;
      if (sl.n <= 0) { o.stock.splice(o.stock.indexOf(sl), 1); if (!o.stock.length) delete o.stock; }
      g.plotChanged(p);
      this.pay(v, price, n.def.name, item);
      for (const id of v.owners) this.addBond(n.id, id, 1);
    } else {
      const owner = g.biz.ownerProfile(p);
      if (!owner) return;
      g.biz.sold(owner, p, { obj: o }, sl, 1, n.def.name);
    }
    this.bubble(n, n.def.likes.includes(item) ? `Ooh, ${GOODS[item].name}! My favourite.` : `I’ll take a ${GOODS[item].name}, thanks!`);
  }

  // ---------- dreams: partners, land, building ----------
  goDream(n, amb) {
    n.s.pitchAt = this.game.now() + HOUR_MS * 8;
    const busy = new Set(Object.values(this.s.ventures).flatMap((v) => v.owners));
    const partners = (amb.partners || []).map((id) => this.npcs[id]).filter((o) => o && !busy.has(o.id) && !o.asleep);
    const partner = partners.sort((a, b) => this.bond(n.id, b.id) - this.bond(n.id, a.id))[0];
    // Rich enough to go it alone (and not much of a people person)? Off to find a lot.
    if (!partner || (n.s.wallet >= ventureCost(amb.kind) * 1.1 && n.s.traits.warmth < 50)) return this.found(n, [n.id], amb.kind);
    this.send(n, { kind: 'pitch', verb: `going to pitch an idea to ${partner.def.name}`, act: 'stroll', x: partner.x + TILE, y: partner.y, hours: 1.2, target: partner.id,
      arrive: () => this.meet(n, partner, { kind: 'pitch', from: n.id, to: partner.id, venture: amb.kind }) });
  }
  // A new venture: named, funded by the owners, waiting for a lot.
  found(n, owners, kind, name) {
    const V = VENTURES[kind];
    const id = String(this.s.nextId++);
    name = tidy(name, 30) || (owners.length > 1 ? `${this.name(owners[0])} & ${this.name(owners[1])}’s ${V.label}` : `${this.name(owners[0])}’s ${V.label}`);
    const cost = ventureCost(kind);
    let fund = 0;
    for (const o of owners) { const x = this.npcs[o]; const put = Math.min(x.s.wallet - 40, Math.ceil(cost / owners.length)); if (put > 0) { x.s.wallet -= put; fund += put; this.game.mark(`npc:${o}`); } }
    const v = { id, kind, name, owners, plotId: null, stage: -1, fund, day: this.game.day(), till: 0, sales: 0 };
    this.s.ventures[id] = v;
    this.mark();
    this.game.addGossip(this.name(owners[0]), `${this.names(owners)} are planning to open ${name}`);
    this.game.broadcast({ type: 'toast', text: `${V.icon} ${this.names(owners)} ${owners.length > 1 ? 'are' : 'is'} planning ${V.biz ? 'to open' : 'to build'} “${name}”!` });
    this.goScout(n, v);
    return v;
  }
  // Find a free lot near home and buy it.
  goScout(n, v) {
    const g = this.game, lot = this.chooseLot(n, v.kind);
    if (!lot) { this.bubble(n, 'Not a single lot that suits. Hmph.'); return; }
    const e = plotEntrance(g.world, lot);
    this.send(n, { kind: 'scout', verb: 'looking at land for sale', act: 'stroll', x: e.x, y: e.y - TILE, hours: 1, arrive: () => this.buyLot(n, v, lot) });
  }
  chooseLot(n, kind) {
    const g = this.game;
    const free = Object.values(g.plots).filter((p) => p && !p.owner && !p.town && Number(p.id) < TOWN_PLOT_BASE);
    // Leave most land for players.
    const forSale = free.length;
    if (forSale < 10) return null;
    const home = n.def.home;
    const ok = free.filter((p) => siteFor(p, kind, g.world, plotEntrance(g.world, p)));
    ok.sort((a, b) => Math.hypot(a.x - home.x / TILE, a.y - home.y / TILE) - Math.hypot(b.x - home.x / TILE, b.y - home.y / TILE));
    return ok[Math.floor(Math.random() * Math.min(3, ok.length))] || null;
  }
  buyLot(n, v, plot) {
    const g = this.game;
    if (plot.owner || !this.s.ventures[v.id]) return this.bubble(n, 'Somebody beat me to it!');
    const site = siteFor(plot, v.kind, g.world, plotEntrance(g.world, plot));
    if (!site) return;
    const price = plot.w * plot.h * g.city.landPrice;
    const owners = v.owners.map((o) => this.npcs[o]);
    // The fund pays first, then the owners chip in.
    let due = price;
    const fromFund = Math.min(v.fund, due); v.fund -= fromFund; due -= fromFund;
    for (const o of owners) { const p = Math.min(Math.max(0, o.s.wallet - 20), Math.ceil(due / owners.length)); o.s.wallet -= p; due -= p; g.mark(`npc:${o.id}`); }
    if (due > 0) { v.fund += price - due; return this.bubble(n, 'Can’t quite afford it yet. Saving up!'); }
    g.city.onLand(price);
    plot.owner = `npc:${v.owners[0]}`;
    plot.ownerName = this.names(v.owners);
    plot.farm = '';
    plot.venture = v.id;
    plot.npcs = [...v.owners];
    v.plotId = plot.id;
    v.site = site;
    g.nature.clearPlot(plot);
    g.plotChanged(plot);
    this.mark();
    this.bubble(n, `${pick(voiceOf(n.id).quirks)} This is the spot!`);
    g.addGossip(n.def.name, `${this.names(v.owners)} bought plot ${plot.id + 1} for ${v.name}`);
    g.events?.note?.(`${this.names(v.owners)} bought a lot to build ${v.name}`);
  }
  goBuild(n, v) {
    const g = this.game, plot = g.plots[v.plotId];
    if (!plot || plot.venture !== v.id) { v.plotId = null; this.mark(); return; }
    const s = v.site, sp = this.plotSpot(plot, s.x + Math.floor(s.w / 2), s.face === 'n' ? s.y - 1 : s.y + s.h);
    const next = v.stage + 1;
    this.send(n, { kind: 'build', verb: `building ${v.name} (${STAGES[next].label.toLowerCase()})`, act: 'work', x: sp.x, y: sp.y, hours: 1, range: 1.5,
      arrive: () => { n.agenda.onEnd = () => this.finishStage(n, v, next); } });
  }
  // An hour's work later: that stage is up (if they can pay for the materials).
  finishStage(n, v, stage) {
    const g = this.game, plot = g.plots[v.plotId];
    if (!plot || v.stage >= stage) return;
    const cost = Math.round(ventureCost(v.kind) * STAGES[stage].cost);
    let due = cost;
    const f = Math.min(v.fund, due); v.fund -= f; due -= f;
    for (const id of v.owners) { const o = this.npcs[id]; const p = Math.min(Math.max(0, o.s.wallet - 20), due); o.s.wallet -= p; due -= p; g.mark(`npc:${id}`); }
    if (due > 0) { v.fund += cost - due; this.mark(); return this.bubble(n, 'Out of money for materials. Back to saving!'); }
    buildStage(plot, v.kind, v.site, stage, g.world);
    v.stage = stage;
    if (stage === STAGES.length - 1) {
      const V = VENTURES[v.kind];
      if (V.biz) { plot.biz = { name: v.name, npc: true, staff: null, closed: false }; this.restock(v); }
      g.addGossip(n.def.name, `${v.name} is finished${V.biz ? ' and open for business' : ''}`);
      g.broadcast({ type: 'toast', text: `🎉 ${V.icon} “${v.name}” is ${V.biz ? 'open! Come and browse the shelves' : 'finished'} (by ${this.names(v.owners)})` });
      g.events?.note?.(`${v.name} opened its doors`);
      this.bubble(n, V.biz ? `We’re open! ${pick(voiceOf(n.id).quirks)}` : 'Done! Isn’t she a beauty?');
    } else this.bubble(n, stage === 0 ? 'Walls are up! Roof next.' : 'Roof’s on! Nearly there.');
    g.plotChanged(plot);
    this.mark();
  }
  goMind(n, v) {
    const g = this.game, plot = g.plots[v.plotId];
    if (!plot) return;
    const reg = Object.entries(plot.obj).find(([, o]) => o.t === 'register');
    const [lx, ly] = reg ? reg[0].split(',').map(Number) : [v.site.x + 2, v.site.y + 1];
    // Behind the till (or in front of it, when it's against the back wall).
    const back = v.site.face === 'n' ? 1 : -1;
    const inside = (y) => y >= v.site.y && y < v.site.y + v.site.h;
    const sp = this.plotSpot(plot, lx, inside(ly + back) ? ly + back : ly - back);
    this.send(n, { kind: 'mind', verb: `minding the shop at ${v.name}`, act: 'work', x: sp.x, y: sp.y, hours: 1.5, still: true,
      arrive: () => { if (!this.shelfGoods(v).length) this.restock(v); } });
  }
  goTend(n, v) {
    const g = this.game;
    const plot = v?.plotId != null ? g.plots[v.plotId] : this.homePlot(n.id);
    if (!plot) return;
    const sp = v ? this.plotSpot(plot, v.site.x + Math.floor(v.site.w / 2), v.site.y + Math.floor(v.site.h / 2)) : this.plotSpot(plot, Math.floor(plot.w / 2), Math.floor(plot.h / 2));
    this.send(n, { kind: 'tend', verb: v ? `sprucing up ${v.name}` : 'pottering about at home', act: 'work', x: sp.x, y: sp.y, hours: 0.8, range: 1.5, arrive: () => this.rearrange(n, plot, v) });
  }
  // Move a piece of furniture somewhere better, turn it, or buy something new.
  rearrange(n, plot, v) {
    const g = this.game;
    const rect = v ? v.site : { x: 0, y: 0, w: plot.w, h: plot.h };
    const inRect = (x, y) => x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h;
    const fixed = new Set(['register', 'mailbox', 'stairs', 'fireplace', 'bakeryoven', 'smoker', 'stove', 'fridge', 'kitchensink', 'toilet', 'shower', 'bathtub']);
    const things = Object.entries(plot.obj).filter(([k, o]) => !fixed.has(o.t) && !slotsOf(o.t) && ITEMS[o.t] && inRect(...k.split(',').map(Number)));
    let said = null;
    const tryPlace = (t, r, tries = 40) => {
      for (let i = 0; i < tries; i++) {
        const lx = rect.x + Math.floor(Math.random() * rect.w), ly = rect.y + Math.floor(Math.random() * rect.h);
        if (!placementError(plot, lx, ly, t, r, 0, g.world)) return [lx, ly];
      }
      return null;
    };
    const roll = Math.random();
    if ((roll < 0.35 || !things.length) && n.s.wallet > 80) {
      const t = pick(DECOR);
      const at = tryPlace(t, 0);
      if (at) {
        plot.obj[`${at[0]},${at[1]}`] = { t };
        const cost = Math.min(ITEMS[t].price || 40, 120);
        n.s.wallet -= cost;
        said = pick([`A new ${itemName(t).toLowerCase()}! It really ties the room together.`, `Treated myself to a ${itemName(t).toLowerCase()}.`]);
      }
    } else if (things.length) {
      const [k, o] = pick(things);
      delete plot.obj[k];
      const r = ITEMS[o.t].rot && ITEMS[o.t].rot !== 'none' && Math.random() < 0.4 ? (((o.r || 0) + 1 + Math.floor(Math.random() * 3)) % 4) : (o.r || 0);
      const at = tryPlace(o.t, r);
      if (at) {
        plot.obj[`${at[0]},${at[1]}`] = r ? { ...o, r } : (({ r: _r, ...rest }) => rest)(o);
        said = pick([`The ${itemName(o.t).toLowerCase()} looks better over here.`, `Hmm… ${itemName(o.t).toLowerCase()} by the window? Yes.`, `Moving the ${itemName(o.t).toLowerCase()}. Fresh start!`]);
      } else plot.obj[k] = o;
    }
    // Something for the yard of a venture now and then.
    if (v && !said && n.s.wallet > 120 && Math.random() < 0.5) {
      const t = pick(YARD_DECOR);
      for (let i = 0; i < 40; i++) {
        const lx = Math.floor(Math.random() * plot.w), ly = Math.floor(Math.random() * plot.h);
        if (inRect(lx, ly) || placementError(plot, lx, ly, t, 0, 0, g.world)) continue;
        plot.obj[`${lx},${ly}`] = { t };
        n.s.wallet -= Math.min(ITEMS[t].price || 40, 120);
        said = `A ${itemName(t).toLowerCase()} out front. Classy.`;
        break;
      }
    }
    if (!said) return;
    g.mark(`npc:${n.id}`);
    if (plot.town) n.s.homeObj = JSON.parse(JSON.stringify(plot.obj)); // cottages are rebuilt each start
    g.plotChanged(plot);
    this.bubble(n, said);
  }

  // ---------- shops ----------
  shelves(plot) {
    return [plot, plot.l1].flatMap((view) => (view ? Object.values(view.obj).filter((o) => o.stock?.length).flatMap((o) => o.stock.map((sl) => ({ o, sl }))) : []));
  }
  shelfGoods(v) {
    const plot = this.game.plots[v.plotId];
    return plot ? this.shelves(plot).filter(({ sl }) => sl.n > 0).map(({ sl }) => ({ item: sl.item, price: sl.price })) : [];
  }
  takeFromShelf(v, item) {
    const plot = this.game.plots[v.plotId];
    const hit = plot && this.shelves(plot).find(({ sl }) => sl.item === item && sl.n > 0);
    if (!hit) return null;
    hit.sl.n -= 1;
    if (hit.sl.n <= 0) { hit.o.stock.splice(hit.o.stock.indexOf(hit.sl), 1); if (!hit.o.stock.length) delete hit.o.stock; }
    this.game.plotChanged(plot);
    return hit.sl;
  }
  // Fill the shelves with what they make (prices set by how generous they are).
  restock(v) {
    const g = this.game, plot = g.plots[v.plotId], V = VENTURES[v.kind];
    if (!plot || !V.stock) return;
    const gen = v.owners.reduce((a, id) => a + this.npcs[id].s.traits.generosity, 0) / v.owners.length;
    const shelves = Object.values(plot.obj).filter((o) => slotsOf(o.t));
    let i = 0;
    for (const o of shelves) {
      o.stock = [];
      for (let k = 0; k < Math.min(slotsOf(o.t), 3); k++) {
        const item = V.stock[i++ % V.stock.length];
        if (o.stock.some((x) => x.item === item)) continue;
        o.stock.push({ item, n: 3 + Math.floor(Math.random() * 5), price: Math.max(2, Math.round(valueOf(item) * (1.3 - gen / 250))) });
      }
    }
    g.plotChanged(plot);
  }
  // Money from a sale goes to the owners.
  pay(v, coins, who, item) {
    const g = this.game;
    const share = Math.floor(coins / v.owners.length);
    for (const id of v.owners) { this.npcs[id].s.wallet += share; g.mark(`npc:${id}`); }
    v.sales = (v.sales || 0) + coins;
    this.mark();
    const plot = g.plots[v.plotId];
    if (plot) g.broadcast({ type: 'sale', plotId: plot.id, item, n: 1, coins, who });
  }
  // Villager-run plots (a venture shop or a market stall): who owns it, is it open, and
  // where the money goes.
  ownersOf(plot) {
    if (plot.stall) return [plot.stall];
    return this.s.ventures[plot.venture]?.owners || [];
  }
  openPlot(plot) {
    const g = this.game;
    if (plot.stall) return !plot.biz.closed;
    const { hours } = worldClock(g.now(), g.epoch);
    return shopOpen(plot.biz, hours, false);
  }
  closedMsg(plot) {
    if (plot.stall) { const st = this.s.stalls?.list.find((x) => x.npc === plot.stall); return `${this.name(plot.stall)} isn’t at the stall right now${st ? ` (here ${fmtH(st.from)} – ${fmtH(st.to)})` : ''}`; }
    return `“${plot.biz.name}” is closed right now (open 8 AM – 8 PM)`;
  }
  payPlot(plot, coins, who, item) {
    const g = this.game;
    if (plot.venture) return this.pay(this.s.ventures[plot.venture], coins, who, item);
    const n = this.npcs[plot.stall];
    if (!n) return;
    n.s.wallet += coins;
    g.mark(`npc:${n.id}`);
    g.broadcast({ type: 'sale', plotId: plot.id, item, n: 1, coins, who });
  }
  thank(plot, s, item) {
    const g = this.game;
    for (const id of this.ownersOf(plot)) { const o = this.npcs[id]; o.feel(s.profile, 0.4, g.now(), `${s.profile.name} bought from me`, g.epoch); g.hearts(s.profile, o); g.mark(`npc:${id}`); }
    const keeper = this.ownersOf(plot).map((id) => this.npcs[id]).find((o) => Math.hypot(o.x - (plot.x + plot.w / 2) * TILE, o.y - (plot.y + plot.h / 2) * TILE) < TILE * 6);
    if (keeper) this.bubble(keeper, pick([`Thank you, ${s.profile.name}!`, `Enjoy the ${GOODS[item].name}!`, pick(voiceOf(keeper.id).quirks)]));
  }
  // A customer buys off a villager's shelf.
  shelfBuy(s, plot, hit, msg) {
    const g = this.game;
    if (!this.ownersOf(plot).length) return;
    if (!this.openPlot(plot)) return s.send({ type: 'error', msg: this.closedMsg(plot) });
    const sl = hit.obj.stock?.[msg.slot];
    if (!sl || sl.n < 1) return;
    const n = Math.max(1, Math.min(sl.n, Math.floor(msg.n) || 1));
    const cost = sl.price * n;
    if (s.profile.coins < cost) return s.send({ type: 'error', msg: 'Not enough coins' });
    g.coins(s, -cost);
    g.bag(s, sl.item, n);
    const item = sl.item;
    sl.n -= n;
    if (sl.n <= 0) { hit.obj.stock.splice(msg.slot, 1); if (!hit.obj.stock.length) delete hit.obj.stock; }
    g.plotChanged(plot);
    this.payPlot(plot, cost, s.profile.name, item);
    this.thank(plot, s, item);
    s.send({ type: 'toast', text: `🛍️ Bought ${n} × ${GOODS[item].name} at ${plot.biz.name} for 🪙${cost}` });
  }

  // ---------- market stalls ----------
  // A new week: who's selling, where and when.
  planStalls(day) {
    const week = Math.floor((day - 1) / 7);
    if (this.s.stalls?.week === week) return;
    const g = this.game;
    const busy = new Set(Object.values(this.s.ventures).filter((v) => v.stage >= STAGES.length - 1 && VENTURES[v.kind].biz).flatMap((v) => v.owners));
    const sellers = Object.keys(WARES).filter((id) => this.npcs[id] && !busy.has(id) && !NPCS[id].clerk).sort(() => Math.random() - 0.5).slice(0, STALLS_A_WEEK);
    const old = this.s.stalls?.list || [];
    for (const st of old) delete g.plots[st.id];
    const list = [], used = {};
    sellers.forEach((npc, i) => {
      const areas = STALL_AREAS.map((name) => PUBLIC_AREAS.find((a) => a.name === name)).filter(Boolean).sort((a, b) => (used[a.name] || 0) - (used[b.name] || 0) + (Math.random() - 0.5) * 0.9);
      for (const a of areas) {
        const at = this.stallSpot(a, list);
        if (!at) continue;
        used[a.name] = (used[a.name] || 0) + 1;
        const [from, to] = pick(STALL_HOURS);
        const fishy = (WARES[npc] || []).some((w) => /fish|carp|sunfish|trout|bass/.test(w));
        list.push({ id: STALL_BASE + i, npc, x: at.x, y: at.y, area: a.name, from, to, kind: fishy ? 'fishstall' : 'marketstall' });
        break;
      }
    });
    this.s.stalls = { week, list };
    this.mark();
    this.buildStalls(true, old);
    for (const st of list) this.restockStall(st);
    if (list.length) g.addGossip('the market', `This week’s market stalls: ${list.map((st) => `${this.name(st.npc)} at ${st.area}`).join(', ')}`);
  }
  // Somewhere open in the area: the stall, the keeper behind it and room in front.
  stallSpot(area, taken) {
    const g = this.game, w = g.world;
    for (let t = 0; t < 400; t++) {
      const x = area.x + 2 + Math.floor(Math.random() * Math.max(1, area.w - 6)), y = area.y + 2 + Math.floor(Math.random() * Math.max(1, area.h - 6));
      if (taken.some((st) => Math.abs(st.x - x) < 6 && Math.abs(st.y - y) < 6)) continue;
      let ok = true;
      for (let j = -1; j < 4 && ok; j++) for (let i = -1; i < 3 && ok; i++) {
        const tx = x + i, ty = y + j;
        if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H || w.plotAt[ty * MAP_W + tx] >= 0 || !canStand(w, g.plots, (tx + 0.5) * TILE, (ty + 0.9) * TILE)) ok = false;
      }
      if (ok) return { x, y };
    }
    return null;
  }
  // The stalls are little village plots (rebuilt from the plan on every start).
  buildStalls(announce, old = []) {
    const g = this.game;
    for (const st of old) if (announce) g.broadcast({ type: 'plotRemoved', id: st.id });
    for (const st of this.s.stalls?.list || []) {
      const name = `${this.name(st.npc)}’s Stall`;
      const prev = g.plots[st.id];
      g.plots[st.id] = {
        id: st.id, x: st.x, y: st.y, w: 2, h: 2, owner: `npc:${st.npc}`, ownerName: this.name(st.npc), farm: '',
        town: 'stall', name, stall: st.npc, rev: (prev?.rev || 0) + 1,
        biz: { name, npc: true, staff: null, closed: true },
        floor: {}, obj: { '0,1': { t: st.kind, ...(st.stock ? { stock: st.stock } : {}) } }, l1: { floor: {}, obj: {} }, walls: {}, roofs: [],
      };
    }
    indexPlots(g.world, g.plots);
    if (announce) for (const st of this.s.stalls?.list || []) g.broadcast({ type: 'plot', plot: g.plots[st.id] });
  }
  restockStall(st) {
    const g = this.game, plot = g.plots[st.id], n = this.npcs[st.npc];
    if (!plot || !n) return;
    const shelf = plot.obj['0,1'];
    shelf.stock = (WARES[st.npc] || []).filter((i) => GOODS[i]).slice(0, slotsOf(shelf.t)).map((item) => ({ item, n: 3 + Math.floor(Math.random() * 4), price: Math.max(2, Math.round(valueOf(item) * (1.25 - n.s.traits.generosity / 250))) }));
    st.stock = shelf.stock; // (kept with the plan, so a restart doesn't refill the shelf)
    g.plotChanged(plot);
  }
  // Keepers head to their stall for their hours, and call out to people walking past.
  tickStalls(now, hours) {
    const g = this.game;
    for (const st of this.s.stalls?.list || []) {
      const n = this.npcs[st.npc], plot = g.plots[st.id];
      if (!n || !plot) continue;
      const h = hours < 5 ? hours + 24 : hours;
      const on = h >= st.from && h < st.to;
      if (on && n.agenda?.kind !== 'stall' && !n.asleep && !n.convo && !n.talkingTo) {
        this.send(n, { kind: 'stall', verb: `selling at their stall in ${st.area}`, act: 'work', x: (st.x + 1) * TILE, y: (st.y + 0.55) * TILE, hours: st.to - h, still: true,
          arrive: () => { n.dir = 0; } });
      }
      const open = on && n.agenda?.kind === 'stall' && !!n.agenda.arrived && Math.hypot(n.x - (st.x + 1) * TILE, n.y - (st.y + 0.55) * TILE) < TILE;
      if (plot.biz.closed === open) { plot.biz.closed = !open; st.stock = plot.obj['0,1'].stock || []; g.plotChanged(plot); this.mark(); }
      if (!open || now - (st.calledAt || 0) < 4000) continue;
      // Someone walking past the front of the stall?
      const fx = (st.x + 1) * TILE, fy = (st.y + 2.5) * TILE;
      for (const s of g.sessions.values()) {
        if (Math.hypot(s.x - fx, s.y - fy) > CALL_RANGE || s.act) continue;
        const k = `${n.id}|${s.profile.id}`;
        if (now - (this.called.get(k) || -1e12) < HOUR_MS * 3) continue;
        this.called.set(k, now);
        st.calledAt = now;
        this.callOut(n, s, plot, st).catch((e) => console.error('call out', e));
        break;
      }
    }
  }
  async callOut(n, s, plot, st) {
    const g = this.game;
    const stock = this.shelves(plot).filter(({ sl }) => sl.n > 0).map(({ sl }) => sl);
    if (!stock.length) return;
    const feat = n.def.likes.length && stock.find((sl) => n.def.likes.includes(sl.item)) || pick(stock);
    const goods = stock.map((sl) => GOODS[sl.item].name).join(', ');
    n.faceToward(s.x, s.y);
    const text = await this.oneLine(n, s.profile, `You're behind your market stall at ${st.area}, selling ${goods}. ${s.profile.name} is walking past. Call out to them like a market seller, in your own voice, tempting them with the ${GOODS[feat.item].name} (${feat.price} coins). Speak straight to them. Max 20 words.`)
      || `${pick(voiceOf(n.id).quirks)} Fresh ${GOODS[feat.item].name}, only 🪙${feat.price}!`;
    this.bubble(n, text);
    if (!g.sessions.has(s.profile.id)) return;
    const id = this.nextOffer++;
    this.offers.set(id, { pid: s.profile.id, npc: n.id, item: feat.item, price: feat.price, plotId: plot.id, until: g.now() + 60_000 });
    s.send({ type: 'npcOffer', id, npc: n.id, item: feat.item, price: feat.price, text, stall: plot.id });
  }
  stallOf(id) {
    const st = this.s.stalls?.list.find((x) => x.npc === id);
    return st ? { area: st.area, from: st.from, to: st.to } : null;
  }

  // Walk-in customers at the villagers' shops.
  tickSales(now, hours) {
    if (now < this.nextSale) return;
    this.nextSale = now + HOUR_MS / 6;
    const g = this.game;
    for (const v of Object.values(this.s.ventures)) {
      const plot = g.plots[v.plotId];
      if (!plot?.biz || !shopOpen(plot.biz, hours, false)) continue;
      const shelf = this.shelves(plot).filter(({ sl }) => sl.n > 0);
      if (!shelf.length) continue;
      const tended = v.owners.some((id) => this.npcs[id].agenda?.kind === 'mind');
      if (Math.random() > (1.2 + g.biz.traffic(plot)) * (tended ? 1.4 : 1) / 6) continue;
      const { o, sl } = pick(shelf);
      sl.n -= 1;
      if (sl.n <= 0) { o.stock.splice(o.stock.indexOf(sl), 1); if (!o.stock.length) delete o.stock; }
      g.plotChanged(plot);
      this.pay(v, sl.price, pick(['a tourist', 'a farmer', 'old Mr. Finch', 'the Baker twins', 'a travelling bard', 'Mrs. Pennywhistle']), sl.item);
    }
  }

  // ---------- conversations ----------
  list() { return [...this.convos.values()].map((c) => this.convoView(c)); }
  convoView(c) { return { id: c.id, members: c.members, x: c.x, y: c.y, players: [...c.players.keys()], topic: c.topic || '' }; }
  start(members, purpose = null, topic = '', planned = false) {
    const g = this.game, now = g.now();
    members = [...new Set(members)].filter((id) => this.npcs[id] && !this.npcs[id].convo);
    if (members.length < 2 || this.convos.size >= MAX_CONVOS) return null;
    const pair = members.slice(0, 2).sort().join('|');
    if (!purpose && !planned && now - (this.pairCool.get(pair) || 0) < HOUR_MS * 3) return null;
    this.pairCool.set(pair, now);
    const ns = members.map((id) => this.npcs[id]);
    const x = ns.reduce((a, n) => a + n.x, 0) / ns.length, y = ns.reduce((a, n) => a + n.y, 0) / ns.length;
    const c = { id: this.nextConvo++, members, players: new Map(), x, y, lines: [], queue: [], pending: [], purpose, topic, writing: false, next: now + 1200, rounds: 0, maxRounds: purpose ? 2 : 1 + Math.floor(Math.random() * 2), lastPlayer: 0, outcome: null };
    this.convos.set(c.id, c);
    for (const n of ns) this.hold(n, c);
    g.broadcast({ type: 'convo', convo: this.convoView(c) });
    return c;
  }
  hold(n, c) {
    n.convo = c.id;
    n.talkingTo = `convo:${c.id}`;
    n.talkUntil = this.game.now() + 90_000;
    n.path = null;
    if (n.agenda) n.agenda.until = Math.max(n.agenda.until, this.game.now() + 60_000);
    n.faceToward(c.x, c.y);
  }
  addMember(c, n) {
    if (c.members.includes(n.id)) return;
    c.members.push(n.id);
    this.hold(n, c);
    c.pending.push({ who: '*', text: `${n.def.name} walks up and joins the conversation` });
    this.game.broadcast({ type: 'convo', convo: this.convoView(c) });
  }
  join(s, { id }) {
    const c = this.convos.get(id);
    if (!c) return s.send({ type: 'error', msg: 'They’ve finished talking' });
    if (Math.hypot(c.x - s.x, c.y - s.y) > JOIN_RANGE) return s.send({ type: 'error', msg: 'Walk over to them first' });
    for (const o of this.convos.values()) if (o !== c && o.players.has(s.profile.id)) this.leave(s, { id: o.id });
    if (!c.players.has(s.profile.id)) {
      c.players.set(s.profile.id, s.profile.name);
      c.pending.push({ who: '*', text: `${s.profile.name} walks up and joins the conversation` });
      c.lastPlayer = this.game.now();
      c.queue.length = Math.min(c.queue.length, 1); // they stop to say hello
      c.maxRounds = Math.max(c.maxRounds, c.rounds + 2);
    }
    for (const id of c.members) this.npcs[id].talkUntil = this.game.now() + 90_000;
    s.send({ type: 'convoJoined', convo: this.convoView(c), lines: c.lines.slice(-30) });
    this.game.broadcast({ type: 'convo', convo: this.convoView(c) });
  }
  leave(s, { id }) {
    const c = this.convos.get(id);
    if (!c?.players.has(s.profile.id)) return;
    c.players.delete(s.profile.id);
    c.pending.push({ who: '*', text: `${s.profile.name} says goodbye and leaves` });
    this.game.broadcast({ type: 'convo', convo: this.convoView(c) });
  }
  say(s, { id, text }) {
    const g = this.game, c = this.convos.get(id), now = g.now();
    text = tidy(text, 160).replace(/[<>]/g, '');
    if (!c || !text) return;
    if (!c.players.has(s.profile.id)) this.join(s, { id });
    if (!c.players.has(s.profile.id)) return;
    if (now - (s.lastGroupSay || 0) < 1200) return s.send({ type: 'error', msg: 'Give them a moment to answer' });
    s.lastGroupSay = now;
    const line = { who: s.profile.id, name: s.profile.name, text, player: true };
    c.lines.push(line);
    c.pending.push(line);
    c.lastPlayer = now;
    c.queue.length = 0; // everyone turns to listen
    c.maxRounds = Math.max(c.maxRounds, c.rounds + 2);
    for (const mid of c.members) this.npcs[mid].talkUntil = now + 90_000;
    g.broadcast({ type: 'chat', id: s.profile.id, name: s.profile.name, text, to: this.names(c.members) });
    g.broadcast({ type: 'convoLine', id: c.id, line });
    g.mood?.chatted?.(s);
  }
  tickConvos(now) {
    const g = this.game;
    for (const c of [...this.convos.values()]) {
      // Players who wander off leave the conversation.
      for (const [pid] of c.players) { const s = g.sessions.get(pid); if (!s || Math.hypot(s.x - c.x, s.y - c.y) > HEAR_RANGE) { c.players.delete(pid); if (s) s.send({ type: 'convoEnd', id: c.id }); } }
      if (c.queue.length) {
        if (now < c.next) continue;
        const [who, text] = c.queue.shift();
        const n = this.npcs[who];
        if (!n) continue;
        const line = { who, name: n.def.name, text };
        c.lines.push(line);
        if (c.lines.length > 60) c.lines.splice(0, c.lines.length - 60);
        this.bubble(n, text);
        g.broadcast({ type: 'convoLine', id: c.id, line });
        c.next = now + Math.min(8000, 2600 + text.length * 45);
        for (const id of c.members) { this.npcs[id].talkUntil = now + 60_000; this.npcs[id].faceToward(n.x, n.y); }
        n.faceToward(c.x, c.y);
        continue;
      }
      if (c.writing || now < c.next) continue;
      const playersHere = c.players.size > 0;
      if (c.pending.length || c.rounds < c.maxRounds || (playersHere && now - c.lastPlayer < 75_000 && c.rounds < 14)) {
        if (!c.pending.length && playersHere && c.rounds >= c.maxRounds) { c.next = now + 3000; continue; } // waiting for the player
        this.write(c).catch((e) => console.error('convo', e));
      } else this.end(c);
    }
  }
  async write(c) {
    const g = this.game;
    c.writing = true;
    c.rounds++;
    const pending = c.pending.splice(0);
    let res = null;
    try {
      // Only spend the AI on conversations someone could overhear (or that decide something).
      const heard = c.purpose || [...g.sessions.values()].some((o) => Math.hypot(o.x - c.x, o.y - c.y) < TILE * 40);
      if (g.ai && heard) res = await g.ai(this.convoPrompt(c, pending), CONVO_SCHEMA, (out) => {
        const o = asJson(out);
        const lines = (o?.lines || []).filter((l) => c.members.includes(l.who) && typeof l.text === 'string' && l.text.trim()).map((l) => [l.who, tidy(l.text, 160)]);
        return lines.length ? { ...o, lines } : null;
      }, { maxTokens: 420, temperature: 0.95 }).catch(() => null);
    } finally { c.writing = false; }
    if (!this.convos.has(c.id)) return;
    res ||= this.fallbackConvo(c, pending);
    c.queue.push(...res.lines.slice(0, 6));
    c.next = Math.min(c.next, g.now() + 600);
    // How the group took what the player said.
    const lastPlayer = [...pending].reverse().find((l) => l.player);
    if (lastPlayer && Number.isInteger(res.sentiment)) {
      const s = g.sessions.get(lastPlayer.who);
      if (s) for (const id of c.members) { const n = this.npcs[id]; n.feel(s.profile, res.sentiment * 0.6, g.now(), res.sentiment >= 0 ? `${s.profile.name} was good company` : `${s.profile.name} was rude`, g.epoch); n.rel(s.profile).talks++; g.hearts(s.profile, n); g.mark(`npc:${id}`); }
    }
    if (c.purpose?.kind === 'pitch' && (res.outcome === 'yes' || res.outcome === 'no') && !c.outcome) c.outcome = { yes: res.outcome === 'yes', name: res.name };
    if (res.outcome === 'end' && !c.players.size) c.maxRounds = c.rounds;
  }
  convoPrompt(c, pending) {
    const g = this.game, { hours } = worldClock(g.now(), g.epoch);
    const ns = c.members.map((id) => this.npcs[id]);
    const where = publicAreaAt(Math.floor(c.x / TILE), Math.floor(c.y / TILE))?.name || (() => { const pid = plotIdAtPixel(g.world, c.x, c.y); const p = g.plots[pid]; return p?.name || p?.biz?.name || (p?.ownerName ? `${p.ownerName}’s place` : 'the village lane'); })();
    const who = ns.map((n) => {
      const v = this.ventureOf(n.id), amb = AMBITIONS[n.id];
      const bonds = ns.filter((o) => o !== n).map((o) => `${o.def.name} ${Math.round(this.bond(n.id, o.id))}`).join(', ');
      return `- ${n.id} (${n.def.name}, ${n.def.role}). ${n.def.bio}\n  HOW THEY TALK: ${voiceOf(n.id).diction} Phrases they use: ${voiceOf(n.id).quirks.map((q) => `“${q}”`).join(' ')}\n  Mood: ${moodLabel(n.mood(g.now())).label}. On their mind: ${n.thought || 'nothing much'}. Coins: ${Math.round(n.s.wallet)}. ${v ? `Runs ${v.name} (${VENTURES[v.kind].label}${v.stage < STAGES.length - 1 ? ', still being built' : ''}) with ${v.owners.filter((o) => o !== n.id).map((o) => this.name(o)).join(', ') || 'nobody'}.` : amb ? `Dreams of opening a ${VENTURES[amb.kind].label.toLowerCase()}.` : ''} Feelings toward the others (-100..100): ${bonds || 'n/a'}.`;
    }).join('\n');
    const players = [...c.players.entries()].map(([pid, name]) => {
      const s = g.sessions.get(pid);
      return `- ${name} (a player). ${ns.map((n) => `${n.def.name}: ${s ? n.rel(s.profile).notes.slice(-2).join('; ') || `affinity ${Math.round(n.affinity(s.profile))}` : ''}`).join(' | ')}`;
    }).join('\n');
    const purpose = c.purpose?.kind === 'pitch'
      ? `PURPOSE: ${this.name(c.purpose.from)} is pitching the idea of opening a ${VENTURES[c.purpose.venture].label.toLowerCase()} together to ${this.name(c.purpose.to)}. ${this.name(c.purpose.to)} decides, true to their personality, their coins and how they feel about ${this.name(c.purpose.from)}, whether to go in on it. Set "outcome" to "yes" or "no" once they decide (in this batch), and if yes a short shop "name" (max 26 chars).`
      : c.topic ? `They're ${c.topic}.` : 'A chance meeting: they chat about village life, each other, their plans, gossip.';
    const recent = c.lines.slice(-14).map((l) => `${l.name}: ${l.text}`).join('\n');
    const news = pending.length ? `JUST NOW:\n${pending.map((l) => (l.who === '*' ? `(${l.text})` : `${l.name}: ${l.text}`)).join('\n')}` : '';
    const sys = [
      `You write a live group conversation between villagers in CrossPaths, a cozy life-sim village. It's ${Math.floor(hours)}:00 at ${where}.`,
      `THE VILLAGERS (use their ids in "who"):\n${who}`,
      players ? `PLAYERS IN THE CONVERSATION (real people; never write their lines):\n${players}` : '',
      purpose,
      `Village news:\n- ${g.gossip.slice(-4).join('\n- ') || 'nothing much'}`,
      recent ? `SO FAR:\n${recent}` : '',
      news,
      players ? 'When a villager speaks to a player, they talk TO them ("you", "your"), not about them in the third person.' : '',
      `Write the next ${pending.some((l) => l.player) ? '1 to 3 lines, answering the player directly (whoever would naturally answer; use their name)' : '3 to 5 lines'}. Every villager must sound unmistakably like themselves: follow HOW THEY TALK closely (sentence length, slang, catchphrases). Keep each line under 140 characters, kind and funny (a family game), react to what was just said, and let them make plans, tease, disagree and agree like real people.`,
      `Also give "sentiment" (-2..2): how the villagers felt about the player's latest message (0 if none). Set "outcome" to "end" if the chat is naturally wrapping up, otherwise "none" (or yes/no for a pitch).`,
      'Respond with JSON: {"lines": [{"who": "<id>", "text": "..."}], "outcome": "none", "name": "", "sentiment": 0}',
    ].filter(Boolean).join('\n\n');
    return [{ role: 'system', content: sys }, { role: 'user', content: 'Continue.' }];
  }
  fallbackConvo(c, pending) {
    const ids = c.members;
    const lines = [];
    const player = [...pending].reverse().find((l) => l.player);
    if (player) lines.push([ids[0], `${pick(voiceOf(ids[0]).quirks)} Good to see you, ${player.name}.`]);
    else for (let i = 0; i < Math.min(4, ids.length + 1); i++) lines.push([ids[i % ids.length], pick(voiceOf(ids[i % ids.length]).quirks)]);
    let outcome = 'none';
    if (c.purpose?.kind === 'pitch') {
      const to = this.npcs[c.purpose.to];
      const yes = Math.random() < 0.35 + this.bond(to.id, c.purpose.from) / 200 + to.s.traits.trust / 250 + (to.s.wallet > 300 ? 0.15 : 0);
      lines.push([c.purpose.from, `So… how about we open a ${VENTURES[c.purpose.venture].label.toLowerCase()} together?`]);
      lines.push([to.id, yes ? `You know what? Let’s do it!` : `Oh… I don’t think it’s for me. Sorry!`]);
      outcome = yes ? 'yes' : 'no';
    }
    return { lines, outcome, sentiment: 0 };
  }
  end(c) {
    const g = this.game;
    this.convos.delete(c.id);
    for (const id of c.members) {
      const n = this.npcs[id];
      if (!n) continue;
      n.convo = null;
      if (n.talkingTo === `convo:${c.id}`) { n.talkingTo = null; n.talkUntil = 0; }
      for (const o of c.members) if (o !== id && Math.random() < 0.8) { n.s.bonds[o] = clamp((n.s.bonds[o] || 0) + 2, -100, 100); g.mark(`npc:${id}`); }
      if (n.agenda?.kind === 'visit' || n.agenda?.kind === 'pitch') n.clearAgenda();
    }
    if (c.outcome && c.purpose?.kind === 'pitch') {
      const from = this.npcs[c.purpose.from], to = this.npcs[c.purpose.to];
      if (c.outcome.yes && !this.ventureOf(from.id) && !this.ventureOf(to.id)) { this.addBond(from.id, to.id, 8); this.found(from, [from.id, to.id], c.purpose.venture, c.outcome.name); }
      else if (!c.outcome.yes) { this.addBond(from.id, to.id, -2); from.s.pitchAt = g.now() + HOUR_MS * 6; }
    }
    if (c.lines.length > 3) g.addGossip(this.name(c.members[0]), `${this.names(c.members)} had a long chat${c.players.size ? ` with ${[...c.players.values()].join(' and ')}` : ''}`);
    g.broadcast({ type: 'convoEnd', id: c.id });
  }

  // What a villager knows about their own plans (for one-to-one chats).
  context(n) {
    const v = this.ventureOf(n.id), amb = AMBITIONS[n.id];
    const bits = [`You have ${Math.round(n.s.wallet)} coins saved.`];
    if (v) bits.push(`You run ${v.name}, a ${VENTURES[v.kind].label.toLowerCase()}${v.owners.length > 1 ? ` together with ${v.owners.filter((o) => o !== n.id).map((o) => this.name(o)).join(' and ')}` : ''}${v.plotId == null ? ' (still looking for land)' : v.stage < STAGES.length - 1 ? ' (still being built)' : `, open 8 AM – 8 PM; it has sold ${v.sales || 0} coins’ worth so far`}. You're proud of it and happy to tell people to visit.`);
    else if (amb) bits.push(`You dream of opening a ${VENTURES[amb.kind].label.toLowerCase()} one day.`);
    const friends = Object.entries(n.s.bonds || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).filter(([, b]) => b > 5).map(([id]) => this.name(id));
    if (friends.length) bits.push(`Your closest friends in the village: ${friends.join(', ')}.`);
    const st = this.stallOf(n.id);
    if (st) bits.push(`This week you have a market stall at ${st.area}, open ${fmtH(st.from)} – ${fmtH(st.to)}, selling ${(WARES[n.id] || []).map((i) => GOODS[i]?.name).filter(Boolean).join(', ')}. Tell people about it if it comes up.`);
    if (n.agenda?.verb) bits.push(`Right now you're ${n.agenda.verb}.`);
    return bits.join(' ');
  }

  // ---------- speech ----------
  bubble(n, text) { if (text) this.game.broadcast({ type: 'npcBubble', id: n.id, text: tidy(text, 160) }); }
  async oneLine(n, profile, task) {
    const g = this.game;
    if (!g.ai) return null;
    const msgs = [
      { role: 'system', content: `You are ${n.def.name}, ${n.def.role}, in a cozy village life-sim. ${n.def.bio}\nHOW YOU TALK: ${voiceOf(n.id).diction} Phrases you use: ${voiceOf(n.id).quirks.join(' / ')}\nYou know ${profile.name}: ${friendshipWord(n.affinity(profile))}. You are speaking TO ${profile.name}: address them as "you" (never talk about them in the third person).${n.rel(profile).notes.length ? ` You remember: ${n.rel(profile).notes.slice(-2).join('; ')}.` : ''}\n${task}\nRespond with JSON: {"text": "..."}` },
      { role: 'user', content: 'Go.' },
    ];
    const res = await g.ai(msgs, LINE_SCHEMA, (out) => { const o = asJson(out); return o && typeof o.text === 'string' && o.text.trim() ? tidy(o.text, 160) : null; }, { maxTokens: 80, temperature: 0.9 }).catch(() => null);
    return res;
  }
}
const fmtH = (h) => `${((Math.floor(h) + 11) % 12) + 1} ${h % 24 < 12 ? 'AM' : 'PM'}`;
const friendshipWord = (a) => (a >= 60 ? 'a close friend' : a >= 20 ? 'a friend' : a > -20 ? 'an acquaintance' : 'someone who has been rude to you');

// Apply villagers' saved home rearrangements to their (rebuilt) cottages.
export function applyHomeEdits(plots, npcs) {
  for (const p of Object.values(plots)) {
    if (!p?.home) continue;
    const s = npcs[p.home]?.s;
    if (s?.homeObj) p.obj = JSON.parse(JSON.stringify(s.homeObj));
  }
}

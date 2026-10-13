// Farm life on the server: things dropped on the ground, gifts between players, City Hall
// utilities (water, electricity) with monthly bills, sprinklers, the auto-harvester,
// hired farmhands, the tractor, and Rosa's market prices moving with supply.
import { ITEMS, GOODS, CROPS, cropStage, isWet, itemName } from '../../shared/catalog.js';
import { key, inInterior, roadIn, levelView, objAt, footprint, tilesOf, placementError } from '../../shared/plot.js';
import { TILE, plotIdAtPixel } from '../../shared/world.js';
import { HOUR_MS } from '../../shared/needs.js';
import { NPCS } from '../../shared/npcs.js';
import { UTILITIES, FARMHANDS, MONTH_DAYS, WET_MS, TRACTOR_MODES, connected, reachOf, waterCrop, seedFor } from '../../shared/farm.js';

const MAX_DROPS = 200;
const DROP_LIFE = 2 * 3600_000;   // real time: things left lying around for 2 hours are swept up
const GIVE_RANGE = TILE * 4;

export class Farm {
  constructor(game, saved = {}) {
    this.game = game;
    this.drops = saved.drops || [];
    this.market = saved.market || { sold: {}, day: 0, pick: null };
    this.nextId = this.drops.reduce((a, d) => Math.max(a, d.id), 0) + 1;
    this.nextWork = 0;
    this.nextHands = 0;
  }
  save() { return { drops: this.drops, market: this.market }; }
  // What a player sees of their services, farmhand and the market.
  send(s) {
    const p = s.profile;
    s.send({ type: 'farm', util: p.util || {}, hand: p.hand || null, market: this.marketView() });
  }
  mark() { this.game.mark('farm'); }

  // ---------- coins and bags of people who may be offline ----------
  pay(p, delta) {
    const g = this.game, s = g.sessions.get(p.id);
    if (s) return g.coins(s, delta);
    p.coins += delta;
    g.city.onCoins(delta);
    g.markProfile(p);
  }
  give(p, item, n) {
    const g = this.game, s = g.sessions.get(p.id);
    if (s) return g.bag(s, item, n);
    p.inv[item] = (p.inv[item] || 0) + n;
    if (p.inv[item] <= 0) delete p.inv[item];
    g.markProfile(p);
  }
  tell(p, text) { this.game.sessions.get(p.id)?.send({ type: 'toast', text }); }
  ownerOf(plot) { return plot.owner && Object.values(this.game.profiles).find((p) => p.id === plot.owner); }

  // ---------- dropping and picking up ----------
  drop(s, { item, n = 1 }) {
    const inv = s.profile.inv;
    n = Math.max(1, Math.min(99, Math.floor(n) || 1));
    if (!(inv[item] > 0)) return;
    if (s.ride && item === 'tractor') return s.send({ type: 'error', msg: 'Park the tractor first' });
    n = Math.min(n, inv[item]);
    this.game.bag(s, item, -n);
    const now = this.game.now();
    // Stack onto something of yours already lying right here.
    const near = this.drops.find((d) => d.item === item && d.level === (s.level || 0) && Math.hypot(d.x - s.x, d.y - s.y) < TILE * 0.5);
    if (near) { near.n += n; near.t = now; near.by = s.profile.id; this.game.broadcast({ type: 'drop', drop: near }); }
    else {
      const d = { id: this.nextId++, item, n, x: Math.round(s.x), y: Math.round(s.y + 4), level: s.level || 0, by: s.profile.id, t: now };
      this.drops.push(d);
      while (this.drops.length > MAX_DROPS) this.game.broadcast({ type: 'dropGone', id: this.drops.shift().id });
      this.game.broadcast({ type: 'drop', drop: d });
    }
    this.mark();
    s.send({ type: 'toast', text: `Dropped ${n} × ${itemName(item)}` });
  }

  // Walk over something on the ground to pick it up (not your own drop for a moment).
  pickups(now) {
    if (!this.drops.length) return;
    for (const s of this.game.sessions.values()) {
      if (s.act) continue;
      for (let i = this.drops.length - 1; i >= 0; i--) {
        const d = this.drops[i];
        if (d.level !== (s.level || 0) || Math.abs(d.x - s.x) > TILE * 0.6 || Math.abs(d.y - s.y) > TILE * 0.6) continue;
        if (d.by === s.profile.id && now - d.t < 4000) continue;
        this.drops.splice(i, 1);
        this.game.bag(s, d.item, d.n);
        s.send({ type: 'toast', text: `Picked up ${d.n} × ${itemName(d.item)}` });
        this.game.broadcast({ type: 'dropGone', id: d.id, by: s.profile.id });
        this.mark();
      }
    }
    if (now - (this.lastSweep || 0) > 60_000) {
      this.lastSweep = now;
      const old = this.drops.filter((d) => now - d.t > DROP_LIFE);
      if (old.length) {
        this.drops = this.drops.filter((d) => now - d.t <= DROP_LIFE);
        for (const d of old) this.game.broadcast({ type: 'dropGone', id: d.id });
        this.mark();
      }
    }
  }

  // ---------- giving to another player ----------
  giveTo(s, { to, item, n = 1, coins }) {
    const g = this.game;
    const o = g.sessions.get(to);
    if (!o || o === s) return;
    if (Math.hypot(o.x - s.x, o.y - s.y) > GIVE_RANGE) return s.send({ type: 'error', msg: `Walk closer to ${o.profile.name}` });
    if (coins != null) {
      const c = Math.floor(Number(coins));
      if (!(c > 0) || c > s.profile.coins) return s.send({ type: 'error', msg: 'Not enough coins' });
      g.coins(s, -c);
      g.coins(o, c);
      s.send({ type: 'toast', text: `🪙 You gave ${o.profile.name} ${c} coins` });
      o.send({ type: 'gifted', from: s.profile.name, text: `🪙 ${s.profile.name} gave you ${c} coins!` });
      return;
    }
    n = Math.max(1, Math.min(99, Math.floor(n) || 1));
    if (!(s.profile.inv[item] > 0)) return;
    if (s.ride && item === 'tractor') return s.send({ type: 'error', msg: 'Park the tractor first' });
    n = Math.min(n, s.profile.inv[item]);
    g.bag(s, item, -n);
    g.bag(o, item, n);
    s.send({ type: 'toast', text: `🎁 You gave ${o.profile.name} ${n} × ${itemName(item)}` });
    o.send({ type: 'gifted', from: s.profile.name, text: `🎁 ${s.profile.name} gave you ${n} × ${itemName(item)}!` });
  }

  // ---------- City Hall: water and electricity ----------
  homePlot(p) { return p.plotId != null ? this.game.plots[p.plotId] : null; }
  // Services reach every plot you own (your home and your shop).
  syncUtil(p) {
    for (const id of [p.plotId, p.biz?.plotId]) {
      const plot = id != null && this.game.plots[id];
      if (!plot || plot.owner !== p.id) continue;
      for (const kind of Object.keys(UTILITIES)) this.setPlotUtil(plot, kind, !!p.util?.[kind] && !p.util[kind].off);
    }
  }

  utilStart(s, { kind }) {
    const u = UTILITIES[kind], p = s.profile;
    if (!u) return 'Unknown service';
    const plot = this.homePlot(p);
    if (!plot) return 'Claim a plot first: utilities go to your home';
    p.util ||= {};
    if (p.util[kind]) return `You already have ${u.name.toLowerCase()}`;
    const cost = u.setup + u.monthly;
    if (p.coins < cost) return `Hooking up ${u.name.toLowerCase()} costs 🪙${cost} (🪙${u.setup} setup + the first month)`;
    this.game.coins(s, -cost);
    this.game.city.onLand(cost);
    const day = this.game.day();
    p.util[kind] = { since: day, due: day + MONTH_DAYS };
    this.game.markProfile(p);
    const placed = [plot, plot.l1].some((v) => v && Object.values(v.obj).some((o) => o.t === u.item));
    if (!placed && !p.inv[u.item]) this.game.bag(s, u.item, 1);
    this.syncUtil(p);
    this.send(s);
    s.send({ type: 'toast', text: `${u.icon} ${u.name} is on! ${placed ? '' : `Your ${ITEMS[u.item].name.toLowerCase()} is in your bag: place it anywhere on your plot (Build → Bag). `}Bill: 🪙${u.monthly} a month.` });
    this.game.addGossip('City Hall', `${p.name} just got ${u.name.toLowerCase()} hooked up`);
    return null;
  }

  utilPay(s, { kind }) {
    const u = UTILITIES[kind], p = s.profile, cur = p.util?.[kind];
    if (!u || !cur) return 'You don’t have that service';
    if (!cur.off) return 'Your bill is paid up';
    if (p.coins < u.monthly) return `The overdue bill is 🪙${u.monthly}`;
    this.game.coins(s, -u.monthly);
    this.game.city.onLand(u.monthly);
    cur.off = false;
    cur.due = this.game.day() + MONTH_DAYS;
    this.game.markProfile(p);
    this.syncUtil(p);
    this.send(s);
    s.send({ type: 'toast', text: `${u.icon} Paid! ${u.name} is back on.` });
    return null;
  }

  utilStop(s, { kind }) {
    const u = UTILITIES[kind], p = s.profile;
    if (!u || !p.util?.[kind]) return 'You don’t have that service';
    if (p.util[kind].off) return `Pay the overdue bill (🪙${u.monthly}) before cancelling`;
    delete p.util[kind];
    this.game.markProfile(p);
    this.syncUtil(p);
    this.send(s);
    s.send({ type: 'toast', text: `${u.icon} ${u.name} cancelled. No more bills.` });
    return null;
  }

  setPlotUtil(plot, kind, on) {
    plot.util ||= {};
    if (!!plot.util[kind] === on) return;
    if (on) plot.util[kind] = 1; else delete plot.util[kind];
    this.game.plotChanged(plot);
  }

  // Each morning: bills that are due get paid (or the service is cut off), farmhands get
  // their wage, and Rosa picks a crop she'll pay extra for.
  newDay(day) {
    const g = this.game;
    for (const p of Object.values(g.profiles)) {
      for (const [kind, cur] of Object.entries(p.util || {})) {
        const u = UTILITIES[kind];
        if (!u || cur.off || day < cur.due) continue;
        if (p.coins >= u.monthly) {
          this.pay(p, -u.monthly);
          g.city.onLand(u.monthly);
          cur.due += MONTH_DAYS;
          this.tell(p, `${u.icon} Paid this month’s ${u.name.toLowerCase()} bill: 🪙${u.monthly}`);
        } else {
          cur.off = true;
          this.syncUtil(p);
          this.tell(p, `⚠️ Your ${u.name.toLowerCase()} was cut off: you couldn’t pay the 🪙${u.monthly} bill. Pay it at City Hall.`);
        }
        g.markProfile(p);
      }
      const h = p.hand && FARMHANDS[p.hand];
      if (h && p.handPaid !== day) {
        p.handPaid = day;
        const plot = this.homePlot(p);
        if (p.coins >= h.wage) this.pay(p, -h.wage);
        else {
          p.hand = null;
          if (plot) { delete plot.hand; g.plotChanged(plot); }
          this.tell(p, `😢 ${h.name} quit: you couldn’t pay today’s wage (🪙${h.wage}).`);
        }
        g.markProfile(p);
      }
    }
    // The market: Rosa's pick of the day pays 50% more.
    const crops = NPCS.rosa.buys;
    this.market.pick = crops[Math.floor(Math.random() * crops.length)];
    this.market.day = day;
    this.mark();
    g.addGossip('Rosa', `Rosa is paying extra for ${itemName(this.market.pick)} today`);
    for (const s of g.sessions.values()) this.send(s);
  }

  // ---------- farmhands ----------
  hireHand(s, { id }) {
    const h = FARMHANDS[id], p = s.profile;
    if (!h) return 'Unknown farmhand';
    const plot = this.homePlot(p);
    if (!plot) return 'Claim a plot first';
    if (p.hand === id) return `${h.name} already works for you`;
    if (p.coins < h.wage) return `${h.name} wants today’s wage up front (🪙${h.wage})`;
    this.game.coins(s, -h.wage);
    p.hand = id;
    p.handPaid = this.game.day();
    this.game.markProfile(p);
    plot.hand = id;
    this.game.plotChanged(plot);
    this.send(s);
    s.send({ type: 'toast', text: `🧑‍🌾 ${h.name} starts work on your farm: watering, harvesting and replanting. 🪙${h.wage} a day.` });
    return null;
  }

  fireHand(s) {
    const p = s.profile;
    if (!p.hand) return 'You don’t have a farmhand';
    const h = FARMHANDS[p.hand];
    p.hand = null;
    this.game.markProfile(p);
    const plot = this.homePlot(p);
    if (plot) { delete plot.hand; this.game.plotChanged(plot); }
    this.send(s);
    s.send({ type: 'toast', text: `👋 ${h?.name || 'Your farmhand'} hangs up their hat.` });
    return null;
  }

  // Pick a ripe crop at `k` for `p`; replant it if they can afford the seed.
  pick(plot, k, p, now, replant) {
    const o = plot.obj[k];
    const crop = ITEMS[o.t].crop;
    this.give(p, crop, 1);
    p.stats ||= {};
    const seed = replant && seedFor(crop);
    if (seed && p.coins >= ITEMS[seed].price) {
      this.pay(p, -ITEMS[seed].price);
      const wet = isWet(o, now) ? { wf: now, wu: o.wu } : {};
      plot.obj[k] = { t: seed, p: now, ...wet };
    } else delete plot.obj[k];
    return crop;
  }

  // ---------- sprinklers, harvesters, farmhands ----------
  tick(now) {
    const g = this.game;
    const day = g.day();
    if (this.market.day !== day && this.lastDay !== day) { this.lastDay = day; this.newDay(day); }
    if (now - (this.lastDecay || 0) > HOUR_MS) {
      this.lastDecay = now;
      for (const [k, v] of Object.entries(this.market.sold)) { const n = v * 0.88; if (n > 0.5) this.market.sold[k] = n; else delete this.market.sold[k]; }
    }
    this.pickups(now);
    if (now < this.nextWork) return;
    this.nextWork = now + 3000;
    const handsDue = now >= this.nextHands;
    if (handsDue) this.nextHands = now + HOUR_MS / 2;
    for (const plot of Object.values(g.plots)) {
      if (!plot.owner || (!plot.util && !plot.hand)) continue;
      let changed = false;
      const owner = (plot.util?.power || plot.hand) && this.ownerOf(plot);
      const got = {};
      for (const [k, o] of Object.entries(plot.obj)) {
        const d = ITEMS[o.t];
        if (!d?.needs || !d.reach) continue;
        if (!connected(plot, k, d.needs)) continue;
        if (d.needs === 'water') {
          for (const c of reachOf(plot, k)) {
            const crop = plot.obj[c];
            if (cropStage(crop, now) < 3 && !(crop.wu > now + WET_MS * 0.3)) { waterCrop(crop, now); changed = true; }
          }
        } else if (o.t === 'harvester' && owner) {
          for (const c of reachOf(plot, k)) {
            if (cropStage(plot.obj[c], now) < 3) continue;
            const crop = this.pick(plot, c, owner, now, true);
            got[crop] = (got[crop] || 0) + 1;
            changed = true;
          }
        }
      }
      if (handsDue && plot.hand && owner) changed = this.handWork(plot, owner, now, got) || changed;
      if (Object.keys(got).length) {
        const s = g.sessions.get(owner.id);
        s?.send({ type: 'harvested', items: got, auto: true });
      }
      if (changed) g.plotChanged(plot);
    }
  }

  // Half an in-game hour of a farmhand's work: harvest (and replant), then water.
  handWork(plot, owner, now, got) {
    const h = FARMHANDS[plot.hand];
    if (!h || owner.hand !== plot.hand) { delete plot.hand; return true; }
    let left = Math.ceil(h.rate / 2);
    let did = false;
    const crops = Object.entries(plot.obj).filter(([, o]) => ITEMS[o.t]?.crop);
    for (const [k, o] of crops) {
      if (left <= 0) break;
      if (cropStage(o, now) < 3) continue;
      const crop = this.pick(plot, k, owner, now, true);
      got[crop] = (got[crop] || 0) + 1;
      left--; did = true;
    }
    for (const [k] of crops) {
      if (left <= 0) break;
      const o = plot.obj[k];
      if (!o || !ITEMS[o.t]?.crop || isWet(o, now + WET_MS * 0.3) || cropStage(o, now) >= 3) continue;
      waterCrop(o, now);
      left--; did = true;
    }
    return did;
  }

  // ---------- the tractor ----------
  mount(s, { plotId, lx, ly }) {
    const g = this.game;
    if (s.ride) return;
    const plot = g.ownPlot(s, plotId);
    if (!plot || !Number.isInteger(lx) || !Number.isInteger(ly) || s.level) return;
    const hit = objAt(plot, lx, ly);
    if (!hit || hit.obj.t !== 'tractor') return;
    const [ax, ay] = hit.key.split(',').map(Number);
    const [w, h] = footprint('tractor', hit.obj.r || 0);
    const x0 = (plot.x + ax) * TILE, y0 = (plot.y + ay) * TILE;
    const dx = Math.max(x0 - s.x, 0, s.x - x0 - w * TILE), dy = Math.max(y0 - s.y, 0, s.y - y0 - h * TILE);
    if (Math.hypot(dx, dy) > TILE * 1.6) return s.send({ type: 'error', msg: 'Walk up to the tractor first' });
    if (s.act) g.stopActivity(s, false);
    delete plot.obj[hit.key];
    g.bag(s, 'tractor', 1); // it's with you while you drive
    s.x = x0 + w * TILE / 2; s.y = y0 + h * TILE / 2; s.lastMove = g.now();
    s.dir = w > h ? (hit.obj.r === 1 ? 3 : 2) : (hit.obj.r === 2 ? 0 : 1);
    s.ride = { mode: s.ride?.mode || 'harvest', seed: s.lastSeed || 'seed_turnip' };
    s.send({ type: 'pos', x: s.x, y: s.y, level: 0 });
    g.plotChanged(plot);
    this.sendRide(s);
  }

  sendRide(s) { s.send({ type: 'ride', ride: s.ride || null }); }

  rideMode(s, { mode, seed }) {
    if (!s.ride) return;
    if (TRACTOR_MODES[mode]) s.ride.mode = mode;
    if (ITEMS[seed]?.crop) s.ride.seed = s.lastSeed = seed;
    this.sendRide(s);
  }

  // Park where you are (on your plot), facing the way you drive; else it goes in your bag.
  park(s, quiet = false) {
    const g = this.game;
    if (!s.ride) return;
    s.ride = null;
    const id = plotIdAtPixel(g.world, s.x, s.y);
    const plot = id >= 0 ? g.plots[id] : null;
    let parked = false;
    if (plot && plot.owner === s.profile.id && !s.level && s.profile.inv.tractor > 0) {
      const r = s.dir === 2 || s.dir === 3 ? 1 : 0;
      const [w, h] = footprint('tractor', r);
      const fx = s.x / TILE - plot.x - w / 2, fy = s.y / TILE - plot.y - h / 2;
      const spots = [[Math.round(fx), Math.round(fy)], [Math.floor(fx), Math.floor(fy)], [Math.ceil(fx), Math.ceil(fy)], [Math.round(fx) + 1, Math.round(fy)], [Math.round(fx) - 1, Math.round(fy)], [Math.round(fx), Math.round(fy) + 1], [Math.round(fx), Math.round(fy) - 1]];
      for (const [lx, ly] of spots) {
        if (placementError(plot, lx, ly, 'tractor', r, 0, g.world)) continue;
        if (this.othersOn(plot, tilesOf('tractor', r, lx, ly), s)) continue;
        plot.obj[key(lx, ly)] = r ? { t: 'tractor', r } : { t: 'tractor' };
        g.bag(s, 'tractor', -1);
        // Step off beside it.
        const side = r ? [0, h] : [w, 0];
        s.x = (plot.x + lx + side[0] + (r ? w / 2 : 0.5)) * TILE;
        s.y = (plot.y + ly + side[1] + (r ? 0.6 : h / 2)) * TILE;
        if (!quiet) s.send({ type: 'pos', x: s.x, y: s.y, level: 0 });
        g.plotChanged(plot);
        parked = true;
        break;
      }
    }
    if (!quiet) {
      if (!parked) s.send({ type: 'toast', text: '🚜 No room to park here, so the tractor went in your bag: place it from Build → Bag.' });
      this.sendRide(s);
    }
  }

  othersOn(plot, tiles, me) {
    for (const [lx, ly] of tiles) {
      const x0 = (plot.x + lx) * TILE, y0 = (plot.y + ly) * TILE;
      for (const o of this.game.sessions.values()) if (o !== me && !o.level && o.x + 5 > x0 && o.x - 5 < x0 + TILE && o.y > y0 && o.y - 5 < y0 + TILE) return true;
    }
    return false;
  }

  // Tiles the tractor passes over: { plotId, tiles: [[lx, ly], ...] }.
  work(s, { plotId, tiles }) {
    const g = this.game;
    if (!s.ride || s.level || !Array.isArray(tiles)) return;
    const plot = g.plots[plotId];
    if (!plot || plot.owner !== s.profile.id) return;
    const now = g.now(), mode = s.ride.mode;
    if (mode === 'water' && !plot.util?.water) return s.send({ type: 'error', msg: 'The tractor fills its tank from your water: get water at City Hall' });
    const got = {};
    let changed = false, spent = 0, broke = false;
    for (const t of tiles.slice(0, 12)) {
      if (!Array.isArray(t) || !t.every(Number.isInteger)) continue;
      const [lx, ly] = t;
      const cx = (plot.x + lx + 0.5) * TILE, cy = (plot.y + ly + 0.5) * TILE;
      if (Math.hypot(cx - s.x, cy - s.y) > TILE * 2.6 || !inInterior(plot, lx, ly) || roadIn(g.world, plot, lx, ly)) continue;
      const k = key(lx, ly), o = plot.obj[k];
      if (mode === 'harvest') {
        if (!o || !ITEMS[o.t]?.crop || cropStage(o, now) < 3) continue;
        const crop = ITEMS[o.t].crop;
        delete plot.obj[k];
        got[crop] = (got[crop] || 0) + 1;
        changed = true;
      } else if (mode === 'water') {
        if (!o || !ITEMS[o.t]?.crop || cropStage(o, now) >= 3 || isWet(o, now + WET_MS * 0.3)) continue;
        waterCrop(o, now);
        changed = true;
      } else if (mode === 'plant') {
        const seed = s.ride.seed;
        if (o || plot.floor[k] !== 'soil' || placementError(plot, lx, ly, seed, 0, 0, g.world)) continue;
        if (s.profile.coins - spent < ITEMS[seed].price) { broke = true; continue; }
        plot.obj[k] = { t: seed, p: now };
        spent += ITEMS[seed].price;
        changed = true;
      } else if (mode === 'till') {
        if (o || plot.floor[k] || objAt(plot, lx, ly)) continue;
        if (s.profile.coins - spent < ITEMS.soil.price) { broke = true; continue; }
        plot.floor[k] = 'soil';
        spent += ITEMS.soil.price;
        changed = true;
      }
    }
    if (spent) g.coins(s, -spent);
    for (const [crop, n] of Object.entries(got)) g.bag(s, crop, n);
    if (Object.keys(got).length) s.send({ type: 'harvested', items: got, quiet: true });
    if (broke) s.send({ type: 'error', msg: 'Out of coins for seeds' });
    if (changed) g.plotChanged(plot);
  }

  // ---------- the market ----------
  // How much Rosa pays right now, relative to normal: lots of one crop sold recently
  // pushes its price down (it recovers hour by hour); her pick of the day pays 50% more.
  sellMult(item) {
    if (!GOODS[item] || GOODS[item].kind === 'gift') return 1;
    const sold = this.market.sold[item] || 0;
    const f = Math.max(0.55, Math.min(1.15, 1.15 - sold / 60));
    return f * (this.market.pick === item ? 1.5 : 1);
  }
  onSold(item, n) {
    this.market.sold[item] = (this.market.sold[item] || 0) + n;
    this.mark();
  }
  marketView() {
    return { pick: this.market.pick, mult: Object.fromEntries((NPCS.rosa.buys || []).map((i) => [i, Math.round(this.sellMult(i) * 100) / 100])) };
  }
}

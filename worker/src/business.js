// Player businesses on the server. A licence (City Hall, 🪙500) lets you claim a second
// plot as your shop. Shelves hold stock at your prices; the shop is open while you work
// the register or a hired clerk is in (8 AM – 8 PM). Walk-in customers come more often
// on busy roads and buy more when prices are fair; players can buy off the shelves too.
// Machines turn crops into products over a few in-game hours.
import { ITEMS, GOODS } from '../../shared/catalog.js';
import { NPCS } from '../../shared/npcs.js';
import { objAt, levelView, footprint } from '../../shared/plot.js';
import { TILE, MAP_W, worldClock } from '../../shared/world.js';
import { HOUR_MS } from '../../shared/needs.js';
import { connected } from '../../shared/farm.js';
import { LICENCE_FEE, RECIPES, STAFF, sellable, valueOf, slotsOf, isMachine, priceAppeal, shopOpen } from '../../shared/business.js';

const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const SHOPPERS = ['Rosa', 'Otto', 'Juniper', 'Mabel', 'a farmer', 'a tourist', 'old Mr. Finch', 'the Baker twins', 'a hungry kid', 'Mayor Bramble', 'a travelling bard', 'Mrs. Pennywhistle'];

export class Business {
  constructor(game) {
    this.game = game;
    this.nextSale = 0;
  }

  // ---------- licence & shop plot ----------
  start(s, { name }) {
    const p = s.profile;
    if (p.biz) return 'You already run a business';
    name = clean(name, 24) || `${p.name}’s Shop`;
    if (p.coins < LICENCE_FEE) return `A business licence costs 🪙${LICENCE_FEE}`;
    this.game.coins(s, -LICENCE_FEE);
    this.game.city.onLand(LICENCE_FEE); // fees go to the treasury
    p.biz = { name, plotId: null, staff: null, closed: false, since: this.game.day(), sales: { day: this.game.day(), today: 0, total: 0, items: 0 }, log: [] };
    this.game.markProfile(p);
    this.game.addGossip('City Hall', `${p.name} just opened a business called “${name}”`);
    s.send({ type: 'toast', text: `🏪 “${name}” is registered! Now pick a plot for your shop: stand on one that’s for sale and tap “Open my shop here”.` });
    this.send(s);
    return null;
  }

  // Claim a free plot as the shop (land costs the usual price per tile).
  claimShop(s, plot) {
    const p = s.profile;
    if (!p.biz) return s.send({ type: 'error', msg: 'Get a business licence at City Hall first' });
    if (p.biz.plotId != null) return s.send({ type: 'error', msg: 'Your business already has a shop' });
    if (plot.owner) return s.send({ type: 'error', msg: 'That plot is taken' });
    const cost = this.game.landCost(s, plot.w * plot.h);
    if (cost > p.coins) return s.send({ type: 'error', msg: `The land costs 🪙${cost}` });
    this.game.payLand(s, cost);
    plot.owner = p.id;
    plot.ownerName = p.name;
    plot.farm = '';
    plot.biz = { name: p.biz.name, staff: p.biz.staff, closed: p.biz.closed };
    p.biz.plotId = plot.id;
    this.game.markProfile(p);
    this.game.plotChanged(plot);
    s.send({ type: 'toast', text: `🏪 This is the home of “${p.biz.name}”! Build it like a house, add shelves and a cash register (Build → Shop & Machines).` });
    this.send(s);
  }

  shopPlotOf(p) { return p.biz?.plotId != null ? this.game.plots[p.biz.plotId] : null; }

  syncPlot(p) {
    const plot = this.shopPlotOf(p);
    if (!plot) return;
    plot.biz = { name: p.biz.name, staff: p.biz.staff, closed: !!p.biz.closed };
    this.game.plotChanged(plot);
  }

  rename(s, { name }) {
    const p = s.profile;
    if (!p.biz) return;
    p.biz.name = clean(name, 24) || p.biz.name;
    this.game.markProfile(p);
    this.syncPlot(p);
    this.send(s);
  }

  setClosed(s, { closed }) {
    const p = s.profile;
    if (!p.biz) return;
    p.biz.closed = !!closed;
    this.game.markProfile(p);
    this.syncPlot(p);
    this.send(s);
  }

  hire(s, { staff }) {
    const p = s.profile, st = STAFF[staff];
    if (!p.biz || !st) return;
    if (p.biz.staff === staff) return;
    if (p.coins < st.wage) return s.send({ type: 'error', msg: `${st.name} wants today’s wage up front (🪙${st.wage})` });
    this.game.coins(s, -st.wage);
    p.biz.staff = staff;
    p.biz.paidDay = this.game.day();
    this.game.markProfile(p);
    this.syncPlot(p);
    s.send({ type: 'toast', text: `🤝 ${st.name} works for you now (🪙${st.wage} a day). They keep the shop open 8 AM – 8 PM.` });
    this.send(s);
  }

  fire(s) {
    const p = s.profile;
    if (!p.biz?.staff) return;
    const st = STAFF[p.biz.staff];
    p.biz.staff = null;
    this.game.markProfile(p);
    this.syncPlot(p);
    s.send({ type: 'toast', text: `👋 ${st.name} hangs up their apron. No hard feelings.` });
    this.send(s);
  }

  // ---------- stock ----------
  // Is the player next to this item? Returns { plot, view, hit } or sends an error.
  reach(s, { plotId, level = 0, lx, ly }, own) {
    const plot = this.game.plots[plotId];
    if (!plot || !Number.isInteger(lx) || !Number.isInteger(ly)) return null;
    if (own && plot.owner !== s.profile.id) { s.send({ type: 'error', msg: 'That isn’t yours' }); return null; }
    level = level === 1 ? 1 : 0;
    const view = levelView(plot, level);
    const hit = objAt(view, lx, ly);
    if (!hit) return null;
    const [ax, ay] = hit.key.split(',').map(Number);
    const [w, h] = footprint(hit.obj.t, hit.obj.r || 0);
    const x0 = (plot.x + ax) * TILE, y0 = (plot.y + ay) * TILE;
    const dx = Math.max(x0 - s.x, 0, s.x - (x0 + w * TILE)), dy = Math.max(y0 - s.y, 0, s.y - (y0 + h * TILE));
    if ((s.level || 0) !== level || Math.hypot(dx, dy) > TILE * 1.8) { s.send({ type: 'error', msg: `Walk up to the ${ITEMS[hit.obj.t].name.toLowerCase()} first` }); return null; }
    return { plot, view, hit, level };
  }

  // Put goods from your bag on a shelf at a price (same item + price stacks).
  stock(s, msg) {
    const r = this.reach(s, msg, true);
    if (!r) return;
    const { plot, hit } = r;
    const slots = slotsOf(hit.obj.t);
    const item = msg.item, p = s.profile;
    const n = Math.max(1, Math.min(99, Math.floor(msg.n) || 1));
    const price = Math.max(1, Math.min(99999, Math.floor(msg.price) || valueOf(item)));
    if (!slots || !sellable(item)) return;
    if ((p.inv[item] || 0) < n) return s.send({ type: 'error', msg: `You only have ${p.inv[item] || 0} ${GOODS[item].name}` });
    const stock = (hit.obj.stock ||= []);
    let slot = stock.find((x) => x.item === item);
    if (slot) slot.price = price;
    else {
      if (stock.length >= slots) return s.send({ type: 'error', msg: `That ${ITEMS[hit.obj.t].name.toLowerCase()} is full (${slots} kinds of goods)` });
      slot = { item, n: 0, price };
      stock.push(slot);
    }
    slot.n += n;
    this.game.bag(s, item, -n);
    this.game.plotChanged(plot);
  }

  // Change a price, or take goods back off the shelf.
  restock(s, msg) {
    const r = this.reach(s, msg, true);
    if (!r) return;
    const slot = r.hit.obj.stock?.[msg.slot];
    if (!slot) return;
    if (msg.price != null) slot.price = Math.max(1, Math.min(99999, Math.floor(msg.price) || slot.price));
    if (msg.take) {
      this.game.bag(s, slot.item, slot.n);
      r.hit.obj.stock.splice(msg.slot, 1);
      if (!r.hit.obj.stock.length) delete r.hit.obj.stock;
    }
    this.game.plotChanged(r.plot);
  }

  // A player buys off someone's shelf.
  buy(s, msg) {
    const r = this.reach(s, msg, false);
    if (!r) return;
    const { plot, hit } = r;
    const owner = this.ownerProfile(plot);
    if (!owner?.biz || owner.biz.plotId !== plot.id) return;
    if (owner.id === s.profile.id) return s.send({ type: 'error', msg: 'That’s your own stock' });
    if (!this.isOpen(owner, plot)) return s.send({ type: 'error', msg: `“${owner.biz.name}” is closed right now${owner.biz.staff ? ' (open 8 AM – 8 PM)' : ''}` });
    const slot = hit.obj.stock?.[msg.slot];
    if (!slot || slot.n < 1) return;
    const n = Math.max(1, Math.min(slot.n, Math.floor(msg.n) || 1));
    const cost = slot.price * n;
    if (s.profile.coins < cost) return s.send({ type: 'error', msg: 'Not enough coins' });
    this.game.coins(s, -cost);
    this.game.bag(s, slot.item, n);
    this.sold(owner, plot, hit, slot, n, s.profile.name);
    s.send({ type: 'toast', text: `🛍️ Bought ${n} × ${GOODS[slot.item].name} for 🪙${cost}` });
  }

  // Money in the till (the owner gets it even when they're away).
  sold(owner, plot, hit, slot, n, who) {
    const g = this.game;
    const cost = slot.price * n;
    const item = slot.item;
    slot.n -= n;
    if (slot.n <= 0) { hit.obj.stock.splice(hit.obj.stock.indexOf(slot), 1); if (!hit.obj.stock.length) delete hit.obj.stock; }
    const tip = this.cashierAt(plot) ? Math.round(cost * 0.1) : 0; // a friendly face at the till earns tips
    const os = g.sessions.get(owner.id);
    if (os) g.coins(os, cost + tip);
    else { owner.coins += cost + tip; g.city.onCoins(cost + tip); }
    const b = owner.biz, day = g.day();
    if (b.sales.day !== day) b.sales = { ...b.sales, day, today: 0 };
    b.sales.today += cost + tip; b.sales.total += cost + tip; b.sales.items = (b.sales.items || 0) + n;
    b.log.unshift({ day, who, item, n, coins: cost + tip });
    if (b.log.length > 12) b.log.length = 12;
    g.markProfile(owner);
    g.plotChanged(plot);
    g.broadcast({ type: 'sale', plotId: plot.id, item, n, coins: cost + tip, who });
    if (os) { os.send({ type: 'toast', text: `🛍️ ${who} bought ${n > 1 ? `${n} × ` : ''}${GOODS[item].name} · +🪙${cost + tip}${tip ? ` (incl. 🪙${tip} tip)` : ''}` }); this.send(os); }
  }

  ownerProfile(plot) {
    if (!plot?.owner) return null;
    const live = this.game.sessions.get(plot.owner);
    if (live) return live.profile;
    return Object.values(this.game.profiles).find((p) => p.id === plot.owner) || null;
  }

  cashierAt(plot) {
    for (const o of this.game.sessions.values()) if (o.act?.id === 'cashier' && o.act.plotId === plot.id && o.profile.id === plot.owner) return o;
    return null;
  }

  isOpen(owner, plot) {
    const { hours } = worldClock(this.game.now(), this.game.epoch);
    return shopOpen(owner.biz, hours, !!this.cashierAt(plot));
  }

  // ---------- machines ----------
  craft(s, msg) {
    const r = this.reach(s, msg, true);
    if (!r) return;
    const { plot, hit } = r;
    const rec = RECIPES[msg.recipe];
    if (!isMachine(hit.obj.t) || !rec || rec.machine !== hit.obj.t) return;
    if (hit.obj.job) return s.send({ type: 'error', msg: 'It’s already busy' });
    const p = s.profile;
    for (const [k, n] of Object.entries(rec.needs)) if ((p.inv[k] || 0) < n) return s.send({ type: 'error', msg: `You need ${Object.entries(rec.needs).map(([kk, nn]) => `${nn} × ${GOODS[kk].name}`).join(' and ')}` });
    for (const [k, n] of Object.entries(rec.needs)) this.game.bag(s, k, -n);
    // Plugged in (a cable to your power box)? Twice as fast.
    const powered = !msg.level && plot.util?.power && connected(plot, hit.key, 'power');
    const hours = powered ? rec.hours / 2 : rec.hours;
    hit.obj.job = { r: msg.recipe, ready: this.game.now() + hours * HOUR_MS };
    this.game.plotChanged(plot);
    s.send({ type: 'toast', text: `⚙️ ${rec.label} will be ready in ${hours} in-game hours${powered ? ' (⚡ powered: 2× speed)' : ''}` });
  }

  collect(s, msg) {
    const r = this.reach(s, msg, true);
    if (!r) return;
    const job = r.hit.obj.job;
    if (!job) return;
    const rec = RECIPES[job.r];
    if (this.game.now() < job.ready) return s.send({ type: 'error', msg: 'Not ready yet' });
    delete r.hit.obj.job;
    this.game.bag(s, rec.out, rec.n);
    this.game.life.onActivity(s, 'craft');
    this.game.plotChanged(r.plot);
    s.send({ type: 'toast', text: `${GOODS[rec.out].icon} Made ${rec.n} × ${GOODS[rec.out].name}!` });
  }

  // ---------- the village shops ----------
  // Every in-game 10 minutes: walk-in customers visit open shops.
  tick(now) {
    if (now < this.nextSale) return;
    this.nextSale = now + HOUR_MS / 6;
    const g = this.game;
    const day = g.day();
    if (this.payDay !== day) { this.payDay = day; this.payWages(day); }
    for (const plot of Object.values(g.plots)) {
      if (!plot.biz) continue;
      const owner = this.ownerProfile(plot);
      if (!owner?.biz || owner.biz.plotId !== plot.id || !this.isOpen(owner, plot)) continue;
      const shelves = [plot, plot.l1].flatMap((v) => (v ? Object.entries(v.obj).filter(([, o]) => o.stock?.length).map(([, o]) => o) : []));
      if (!shelves.length) continue;
      // Customers an hour: a couple, more on busy roads, more with a good clerk.
      const staff = STAFF[owner.biz.staff];
      const perHour = (1.5 + this.traffic(plot)) * (staff?.skill || 1) * (this.cashierAt(plot) ? 1.3 : 1);
      if (Math.random() > perHour / 6) continue;
      const slots = shelves.flatMap((o) => o.stock.map((sl) => ({ o, sl, w: priceAppeal(sl.price, valueOf(sl.item)) })));
      const total = slots.reduce((a, b) => a + b.w, 0);
      if (!total) continue;
      let pick = Math.random() * total, chosen = slots[0];
      for (const x of slots) { pick -= x.w; if (pick <= 0) { chosen = x; break; } }
      if (Math.random() > Math.min(0.95, chosen.w * 0.7)) continue; // looked, didn't buy
      this.sold(owner, plot, { obj: chosen.o }, chosen.sl, 1, SHOPPERS[Math.floor(Math.random() * SHOPPERS.length)]);
    }
  }

  // Footfall on the roads around a plot (from City Hall's traffic data): 0..3.
  traffic(plot) {
    const day = this.game.day();
    const c = (this.trafficCache ||= {});
    if (c[plot.id]?.day === day) return c[plot.id].v;
    const use = this.game.city.s.stats.roadUse;
    let sum = 0;
    for (let y = plot.y - 4; y < plot.y + plot.h + 4; y++) for (let x = plot.x - 4; x < plot.x + plot.w + 4; x++) sum += use[y * MAP_W + x] || 0;
    const v = Math.min(3, Math.log10(1 + sum / 20));
    c[plot.id] = { day, v };
    return v;
  }

  // Clerks are paid each morning; if you can't pay, they leave.
  payWages(day) {
    const g = this.game;
    for (const p of Object.values(g.profiles)) {
      const b = p.biz;
      if (!b?.staff || b.paidDay === day) continue;
      const st = STAFF[b.staff];
      const s = g.sessions.get(p.id);
      b.paidDay = day;
      if (p.coins >= st.wage) {
        if (s) g.coins(s, -st.wage); else { p.coins -= st.wage; g.city.onCoins(-st.wage); }
      } else {
        b.staff = null;
        if (s) s.send({ type: 'toast', text: `😢 ${st.name} quit: you couldn’t pay today’s wage (🪙${st.wage}).` });
      }
      g.markProfile(p);
      this.syncPlot(p);
      if (s) this.send(s);
    }
  }

  // ---------- what the owner sees ----------
  send(s) {
    const p = s.profile;
    if (!p.biz) return s.send({ type: 'business', biz: null });
    const plot = this.shopPlotOf(p);
    const stock = plot ? [plot, plot.l1].flatMap((v) => (v ? Object.values(v.obj).flatMap((o) => o.stock || []) : [])) : [];
    s.send({
      type: 'business',
      biz: {
        ...p.biz,
        open: plot ? this.isOpen(p, plot) : false,
        stockCount: stock.reduce((a, b) => a + b.n, 0),
        traffic: plot ? Math.round(this.traffic(plot) * 10) / 10 : 0,
      },
    });
  }
}

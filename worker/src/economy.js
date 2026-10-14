// The village economy on the server: City Hall's books (every coin in and out), the
// villagers' livelihoods (public servants paid by the treasury, employees by their boss,
// shopkeepers and makers by what they sell), sales tax, savings with interest, festival
// prize pools, and the job board (city shifts paid by the treasury, helper shifts paid by
// villager shops).
import { NPCS } from '../../shared/npcs.js';
import { GOODS } from '../../shared/catalog.js';
import { TILE, worldClock, PUBLIC_AREAS, SQUARE, PARK, PLAZA_LAMPS } from '../../shared/world.js';
import { canStand, plotEntrance } from '../../shared/plot.js';
import { slotsOf } from '../../shared/business.js';
import { HOUR_MS } from '../../shared/needs.js';
import {
  TREASURY_START, LIVELIHOODS, TRADE_INCOME, LIVING, SALES_TAX, PROPERTY_TAX, SAVINGS_RATE, SAVINGS_CAP,
  CITY_JOBS, HELPER_PAY, JOB_HOURS, INCOME, SPENDING, startWallet, fmtHour, FESTIVAL_SPONSOR,
} from '../../shared/economy.js';

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const DONE_RANGE = TILE * 1.6;

export class Economy {
  constructor(game) {
    this.game = game;
    this.shifts = new Map(); // player id -> their shift
    const S = game.city.s;
    // One-time: the richer start (the treasury's opening balance, default rates).
    if (!S.econ) {
      S.econ = 1;
      S.treasury = (S.treasury || 0) + TREASURY_START;
      if (!S.taxRate) S.taxRate = PROPERTY_TAX;
      S.salesTax ??= SALES_TAX;
      game.mark('city');
    }
    S.salesTax ??= SALES_TAX;
    S.books ||= { day: 0, in: {}, out: {}, history: [] };
    S.board ||= { day: 0, jobs: [] };
    for (const n of Object.values(game.npcs)) {
      if (!n.s.econ) { n.s.econ = 1; n.s.wallet = Math.max(n.s.wallet || 0, startWallet(n.id)); game.mark(`npc:${n.id}`); }
    }
  }
  get city() { return this.game.city; }
  get S() { return this.game.city.s; }

  // ---------- City Hall's books ----------
  income(kind, n) {
    n = Math.round(n);
    if (!(n > 0)) return 0;
    const B = this.S.books;
    this.S.treasury += n;
    B.in[kind] = (B.in[kind] || 0) + n;
    this.city.mark();
    return n;
  }
  // Pay out of the treasury (as much as it has). Returns what was paid.
  spend(kind, n) {
    n = Math.round(Math.min(n, this.S.treasury));
    if (!(n > 0)) return 0;
    const B = this.S.books;
    this.S.treasury -= n;
    B.out[kind] = (B.out[kind] || 0) + n;
    this.city.mark();
    return n;
  }
  // Sales tax on a sale: City Hall's cut. Returns what the seller keeps.
  taxSale(amount) {
    const tax = Math.round(amount * (this.S.salesTax ?? SALES_TAX));
    this.income('salesTax', tax);
    return amount - tax;
  }
  wallet(id, delta) {
    const n = this.game.npcs[id];
    if (!n) return;
    n.s.wallet = Math.round((n.s.wallet || 0) + delta);
    this.game.mark(`npc:${id}`);
  }
  // Give a player coins (online or not).
  payPlayer(p, coins, why) {
    const g = this.game, s = g.sessions.get(p.id);
    if (s) { g.coins(s, coins); if (why) s.send({ type: 'toast', text: why }); } else { p.coins += coins; g.city.onCoins(coins); g.markProfile(p); }
  }

  // ---------- each day ----------
  tick(now) {
    const g = this.game, { day, hours } = worldClock(now, g.epoch);
    if (this.S.books.day !== day) this.newDay(day);
    this.tickShifts(now, hours);
  }
  newDay(day) {
    const g = this.game, B = this.S.books;
    if (B.day) { B.history.push({ day: B.day, in: B.in, out: B.out, treasury: this.S.treasury }); if (B.history.length > 14) B.history.shift(); }
    B.day = day; B.in = {}; B.out = {};
    // Villagers' livelihoods.
    const unpaid = [];
    for (const [id, L] of Object.entries(LIVELIHOODS)) {
      if (!g.npcs[id]) continue;
      if (L.kind === 'city') { const paid = this.spend('payroll', L.pay); this.wallet(id, paid); if (paid < L.pay) unpaid.push(NPCS[id].name); }
      else if (L.kind === 'for') { const boss = g.npcs[L.boss]; const paid = Math.min(L.pay, Math.max(0, boss?.s.wallet || 0)); this.wallet(L.boss, -paid); this.wallet(id, paid); }
      else if (L.kind === 'self' && TRADE_INCOME[id]) {
        // Sales to visitors and wholesalers (a bit up or down each day), taxed.
        const takings = Math.round(TRADE_INCOME[id] * (0.6 + Math.random() * 0.8));
        this.wallet(id, this.taxSale(takings));
      }
    }
    if (unpaid.length) g.addGossip('City Hall', `The treasury couldn’t pay ${unpaid.join(', ')} in full today`);
    // Everyone eats: living costs go to Rosa's Market and the saloon (real sales, taxed).
    for (const n of Object.values(g.npcs)) {
      const cost = Math.min(LIVING, Math.max(0, n.s.wallet));
      if (!cost) continue;
      this.wallet(n.id, -cost);
      const shop = n.id === 'rosa' ? 'gus' : n.id === 'gus' ? 'rosa' : Math.random() < 0.6 ? 'rosa' : 'gus';
      this.wallet(shop, this.taxSale(cost));
    }
    // Savings interest once a week (paid by the treasury).
    if ((day - 1) % 7 === 0) {
      for (const p of Object.values(g.profiles)) {
        if (!(p.savings > 0)) continue;
        const want = Math.min(SAVINGS_CAP, Math.round(p.savings * SAVINGS_RATE));
        const paid = this.spend('interest', want);
        if (paid) { p.savings += paid; g.markProfile(p); }
      }
    }
    // Property tax on villagers' land too (on the first day of the month, like players').
    if ((day - 1) % 28 === 0 && this.S.taxRate) {
      for (const v of Object.values(g.agents.s.ventures)) {
        const plot = g.plots[v.plotId];
        if (!plot) continue;
        const tax = Math.round((plot.w * plot.h * this.S.taxRate) / 10 / v.owners.length);
        for (const id of v.owners) { const take = Math.min(tax, Math.max(0, g.npcs[id]?.s.wallet || 0)); this.wallet(id, -take); this.income('propertyTax', take); }
      }
    }
    this.postJobs(day);
    this.city.mark();
  }

  // ---------- savings ----------
  deposit(s, amount) {
    const p = s.profile;
    amount = Math.floor(amount);
    if (!(amount >= 1)) return 'Enter an amount';
    if (amount > p.coins) return `You only have 🪙${p.coins}`;
    this.game.coins(s, -amount);
    p.savings = (p.savings || 0) + amount;
    this.income('deposits', amount);
    this.game.markProfile(p);
    s.send({ type: 'toast', text: `🏦 Saved 🪙${amount}. It earns ${Math.round(SAVINGS_RATE * 100)}% a week.` });
    return null;
  }
  withdraw(s, amount) {
    const p = s.profile;
    amount = Math.floor(amount);
    if (!(amount >= 1)) return 'Enter an amount';
    if (amount > (p.savings || 0)) return `You have 🪙${p.savings || 0} saved`;
    if (amount > this.S.treasury) return `The bank only has 🪙${this.S.treasury} on hand today`;
    const paid = this.spend('withdrawals', amount);
    p.savings -= paid;
    this.game.coins(s, paid);
    this.game.markProfile(p);
    s.send({ type: 'toast', text: `🏦 Took out 🪙${paid}.` });
    return null;
  }

  // ---------- the job board ----------
  // Each morning: city shifts (paid by the treasury) and helper shifts at villagers' shops.
  postJobs(day) {
    const g = this.game;
    const jobs = [];
    for (const [kind, J] of Object.entries(CITY_JOBS)) jobs.push({ id: `${day}:${kind}`, kind, employer: 'city', name: J.name, icon: J.icon, pay: J.pay, where: J.where, hours: J.hours, left: J.shifts });
    // Villager shops with money to spare post a helper shift or two.
    const shops = [];
    for (const p of Object.values(g.plots)) {
      if (p?.town && p.keeper && g.npcs[p.keeper]) shops.push({ plot: p, boss: p.keeper, name: p.name });
      if (p?.venture) { const v = g.agents.s.ventures[p.venture]; if (v?.stage >= 2 && p.biz) shops.push({ plot: p, boss: v.owners[0], name: v.name }); }
    }
    for (const sh of shops) {
      if ((g.npcs[sh.boss]?.s.wallet || 0) < 400) continue;
      jobs.push({ id: `${day}:help:${sh.plot.id}`, kind: 'helper', employer: sh.boss, plotId: sh.plot.id, name: `Shop helper at ${sh.name}`, icon: '🛒', pay: HELPER_PAY, where: sh.name, hours: [8, 19], left: 1 + (Math.random() < 0.5 ? 1 : 0) });
    }
    this.S.board = { day, jobs };
  }
  boardView(p) {
    const s = this.shifts.get(p.id);
    return { jobs: this.S.board.jobs.map((j) => ({ ...j, employerName: j.employer === 'city' ? 'City Hall' : NPCS[j.employer]?.name, verb: CITY_JOBS[j.kind]?.verb || 'Restock the shelf' })), shift: s ? this.shiftView(s) : null };
  }
  shiftView(s) { return { id: s.id, kind: s.kind, name: s.name, icon: s.icon, pay: s.pay, verb: s.verb, until: s.until, employer: s.employerName, spots: s.spots }; }
  sendShift(sess) {
    const sh = this.shifts.get(sess.profile.id);
    sess.send({ type: 'shift', shift: sh ? this.shiftView(sh) : null });
  }
  // Where the work is.
  spotsFor(job) {
    const g = this.game, w = g.world;
    const J = CITY_JOBS[job.kind];
    const n = J?.spots || 3;
    const out = [];
    const far = (x, y, d = 3) => out.every((o) => Math.hypot(o.x - x, o.y - y) >= d);
    if (job.kind === 'helper') {
      const plot = g.plots[job.plotId];
      const shelves = Object.entries(plot?.obj || {}).filter(([, o]) => slotsOf(o.t) || o.t === 'counter' || o.t === 'displaytable');
      for (const [k] of shelves.sort(() => Math.random() - 0.5).slice(0, 3)) { const [x, y] = k.split(',').map(Number); out.push({ x: plot.x + x + 0.5, y: plot.y + y + 1.5 }); }
    } else if (job.kind === 'mail') {
      const homes = Object.values(g.plots).filter((p) => p && (p.home || (p.owner && !p.town && !p.rental && !p.stall))).sort(() => Math.random() - 0.5);
      for (const p of homes) { if (out.length >= n) break; const e = plotEntrance(w, p); if (far(e.x / TILE, e.y / TILE, 8)) out.push({ x: e.x / TILE, y: e.y / TILE, label: p.home ? p.name : `${p.ownerName}’s` }); }
    } else if (job.kind === 'lamps') {
      const inArea = (d, a) => d.x >= a.x && d.y >= a.y && d.x < a.x + a.w && d.y < a.y + a.h;
      const lamps = [...PLAZA_LAMPS.map(([x, y]) => ({ x, y })), ...w.decor.filter((d) => d.t === 'lamppost' && (inArea(d, SQUARE) || inArea(d, PARK)))].sort(() => Math.random() - 0.5);
      for (const l of lamps) { if (out.length >= n) break; const x = l.x + 0.5, y = l.y + 1.4; if (far(x, y, 2) && canStand(w, g.plots, x * TILE, y * TILE)) out.push({ x, y }); }
    } else if (job.kind === 'warden') {
      const stalls = Object.values(g.plots).filter((p) => p?.stall || (p?.rental && p.renter)).sort(() => Math.random() - 0.5);
      for (const p of stalls.slice(0, n)) out.push({ x: p.x + 1, y: p.y + 2.6, label: p.name });
    } else {
      const a = PUBLIC_AREAS.find((x) => x.name === J.area);
      for (let t = 0; t < 600 && out.length < n; t++) {
        const x = a.x + 1 + Math.random() * (a.w - 2), y = a.y + 1 + Math.random() * (a.h - 2);
        if (far(x, y, 3) && canStand(w, g.plots, x * TILE, y * TILE)) out.push({ x, y });
      }
    }
    return out.map((o) => ({ x: Math.round(o.x * 10) / 10, y: Math.round(o.y * 10) / 10, label: o.label || '', done: false }));
  }
  take(s, { id }) {
    const g = this.game, p = s.profile;
    if (this.shifts.has(p.id)) return 'You’re already on a shift: finish it (or quit) first';
    const job = this.S.board.jobs.find((j) => j.id === id);
    if (!job || job.left <= 0) return 'That job’s been taken';
    const { hours } = worldClock(g.now(), g.epoch);
    if (hours < job.hours[0] || hours >= job.hours[1]) return `${job.name} shifts run ${fmtHour(job.hours[0])} – ${fmtHour(job.hours[1])}`;
    const spots = this.spotsFor(job);
    if (!spots.length) return 'There’s no work for that one right now';
    job.left -= 1;
    const sh = { id, kind: job.kind, name: job.name, icon: job.icon, pay: job.pay, employer: job.employer, employerName: job.employer === 'city' ? 'City Hall' : NPCS[job.employer].name, verb: CITY_JOBS[job.kind]?.verb || 'Restock the shelf', spots, until: g.now() + JOB_HOURS * HOUR_MS };
    this.shifts.set(p.id, sh);
    this.city.mark();
    s.send({ type: 'toast', text: `${job.icon} You’re the ${job.name.toLowerCase()} for a while: ${spots.length} spots marked on your map. 🪙${job.pay} when you’re done.` });
    this.sendShift(s);
    return null;
  }
  quit(s) {
    const sh = this.shifts.get(s.profile.id);
    if (!sh) return;
    this.shifts.delete(s.profile.id);
    const job = this.S.board.jobs.find((j) => j.id === sh.id);
    if (job) job.left += 1;
    this.city.mark();
    s.send({ type: 'toast', text: `${sh.icon} You left the shift. No pay this time.` });
    this.sendShift(s);
  }
  // Do the task at one spot (you have to be there).
  work(s, { i }) {
    const g = this.game, sh = this.shifts.get(s.profile.id);
    const sp = sh?.spots[i];
    if (!sp || sp.done) return;
    if (Math.hypot(sp.x * TILE - s.x, sp.y * TILE - s.y) > DONE_RANGE) return s.send({ type: 'error', msg: 'Walk over to the marker first' });
    sp.done = true;
    const left = sh.spots.filter((x) => !x.done).length;
    if (left) { s.send({ type: 'toast', text: `${sh.icon} ${sh.spots.length - left}/${sh.spots.length}` }); return this.sendShift(s); }
    // All done: get paid.
    this.shifts.delete(s.profile.id);
    let paid;
    if (sh.employer === 'city') paid = this.spend('jobs', sh.pay);
    else { const n = g.npcs[sh.employer]; paid = Math.min(sh.pay, Math.max(0, n?.s.wallet || 0)); this.wallet(sh.employer, -paid); }
    if (paid) g.coins(s, paid);
    g.count(s.profile, 'shifts');
    g.mood?.give?.(s, 'delighted');
    s.send({ type: 'toast', text: paid ? `${sh.icon} Shift done! ${sh.employerName} paid you 🪙${paid}.` : `${sh.icon} Shift done, but ${sh.employerName} couldn’t pay you today. Sorry!` });
    if (sh.employer !== 'city') { const n = g.npcs[sh.employer]; if (n) { n.feel(s.profile, 1, g.now(), `${s.profile.name} helped at my shop`, g.epoch); g.hearts(s.profile, n); } }
    this.sendShift(s);
  }
  tickShifts(now) {
    for (const [pid, sh] of this.shifts) {
      if (now < sh.until) continue;
      this.shifts.delete(pid);
      const s = this.game.sessions.get(pid);
      if (s) { s.send({ type: 'toast', text: `${sh.icon} Your ${sh.name.toLowerCase()} shift ran out of time.` }); this.sendShift(s); }
    }
  }
  // A villager takes a city shift (paid when they finish it).
  villagerShift(n, hours) {
    const job = this.S.board.jobs.find((j) => j.employer === 'city' && j.left > 0 && ['gardener', 'sweeper', 'beach'].includes(j.kind) && hours >= j.hours[0] && hours < j.hours[1] - 1.5);
    if (!job) return null;
    job.left -= 1;
    this.city.mark();
    const a = PUBLIC_AREAS.find((x) => x.name === CITY_JOBS[job.kind].area);
    return { job, x: (a.x + a.w / 2) * TILE, y: (a.y + a.h / 2) * TILE, pay: () => { const paid = this.spend('jobs', job.pay); this.wallet(n.id, paid); } };
  }

  // Public projects are built by villagers: a share of the cost goes to the builders.
  payBuilders(cost) {
    const g = this.game, crew = ['bram', 'otto'].filter((id) => g.npcs[id]);
    const share = Math.round((cost * 0.4) / Math.max(1, crew.length));
    for (const id of crew) this.wallet(id, share);
    if (crew.length) g.addGossip('City Hall', `${crew.map((id) => NPCS[id].name).join(' and ')} got the building contract`);
  }

  // ---------- festivals ----------
  // City Hall's sponsorship plus every entry fee makes the prize pool.
  festivalPool(f) { return Math.min(this.S.treasury, FESTIVAL_SPONSOR + (f.fees || 0)); }

  // ---------- what the client shows ----------
  view() {
    const g = this.game, S = this.S, B = S.books;
    const wealth = Object.values(g.npcs).map((n) => ({ id: n.id, name: n.def.name, wallet: Math.round(n.s.wallet || 0), job: LIVELIHOODS[n.id]?.job || '' })).sort((a, b) => b.wallet - a.wallet);
    return {
      salesTax: S.salesTax ?? SALES_TAX, treasury: S.treasury, today: { in: B.in, out: B.out }, history: B.history.slice(-7),
      wealth, incomeNames: INCOME, spendingNames: SPENDING,
      board: S.board.jobs.reduce((a, j) => a + j.left, 0),
    };
  }
}

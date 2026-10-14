// Players together: a two-sided trade window, the village notice board (a player
// market: post things for sale, anyone can buy them), mail (letters with items or coins,
// from any mailbox), co-op farms (let friends farm or build on your plot), and storage
// (chests hold anything, fridges hold food).
import { ITEMS, GOODS, itemName } from '../../shared/catalog.js';
import { FOODS } from '../../shared/needs.js';
import { objAt, footprint, levelView } from '../../shared/plot.js';
import { TILE } from '../../shared/world.js';
import { changeInv } from './game.js';

const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const NEAR = TILE * 4;
const POSTAGE = 5;
export const BOARD_MAX = 60, BOARD_EACH = 5, MAIL_MAX = 30, STORE_MAX = 300, STORE_KINDS = 30;

export class Social {
  constructor(game, saved = {}) {
    this.game = game;
    this.board = saved.board || [];
    this.nextId = Math.max(0, ...this.board.map((b) => b.id)) + 1;
    this.nextMail = 1;
  }
  save() { return { board: this.board }; }
  mark() { this.game.mark('social'); }
  profileByName(name) {
    const n = clean(name, 40).toLowerCase();
    return n ? Object.values(this.game.profiles).find((p) => p.name.toLowerCase() === n) : null;
  }
  // Is there a placed `item` (on a plot) or a public one within reach?
  nearThing(s, item, reach = TILE * 2.2) {
    const g = this.game;
    for (const d of g.world.decor) {
      if (d.t !== item) continue;
      const [w, h] = footprint(d.t, d.r || 0);
      if (Math.hypot((d.x + w / 2) * TILE - s.x, (d.y + h / 2) * TILE - s.y) < reach + TILE * 0.5) return true;
    }
    for (const plot of Object.values(g.plots)) {
      if (Math.abs((plot.x + plot.w / 2) * TILE - s.x) > (plot.w / 2 + 3) * TILE || Math.abs((plot.y + plot.h / 2) * TILE - s.y) > (plot.h / 2 + 3) * TILE) continue;
      for (const [k, o] of Object.entries(plot.obj)) {
        if (o.t !== item) continue;
        const [x, y] = k.split(',').map(Number);
        const [w, h] = footprint(o.t, o.r || 0);
        if (Math.hypot((plot.x + x + w / 2) * TILE - s.x, (plot.y + y + h / 2) * TILE - s.y) < reach + TILE * 0.5) return true;
      }
    }
    return false;
  }

  // ---------- trading ----------
  tradeView(s) {
    const t = s.trade;
    if (!t) return null;
    const o = this.game.sessions.get(t.with);
    return { with: o?.profile.name || '?', withId: t.with, mine: { items: t.items, coins: t.coins, ok: t.ok }, theirs: o?.trade ? { items: o.trade.items, coins: o.trade.coins, ok: o.trade.ok } : null };
  }
  sendTrade(s) { s.send({ type: 'trade', trade: this.tradeView(s) }); }
  tradeAsk(s, { to }) {
    const o = this.game.sessions.get(to);
    if (!o || o === s) return;
    if (Math.hypot(o.x - s.x, o.y - s.y) > NEAR) return s.send({ type: 'error', msg: `Walk closer to ${o.profile.name}` });
    if (s.trade || o.trade) return s.send({ type: 'error', msg: o.trade ? `${o.profile.name} is busy trading` : 'Finish your other trade first' });
    s.trade = { with: o.profile.id, items: {}, coins: 0, ok: false };
    o.trade = { with: s.profile.id, items: {}, coins: 0, ok: false };
    this.sendTrade(s); this.sendTrade(o);
    o.send({ type: 'toast', text: `🤝 ${s.profile.name} wants to trade with you` });
  }
  tradeSet(s, { items = {}, coins = 0 }) {
    const t = s.trade;
    if (!t) return;
    const o = this.game.sessions.get(t.with);
    const offer = {};
    for (const [item, n] of Object.entries(items || {}).slice(0, 8)) {
      const k = Math.max(0, Math.min(99, Math.floor(n) || 0, s.profile.inv[item] || 0));
      if (k && (GOODS[item] || ITEMS[item])) offer[item] = k;
    }
    t.items = offer;
    t.coins = Math.max(0, Math.min(Math.floor(coins) || 0, s.profile.coins));
    t.ok = false;
    if (o?.trade) o.trade.ok = false;
    this.sendTrade(s); if (o) this.sendTrade(o);
  }
  tradeOk(s) {
    const t = s.trade;
    if (!t) return;
    const o = this.game.sessions.get(t.with);
    if (!o?.trade) return this.tradeCancel(s);
    t.ok = true;
    if (!o.trade.ok) { this.sendTrade(s); return this.sendTrade(o); }
    // Both agreed: check everything is still there, then swap.
    const has = (x, tr) => tr.coins <= x.profile.coins && Object.entries(tr.items).every(([i, n]) => (x.profile.inv[i] || 0) >= n);
    if (!has(s, t) || !has(o, o.trade)) { t.ok = o.trade.ok = false; this.sendTrade(s); this.sendTrade(o); return s.send({ type: 'error', msg: 'Something in the trade isn’t there any more' }); }
    if (Math.hypot(o.x - s.x, o.y - s.y) > NEAR * 1.5) return s.send({ type: 'error', msg: 'Stand together to trade' });
    const g = this.game;
    const move = (from, to, tr) => {
      for (const [item, n] of Object.entries(tr.items)) { const took = g.bag(from, item, -n); took.forEach((k, q) => { if (k) g.bag(to, item, k, q); }); }
      if (tr.coins) { g.coins(from, -tr.coins); g.coins(to, tr.coins); }
    };
    const a = t, b = o.trade;
    move(s, o, a); move(o, s, b);
    s.trade = o.trade = null;
    for (const x of [s, o]) { this.sendTrade(x); x.send({ type: 'toast', text: '🤝 Trade done!' }); g.count(x.profile, 'trades'); }
  }
  tradeCancel(s) {
    const t = s.trade;
    if (!t) return;
    const o = this.game.sessions.get(t.with);
    s.trade = null; this.sendTrade(s);
    if (o?.trade?.with === s.profile.id) { o.trade = null; this.sendTrade(o); o.send({ type: 'toast', text: `${s.profile.name} closed the trade` }); }
  }

  // ---------- the notice board ----------
  boardView() { return this.board.map(({ id, by, name, item, n, price, q }) => ({ id, by, name, item, n, price, q })); }
  sendBoard(s) { s.send({ type: 'board', board: this.boardView() }); }
  atBoard(s) {
    if (this.nearThing(s, 'noticeboard', TILE * 2.5)) return true;
    s.send({ type: 'error', msg: 'Go to a notice board (town square or City Hall)' });
    return false;
  }
  boardPost(s, { item, n = 1, price }) {
    if (!this.atBoard(s)) return;
    const p = s.profile;
    n = Math.max(1, Math.min(99, Math.floor(n) || 1, p.inv[item] || 0));
    price = Math.max(1, Math.min(99_999, Math.floor(price) || 0));
    if (!(p.inv[item] > 0) || !(GOODS[item] || ITEMS[item])) return;
    if (this.board.filter((b) => b.by === p.id).length >= BOARD_EACH) return s.send({ type: 'error', msg: `You can have ${BOARD_EACH} notices up at once` });
    if (this.board.length >= BOARD_MAX) return s.send({ type: 'error', msg: 'The board is full: try again later' });
    const took = this.game.bag(s, item, -n, 0, true);
    this.board.push({ id: this.nextId++, by: p.id, uid: p.uid, name: p.name, item, n, price, q: took, t: this.game.now() });
    this.mark();
    s.send({ type: 'toast', text: `📌 Posted: ${n} × ${itemName(item)} at 🪙${price} each` });
    this.broadcastBoard();
  }
  boardBuy(s, { id, n = 1 }) {
    if (!this.atBoard(s)) return;
    const b = this.board.find((x) => x.id === id);
    if (!b) return s.send({ type: 'error', msg: 'That’s already gone' });
    if (b.by === s.profile.id) return this.boardCancel(s, { id });
    n = Math.max(1, Math.min(b.n, Math.floor(n) || 1));
    const cost = b.price * n;
    if (s.profile.coins < cost) return s.send({ type: 'error', msg: `That’s 🪙${cost}` });
    const g = this.game;
    g.coins(s, -cost);
    const seller = Object.values(g.profiles).find((p) => p.id === b.by);
    if (seller) g.farm.pay(seller, cost);
    // Best quality first, as listed.
    let left = n;
    for (const q of [2, 1, 0]) { const k = Math.min(left, b.q?.[q] || 0); if (k) { g.bag(s, b.item, k, q); b.q[q] -= k; left -= k; } }
    if (left) g.bag(s, b.item, left);
    b.n -= n;
    if (b.n <= 0) this.board = this.board.filter((x) => x !== b);
    this.mark();
    s.send({ type: 'toast', text: `🛒 Bought ${n} × ${itemName(b.item)} from ${b.name}` });
    if (seller) this.mail(seller, { from: 'The Notice Board', text: `${s.profile.name} bought ${n} × ${itemName(b.item)} from your notice for 🪙${cost}. The coins are in your purse.` });
    this.broadcastBoard();
  }
  boardCancel(s, { id }) {
    const b = this.board.find((x) => x.id === id && x.by === s.profile.id);
    if (!b) return;
    this.board = this.board.filter((x) => x !== b);
    (b.q || [b.n, 0, 0]).forEach((k, q) => { if (k) this.game.bag(s, b.item, k, q); });
    this.mark();
    s.send({ type: 'toast', text: `Took down your notice (${b.n} × ${itemName(b.item)} back in your bag)` });
    this.broadcastBoard();
  }
  broadcastBoard() { this.game.broadcast({ type: 'board', board: this.boardView() }); }

  // ---------- mail ----------
  // Put a letter in someone's mailbox (they may be offline). items: { item: n } (normal
  // quality) or q: [n0, n1, n2] with one item.
  mail(p, { from, text, items = null, q = null, coins = 0 }) {
    p.mail ||= [];
    p.mail.push({ id: `${this.game.now().toString(36)}${(this.nextMail++).toString(36)}`, from, text: clean(text, 400), items, q, coins, day: this.game.day(), read: false });
    if (p.mail.length > MAIL_MAX) {
      // Oldest letters with nothing attached go first.
      const i = p.mail.findIndex((m) => !m.items && !m.coins);
      p.mail.splice(i >= 0 ? i : 0, 1);
    }
    this.game.markProfile(p);
    const s = this.game.sessions.get(p.id);
    if (s) { this.sendMail(s); s.send({ type: 'toast', text: `📬 New mail from ${from}` }); }
  }
  sendMail(s) { s.send({ type: 'mail', mail: s.profile.mail || [] }); }
  mailSend(s, { to, text, item, n = 0, coins = 0 }) {
    if (!this.nearThing(s, 'mailbox')) return s.send({ type: 'error', msg: 'Send letters from a mailbox (the town square, City Hall, or anyone’s)' });
    const p = this.profileByName(to);
    if (!p) return s.send({ type: 'error', msg: `Nobody called “${clean(to, 30)}” lives here` });
    if (p.id === s.profile.id) return s.send({ type: 'error', msg: 'That’s you!' });
    coins = Math.max(0, Math.floor(coins) || 0);
    n = Math.max(0, Math.min(99, Math.floor(n) || 0));
    if (item && !(s.profile.inv[item] >= n && n > 0)) return s.send({ type: 'error', msg: `You don’t have ${n} × ${itemName(item)}` });
    if (s.profile.coins < coins + POSTAGE) return s.send({ type: 'error', msg: `Postage is 🪙${POSTAGE}` });
    text = clean(text, 400);
    if (!text && !item && !coins) return s.send({ type: 'error', msg: 'Write something (or attach a gift)' });
    const g = this.game;
    g.coins(s, -(coins + POSTAGE));
    g.city.onLand(POSTAGE, 'postage');
    let q = null;
    if (item) { q = g.bag(s, item, -n); g.count(s.profile, 'gift'); }
    this.mail(p, { from: s.profile.name, text, items: item ? { [item]: n } : null, q, coins });
    s.send({ type: 'toast', text: `📮 Sent to ${p.name}` });
  }
  mailTake(s, { id }) {
    const m = (s.profile.mail || []).find((x) => x.id === id);
    if (!m) return;
    m.read = true;
    const g = this.game;
    for (const [item, n] of Object.entries(m.items || {})) {
      if (m.q) m.q.forEach((k, q) => { if (k) g.bag(s, item, k, q); });
      else g.bag(s, item, n);
    }
    if (m.coins) g.coins(s, m.coins);
    m.items = null; m.q = null; m.coins = 0;
    g.markProfile(s.profile);
    this.sendMail(s);
  }
  mailRead(s, { id }) {
    const m = (s.profile.mail || []).find((x) => x.id === id);
    if (m && !m.read) { m.read = true; this.game.markProfile(s.profile); this.sendMail(s); }
  }
  mailDelete(s, { id }) {
    const p = s.profile;
    const m = (p.mail || []).find((x) => x.id === id);
    if (!m) return;
    if (m.items || m.coins) this.mailTake(s, { id });
    p.mail = p.mail.filter((x) => x.id !== id);
    this.game.markProfile(p);
    this.sendMail(s);
  }

  // ---------- co-op farms ----------
  // role: 'farm' (harvest, water, plant, animals, tractor) or 'build' (all of that and building).
  helperAdd(s, { plotId, name, role }) {
    const g = this.game;
    const plot = g.plots[plotId];
    if (!plot || plot.owner !== s.profile.id) return s.send({ type: 'error', msg: 'Only the owner can add helpers' });
    const p = this.profileByName(name);
    if (!p) return s.send({ type: 'error', msg: `Nobody called “${clean(name, 30)}” lives here` });
    if (p.id === s.profile.id) return;
    plot.helpers ||= {};
    if (Object.keys(plot.helpers).length >= 8 && !plot.helpers[p.id]) return s.send({ type: 'error', msg: 'Up to 8 helpers per plot' });
    plot.helpers[p.id] = { name: p.name, role: role === 'build' ? 'build' : 'farm' };
    g.plotChanged(plot);
    s.send({ type: 'toast', text: `🤝 ${p.name} can now ${role === 'build' ? 'farm and build' : 'farm'} on your plot` });
    this.mail(p, { from: s.profile.name, text: `I’ve made you a ${role === 'build' ? 'co-builder' : 'farmhand'} on ${plot.farm ? `${plot.farm} Farm` : 'my plot'}. Come by any time!` });
  }
  helperRemove(s, { plotId, id }) {
    const plot = this.game.plots[plotId];
    if (!plot || plot.owner !== s.profile.id || !plot.helpers?.[id]) return;
    delete plot.helpers[id];
    if (!Object.keys(plot.helpers).length) delete plot.helpers;
    this.game.plotChanged(plot);
  }

  // ---------- storage ----------
  // { plotId, level, lx, ly, item, n, put }: put into / take out of a chest or fridge.
  store(s, { plotId, level = 0, lx, ly, item, n = 1, put }) {
    const g = this.game;
    const plot = g.ownPlot(s, plotId, 'build');
    if (!plot || !Number.isInteger(lx) || !Number.isInteger(ly)) return;
    level = level === 1 ? 1 : 0;
    const hit = objAt(levelView(plot, level), lx, ly);
    const kind = hit && ITEMS[hit.obj.t]?.store;
    if (!kind) return;
    const [ax, ay] = hit.key.split(',').map(Number);
    const [w, h] = footprint(hit.obj.t, hit.obj.r || 0);
    const x0 = (plot.x + ax) * TILE, y0 = (plot.y + ay) * TILE;
    const dx = Math.max(x0 - s.x, 0, s.x - x0 - w * TILE), dy = Math.max(y0 - s.y, 0, s.y - y0 - h * TILE);
    if ((s.level || 0) !== level || Math.hypot(dx, dy) > TILE * 1.8) return s.send({ type: 'error', msg: `Walk up to the ${ITEMS[hit.obj.t].name.toLowerCase()} first` });
    const o = hit.obj;
    o.inv ||= {};
    n = Math.max(1, Math.min(999, Math.floor(n) || 1));
    if (put) {
      if (kind === 'food' && !FOODS[item] && !['produce', 'fish', 'animal', 'product'].includes(GOODS[item]?.kind)) return s.send({ type: 'error', msg: 'The fridge is for food' });
      n = Math.min(n, s.profile.inv[item] || 0);
      if (!n) return;
      const total = Object.values(o.inv).reduce((a, b) => a + b, 0);
      if (total + n > STORE_MAX) return s.send({ type: 'error', msg: `It’s full (${STORE_MAX} things)` });
      if (!o.inv[item] && Object.keys(o.inv).length >= STORE_KINDS) return s.send({ type: 'error', msg: 'No room for another kind of thing' });
      const took = g.bag(s, item, -n);
      took.forEach((k, q) => { if (k) changeInv(o, item, k, q); });
    } else {
      n = Math.min(n, o.inv[item] || 0);
      if (!n) return;
      const took = changeInv(o, item, -n, 0, true);
      took.forEach((k, q) => { if (k) g.bag(s, item, k, q); });
    }
    if (!Object.keys(o.inv).length) { delete o.inv; delete o.qual; }
    g.plotChanged(plot);
  }
  // Empty a storage object back into someone's bag (it's being removed).
  emptyInto(s, o) {
    for (const [item, n] of Object.entries(o.inv || {})) {
      const took = changeInv(o, item, -n, 0, true);
      took.forEach((k, q) => { if (k) this.game.bag(s, item, k, q); });
    }
    delete o.inv; delete o.qual;
  }
}

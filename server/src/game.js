import crypto from 'node:crypto';
import {
  generateWorld, canStand, inInterior, key, TILE, PLAYER_SPEED, WORLD_VERSION,
} from '../../shared/world.js';
import { ITEMS, CROPS, START_COINS, cropStage, placementError } from '../../shared/catalog.js';

const COLORS = ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c', '#3498db', '#9b59b6', '#ec6fa4'];
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);

// Authoritative game state. Transport-agnostic: each session just needs send(obj).
export class Game {
  constructor(saved = {}, now = () => Date.now()) {
    this.now = now;
    this.world = generateWorld();
    this.epoch = saved.epoch || this.now();
    this.profiles = saved.profiles || {}; // token -> profile
    this.plots = this.world.plots.map((p) => {
      const s = saved.plots?.[p.id];
      return { id: p.id, owner: s?.owner ?? null, ownerName: s?.ownerName ?? null, floor: s?.floor || {}, obj: s?.obj || {} };
    });
    this.sessions = new Map(); // player id -> session
    this.dirty = false;
  }

  snapshot() {
    return { version: WORLD_VERSION, epoch: this.epoch, profiles: this.profiles, plots: this.plots };
  }

  broadcast(msg, except) {
    const data = JSON.stringify(msg);
    for (const s of this.sessions.values()) if (s !== except) s.sendRaw(data);
  }

  publicPlayer(s) {
    const p = s.profile;
    return { id: p.id, name: p.name, color: p.color, x: s.x, y: s.y, dir: s.dir, moving: s.moving };
  }

  // Called with a fresh connection object: { send(obj), sendRaw(str), close() }.
  attach(conn) {
    const s = { conn, profile: null, sendRaw: (d) => conn.sendRaw(d), send: (m) => conn.sendRaw(JSON.stringify(m)), lastChat: 0 };
    return {
      onMessage: (raw) => {
        let msg;
        try { msg = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return; }
        if (!msg || typeof msg.type !== 'string') return;
        try { this.handle(s, msg); } catch (e) { console.error('handler error', e); }
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
      case 'harvest': return this.harvest(s, msg);
      case 'home': return this.home(s);
      case 'emote': return this.broadcast({ type: 'emote', id: s.profile.id, e: clean(msg.e, 4) });
    }
  }

  hello(s, msg) {
    if (s.profile) return;
    let token = typeof msg.token === 'string' && /^[a-f0-9]{32}$/.test(msg.token) ? msg.token : null;
    let profile = token && this.profiles[token];
    const name = clean(msg.name, 16) || 'Villager';
    const color = COLORS.includes(msg.color) ? msg.color : COLORS[Math.floor(Math.random() * COLORS.length)];
    if (!profile) {
      token = crypto.randomBytes(16).toString('hex');
      profile = { id: crypto.randomBytes(6).toString('hex'), name, color, coins: START_COINS, plotId: null, x: null, y: null };
      this.profiles[token] = profile;
    } else {
      profile.name = name;
      profile.color = color;
      if (profile.plotId != null) this.plots[profile.plotId].ownerName = name;
    }
    this.dirty = true;

    // Same account connecting twice: drop the older connection.
    const old = this.sessions.get(profile.id);
    if (old) { this.leave(old); old.conn.close(); }

    s.profile = profile;
    const ok = profile.x != null && canStand(this.world, this.plots, profile.x, profile.y);
    s.x = ok ? profile.x : this.world.spawn.x;
    s.y = ok ? profile.y : this.world.spawn.y;
    s.dir = 0; s.moving = false; s.lastMove = this.now();
    this.sessions.set(profile.id, s);

    s.send({
      type: 'welcome', token, worldVersion: WORLD_VERSION, serverTime: this.now(), epoch: this.epoch,
      you: { id: profile.id, name, color, coins: profile.coins, plotId: profile.plotId, x: s.x, y: s.y },
      players: [...this.sessions.values()].filter((o) => o !== s).map((o) => this.publicPlayer(o)),
      plots: this.plots,
    });
    this.broadcast({ type: 'join', player: this.publicPlayer(s) }, s);
    if (profile.plotId != null) this.broadcast({ type: 'plot', plot: this.plots[profile.plotId] });
  }

  leave(s) {
    if (!s.profile || this.sessions.get(s.profile.id) !== s) return;
    this.sessions.delete(s.profile.id);
    s.profile.x = s.x; s.profile.y = s.y;
    this.dirty = true;
    this.broadcast({ type: 'leave', id: s.profile.id });
  }

  move(s, { x, y, d, m }) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const now = this.now();
    const dt = Math.min(1, (now - s.lastMove) / 1000);
    const dist = Math.hypot(x - s.x, y - s.y);
    if (dist > PLAYER_SPEED * dt * 1.6 + 12 || !canStand(this.world, this.plots, x, y)) {
      s.send({ type: 'pos', x: s.x, y: s.y });
      return;
    }
    s.x = x; s.y = y; s.lastMove = now;
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

  ownPlot(s, plotId) {
    const plot = this.plots[plotId];
    if (!plot) return null;
    if (plot.owner !== s.profile.id) { s.send({ type: 'error', msg: "That isn't your plot" }); return null; }
    return plot;
  }

  coins(s, delta) {
    s.profile.coins += delta;
    s.send({ type: 'coins', coins: s.profile.coins });
    this.dirty = true;
  }

  plotChanged(plot) {
    this.dirty = true;
    this.broadcast({ type: 'plot', plot });
  }

  claim(s, { plotId }) {
    const plot = this.plots[plotId];
    if (!plot) return;
    if (s.profile.plotId != null) return s.send({ type: 'error', msg: 'You already own a plot' });
    if (plot.owner) return s.send({ type: 'error', msg: 'That plot is taken' });
    plot.owner = s.profile.id;
    plot.ownerName = s.profile.name;
    s.profile.plotId = plot.id;
    s.send({ type: 'claimed', plotId: plot.id });
    this.plotChanged(plot);
  }

  place(s, { plotId, lx, ly, item }) {
    const plot = this.ownPlot(s, plotId);
    if (!plot || !Number.isInteger(lx) || !Number.isInteger(ly) || !inInterior(lx, ly)) return;
    const def = ITEMS[item];
    const err = placementError(plot, lx, ly, item);
    if (err) return s.send({ type: 'error', msg: err });
    const k = key(lx, ly);
    const refund = def.layer === 'floor' && plot.floor[k] ? ITEMS[plot.floor[k]].price : 0;
    if (s.profile.coins + refund < def.price) return s.send({ type: 'error', msg: 'Not enough coins' });
    if (def.solid && this.someoneOn(plot, lx, ly)) return s.send({ type: 'error', msg: 'Someone is standing there' });
    if (def.layer === 'floor') plot.floor[k] = item;
    else plot.obj[k] = def.crop ? { t: item, p: this.now() } : { t: item };
    this.coins(s, refund - def.price);
    this.plotChanged(plot);
  }

  someoneOn(plot, lx, ly) {
    const p = this.world.plots[plot.id];
    const x0 = (p.x + lx) * TILE, y0 = (p.y + ly) * TILE;
    for (const o of this.sessions.values()) {
      if (o.x + 5 > x0 && o.x - 5 < x0 + TILE && o.y > y0 && o.y - 5 < y0 + TILE) return true;
    }
    return false;
  }

  remove(s, { plotId, lx, ly }) {
    const plot = this.ownPlot(s, plotId);
    if (!plot) return;
    const k = key(lx, ly);
    const o = plot.obj[k];
    if (o) {
      delete plot.obj[k];
      // Pulling up a crop refunds nothing; everything else sells back at full price.
      if (!ITEMS[o.t].crop) this.coins(s, ITEMS[o.t].price);
    } else if (plot.floor[k]) {
      this.coins(s, ITEMS[plot.floor[k]].price);
      delete plot.floor[k];
    } else return;
    this.plotChanged(plot);
  }

  // Harvest one tile ({lx, ly}) or, without coordinates, every ripe crop on the plot.
  harvest(s, { plotId, lx, ly }) {
    const plot = this.ownPlot(s, plotId);
    if (!plot) return;
    const now = this.now();
    const keys = Number.isInteger(lx) ? [key(lx, ly)] : Object.keys(plot.obj);
    let earned = 0, count = 0;
    for (const k of keys) {
      const o = plot.obj[k];
      if (!o || !ITEMS[o.t]?.crop || cropStage(o, now) < 3) continue;
      earned += CROPS[ITEMS[o.t].crop].sell;
      count++;
      delete plot.obj[k];
    }
    if (!count) return;
    this.coins(s, earned);
    s.send({ type: 'harvested', count, earned });
    this.plotChanged(plot);
  }

  home(s) {
    const id = s.profile.plotId;
    const p = id != null ? this.world.plots[id] : null;
    const target = p ? { x: (p.gate[1]) * TILE, y: (p.gateY + 1) * TILE + 12 } : this.world.spawn;
    s.x = target.x; s.y = target.y; s.lastMove = this.now();
    s.send({ type: 'pos', x: s.x, y: s.y });
  }

  tick() {
    if (!this.sessions.size) return;
    const p = [];
    for (const s of this.sessions.values()) p.push([s.profile.id, Math.round(s.x * 10) / 10, Math.round(s.y * 10) / 10, s.dir, s.moving ? 1 : 0]);
    this.broadcast({ type: 'state', t: this.now(), p });
  }
}

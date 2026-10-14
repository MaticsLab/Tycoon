// Village life: the places villagers go, their daily routines, a path finder that keeps
// them on public land, and a reader for how a player writes (so villagers can match it).
import { TILE, MAP_W, MAP_H, plotIdAtPixel } from './world.js';
import { canStand, crossesWall } from './plot.js';
import { MORE_PLACES, MORE_ACTS, MORE_VILLAGERS } from './villagers.js';

// Named spots, in tiles. `seat` = where they sit (a bench) if the activity sits.
// `inside` = indoors (they vanish from view while there, e.g. asleep at home).
export const PLACES = {
  rosa_shop:     { name: 'Rosa’s Market', x: 47.5, y: 45.7 },
  otto_shop:     { name: 'Otto’s Furniture', x: 71.5, y: 45.7 },
  rosa_home:     { name: 'home above the market', x: 47.5, y: 45.6, inside: true },
  otto_home:     { name: 'home behind the workshop', x: 71.5, y: 45.6, inside: true },
  juniper_home:  { name: 'the potting shed', x: 63, y: 58, inside: true },
  mabel_home:    { name: 'her flat by City Hall', x: 139.5, y: 33.6, inside: true },
  mabel_desk:    { name: 'the City Hall front desk', x: 139.5, y: 34.8 },
  fountain:      { name: 'the fountain', x: 60.5, y: 55.6 },
  fountain_n:    { name: 'the fountain', x: 59.5, y: 50.4 },
  square_w:      { name: 'the west side of the square', x: 47.5, y: 54.6 },
  square_e:      { name: 'the east side of the square', x: 71.5, y: 53.5 },
  flowerbeds:    { name: 'the square’s flower beds', x: 63, y: 58 },
  park_bench_w:  { name: 'a bench in Willow Park', x: 125, y: 51.6, seat: [125, 50.6] },
  park_bench_e:  { name: 'a bench in Willow Park', x: 153, y: 51.6, seat: [153, 50.6] },
  park_bench_n:  { name: 'a bench by the park gate', x: 132, y: 48.6, seat: [132, 47.6] },
  park_bench_s:  { name: 'a bench by the willows', x: 146, y: 48.6, seat: [146, 47.6] },
  gazebo:        { name: 'the gazebo', x: 149, y: 57.4 },
  park_lawn:     { name: 'the park lawn', x: 138.5, y: 57.6 },
  hall_bench:    { name: 'a bench outside City Hall', x: 127, y: 38.6, seat: [127, 37.6] },
  forecourt:     { name: 'the City Hall forecourt', x: 139.5, y: 37.5 },
  fair_stall:    { name: 'the fair stalls', x: 122.5, y: 69 },
  pumpkin_patch: { name: 'the pumpkin patch', x: 137.5, y: 67.5 },
  fair_field:    { name: 'the fair field', x: 145.5, y: 69.5 },
};

// What villagers can be doing. icon shows over their head; pose 'sit' sits them on the
// place's seat; hidden: they're indoors.
export const NPC_ACTS = {
  work:    { verb: 'working', icon: '' },
  stroll:  { verb: 'out for a stroll', icon: '' },
  lunch:   { verb: 'having lunch', icon: '🥪', pose: 'sit' },
  coffee:  { verb: 'having a coffee', icon: '☕', pose: 'sit' },
  read:    { verb: 'reading', icon: '📖', pose: 'sit' },
  nap:     { verb: 'dozing', icon: '💤', pose: 'sit' },
  garden:  { verb: 'gardening', icon: '🌷' },
  chat:    { verb: 'chatting', icon: '💬' },
  whittle: { verb: 'whittling', icon: '🪵', pose: 'sit' },
  stargaze:{ verb: 'stargazing', icon: '✨' },
  shop:    { verb: 'browsing the stalls', icon: '🛍️' },
  sleep:   { verb: 'asleep', icon: '', hidden: true },
};

// Default routines (in-game hours, 5 = 5 AM ... 28 = 4 AM). Each slot can list options;
// one is picked per day so days differ. `with` = who they meet for a chat.
export const ROUTINES = {
  rosa: [
    { at: 5, opts: [['rosa_home', 'sleep']] },
    { at: 6, opts: [['fountain', 'stroll'], ['flowerbeds', 'stroll']] },
    { at: 7, opts: [['rosa_shop', 'work']] },
    { at: 12, opts: [['park_bench_w', 'lunch'], ['fountain_n', 'lunch'], ['hall_bench', 'lunch']] },
    { at: 13.5, opts: [['rosa_shop', 'work']] },
    { at: 18, opts: [['otto_shop', 'chat', 'otto'], ['fair_stall', 'shop']] },
    { at: 19.5, opts: [['fountain', 'stroll'], ['park_lawn', 'stroll']] },
    { at: 21.5, opts: [['rosa_home', 'sleep']] },
  ],
  otto: [
    { at: 5, opts: [['otto_home', 'sleep']] },
    { at: 7, opts: [['otto_shop', 'work']] },
    { at: 12, opts: [['fountain', 'lunch'], ['park_bench_n', 'lunch']] },
    { at: 13, opts: [['otto_shop', 'work']] },
    { at: 17.5, opts: [['park_bench_s', 'whittle'], ['hall_bench', 'read']] },
    { at: 19.5, opts: [['rosa_shop', 'chat', 'rosa'], ['fountain', 'stroll']] },
    { at: 21, opts: [['otto_home', 'sleep']] },
  ],
  juniper: [
    { at: 5, opts: [['flowerbeds', 'garden'], ['square_w', 'garden']] },
    { at: 9, opts: [['park_lawn', 'garden'], ['pumpkin_patch', 'garden']] },
    { at: 12, opts: [['gazebo', 'lunch'], ['park_bench_e', 'lunch']] },
    { at: 13.5, opts: [['rosa_shop', 'chat', 'rosa'], ['mabel_desk', 'chat', 'mabel']] },
    { at: 15, opts: [['pumpkin_patch', 'garden'], ['square_e', 'garden'], ['fair_field', 'garden']] },
    { at: 18, opts: [['fountain', 'stroll'], ['park_lawn', 'stroll']] },
    { at: 20, opts: [['park_lawn', 'stargaze'], ['fair_field', 'stargaze']] },
    { at: 23, opts: [['juniper_home', 'sleep']] },
  ],
  mabel: [
    { at: 5, opts: [['mabel_home', 'sleep']] },
    { at: 6.5, opts: [['forecourt', 'coffee'], ['hall_bench', 'coffee']] },
    { at: 8, opts: [['mabel_desk', 'work']] },
    { at: 12, opts: [['hall_bench', 'lunch'], ['park_bench_n', 'lunch']] },
    { at: 13, opts: [['mabel_desk', 'work']] },
    { at: 17, opts: [['park_bench_w', 'read'], ['fountain', 'stroll'], ['fair_stall', 'shop']] },
    { at: 19, opts: [['otto_shop', 'chat', 'otto'], ['park_lawn', 'stroll']] },
    { at: 21.5, opts: [['mabel_home', 'sleep']] },
  ],
};

// Pick a concrete plan for one day: [{ at, place, act, with? }]. `rand` = seeded random.
export function planDay(npc, rand = Math.random) {
  return (ROUTINES[npc] || []).map((slot) => {
    const [place, act, withNpc] = slot.opts[Math.floor(rand() * slot.opts.length)];
    return { at: slot.at, place, act, ...(withNpc ? { with: withNpc } : {}) };
  });
}

// The plan step for an hour of the village day (hours run 5..29).
export function stepAt(plan, hours) {
  const h = hours < 5 ? hours + 24 : hours;
  let cur = plan[plan.length - 1];
  for (const p of plan) if (p.at <= h) cur = p;
  return cur;
}

// ---------- path finding ----------
// A* over tiles that are walkable public land (not inside anyone's plot). Returns a
// list of world-pixel waypoints (tile centres) ending at the target, or null.
export function findPath(world, plots, fx, fy, tx, ty, maxNodes = 20000) {
  const sx = Math.floor(fx / TILE), sy = Math.floor(fy / TILE), gx = Math.floor(tx / TILE), gy = Math.floor(ty / TILE);
  const base = walkable(world, plots);
  const walk = (x, y) => (x === gx && y === gy) || (x === sx && y === sy) || base(x, y);
  const key = (x, y) => y * MAP_W + x;
  const open = new Heap(), g = new Map([[key(sx, sy), 0]]), from = new Map(), done = new Set();
  open.push([0, sx, sy]);
  const h = (x, y) => Math.abs(x - gx) + Math.abs(y - gy);
  let n = 0;
  while (open.size && n++ < maxNodes) {
    const [, x, y] = open.pop();
    if (done.has(key(x, y))) continue;
    done.add(key(x, y));
    if (x === gx && y === gy) {
      const pts = [];
      let k = key(x, y);
      while (k !== key(sx, sy)) { pts.push([(k % MAP_W + 0.5) * TILE, (Math.floor(k / MAP_W) + 0.5) * TILE]); k = from.get(k); }
      pts.reverse();
      pts.push([tx, ty]);
      return smooth(base, fx, fy, pts, world, plots);
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!walk(nx, ny)) continue;
      // In and out of the village shops: only through the doors.
      if ((inPlot(world, x, y) || inPlot(world, nx, ny)) && crossesWall(world, plots, (x + 0.5) * TILE, (y + 0.5) * TILE, (nx + 0.5) * TILE, (ny + 0.5) * TILE)) continue;
      const k = key(nx, ny), ng = g.get(key(x, y)) + 1;
      if (ng < (g.get(k) ?? Infinity)) { g.set(k, ng); from.set(k, key(x, y)); open.push([ng + h(nx, ny), nx, ny]); }
    }
  }
  return null;
}

// A tiny binary min-heap on item[0].
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(v) {
    const a = this.a; a.push(v);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

// Any plot on or next to this tile (a short step can clip a wall's corner from outside).
const nearPlot = (world, x, y) => { for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (inPlot(world, x + i, y + j)) return true; return false; };
const inPlot = (world, x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H && world.plotAt[y * MAP_W + x] >= 0;

// Is a tile walkable public land? Cached per map version (plots and roads), since
// checking collision is the slow part of path finding.
function walkable(world, plots) {
  const v = `${world.plotsVersion || 0}|${world.roadsVersion || 0}|${world.natureVersion || 0}`;
  let c = world.walkCache;
  if (!c || c.v !== v) c = world.walkCache = { v, grid: new Int8Array(MAP_W * MAP_H).fill(-1) };
  return (x, y) => {
    if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return false;
    const k = y * MAP_W + x;
    if (c.grid[k] < 0) {
      const px = (x + 0.5) * TILE, py = (y + 0.5) * TILE;
      const id = plotIdAtPixel(world, px, py);
      c.grid[k] = (id < 0 || plots[id]?.town) && canStand(world, plots, px, py + 4) ? 1 : 0;
    }
    return c.grid[k] === 1;
  };
}

// Drop waypoints that can be skipped in a straight line, so walking looks natural.
function smooth(walk, fx, fy, pts, world, plots) {
  const out = [];
  let ax = fx, ay = fy, i = 0;
  const clear = (x0, y0, x1, y1) => {
    const d = Math.hypot(x1 - x0, y1 - y0), steps = Math.ceil(d / 6);
    let px = x0, py = y0;
    for (let s = 1; s <= steps; s++) {
      const x = x0 + ((x1 - x0) * s) / steps, y = y0 + ((y1 - y0) * s) / steps;
      if (!walk(Math.floor(x / TILE), Math.floor(y / TILE))) return false;
      if (nearPlot(world, Math.floor(x / TILE), Math.floor(y / TILE)) && crossesWall(world, plots, px, py, x, y)) return false;
      px = x; py = y;
    }
    return true;
  };
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && !clear(ax, ay, pts[j][0], pts[j][1])) j--;
    out.push(pts[j]);
    [ax, ay] = pts[j];
    i = j + 1;
  }
  return out;
}

// ---------- reading a player's tone ----------
// A rough read of how someone writes: each value 0..1.
export function readTone(text) {
  const t = String(text || '');
  const words = t.trim().split(/\s+/).filter(Boolean);
  const lower = t.toLowerCase();
  const emoji = (t.match(/\p{Extended_Pictographic}/gu) || []).length;
  const slang = (lower.match(/\b(lol|lmao|omg|bruh|bro|dude|yo|ya|u|ur|gonna|wanna|kinda|tbh|ngl|idk|fr|lit|vibe|vibes|sus|yeet|nah|yep|yup|hey+|heyy+|sup)\b/g) || []).length;
  const polite = (lower.match(/\b(please|thank you|thanks|kindly|would you|could you|pardon|excuse me|good (morning|afternoon|evening)|madam|sir)\b/g) || []).length;
  const laugh = (lower.match(/\b(ha(ha)+|he(he)+|lol|lmao|rofl)\b|😂|🤣|😆/g) || []).length;
  const caps = (t.match(/\b[A-Z]{3,}\b/g) || []).length;
  const bangs = (t.match(/!/g) || []).length;
  const proper = /^[A-Z]/.test(t.trim()) && /[.?!]$/.test(t.trim()) ? 1 : 0;
  const clamp1 = (v) => Math.max(0, Math.min(1, v));
  return {
    casual: clamp1(slang * 0.35 + (t === lower && words.length > 1 ? 0.35 : 0) + (proper ? -0.2 : 0.1)),
    formal: clamp1(polite * 0.4 + proper * 0.4 + (words.length > 12 ? 0.15 : 0) - slang * 0.3),
    playful: clamp1(laugh * 0.45 + emoji * 0.2 + (/\?!|!\?|~/.test(t) ? 0.2 : 0) + (/\b(jk|kidding|joke)\b/.test(lower) ? 0.4 : 0)),
    excited: clamp1(bangs * 0.2 + caps * 0.3),
    emoji: clamp1(emoji * 0.4),
    brief: clamp1(words.length <= 3 ? 0.8 : words.length <= 7 ? 0.4 : 0),
  };
}

// Blend a new reading into a running average (so one message doesn't flip it).
export function blendTone(prev, next, k = 0.35) {
  if (!prev) return next;
  const out = {};
  for (const key of Object.keys(next)) out[key] = (prev[key] ?? next[key]) * (1 - k) + next[key] * k;
  return out;
}

// Plain-English guidance for the AI: how to talk back to this person.
export function toneGuide(t) {
  if (!t) return '';
  const tips = [];
  if (t.formal > 0.5) tips.push('they write politely and properly, so be a touch more polished (still yourself)');
  else if (t.casual > 0.45) tips.push('they write casually with slang, so loosen up and talk the same way');
  if (t.playful > 0.35) tips.push('they joke around, so be playful and banter back');
  if (t.excited > 0.35) tips.push('they’re excitable, so match their energy');
  if (t.emoji > 0.3) tips.push('they use emoji, so drop one in now and then');
  if (t.brief > 0.55) tips.push('they keep it short, so keep replies short and snappy');
  return tips.length ? `How ${'they'} talk: ${tips.join('; ')}.` : '';
}

// The rest of the townsfolk's places, doings and days (shared/villagers.js).
Object.assign(PLACES, MORE_PLACES);
Object.assign(NPC_ACTS, MORE_ACTS);
for (const [id, v] of Object.entries(MORE_VILLAGERS)) ROUTINES[id] = v.routine;

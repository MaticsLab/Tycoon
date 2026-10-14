// The village map: a small north-up minimap in the corner and a full-size map (M).
// The ground, roads, plots and houses are painted once into a cached layer and redrawn
// only when they change; people, villagers and pets are drawn on top every few frames.
import { T, MAP_W, MAP_H, TILE, PUBLIC_AREAS } from '@shared/world.js';
import { ITEMS } from '@shared/catalog.js';

const TILE_COL = {
  [T.GRASS]: '#5aa63b', [T.TALLGRASS]: '#56a038', [T.FLOWERS]: '#62ad42', [T.LAWN]: '#6cba48',
  [T.PATH]: '#c99559', [T.WATER]: '#4aa2d6', [T.SAND]: '#e7cb8c', [T.TREE]: '#2c6029',
  [T.PLAZA]: '#c2baa9', [T.FOUNTAIN]: '#8cd0ec', [T.ROCK]: '#8d939b', [T.SHOP]: '#a3463a',
  [T.FIELD]: '#704626', [T.HALL]: '#3f5f86', [T.CORN]: '#c9a24c', [T.FENCE]: '#5aa63b', [T.GATE]: '#c99559',
  [T.STEPS]: '#bcb4a5', [T.BRIDGE]: '#9b6a3a',
};
const AREA_ICON = { 'Town Square': '⛲', 'City Hall': '🏛️', 'Willow Park': '🌳', 'Harvest Fair': '🎃', 'Seashell Beach': '🏖️', 'Pine Hollow Campsite': '⛺', 'Eagle Lookout': '🔭', 'The Highlands': '⛰️', 'Duck Pond': '🦆', 'Standing Stones': '🗿', 'Riverside Green': '🌿', 'Gull Point': '🪨' };

// Paint the ground and plots into a canvas at `s` pixels per tile.
function paintStatic(world, plots, myPlot, s) {
  const cv = document.createElement('canvas');
  cv.width = MAP_W * s; cv.height = MAP_H * s;
  const g = cv.getContext('2d');
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const t = world.tiles[y * MAP_W + x];
    g.fillStyle = TILE_COL[t] || '#5aa63b';
    g.fillRect(x * s, y * s, s, s);
    // High ground is lighter, with a dark line along the foot of each cliff.
    const e = world.elev?.[y * MAP_W + x];
    if (e) { g.fillStyle = `rgba(255,245,210,${0.12 * e})`; g.fillRect(x * s, y * s, s, s); }
    if (world.elev && y + 1 < MAP_H && world.elev[(y + 1) * MAP_W + x] < e && t !== T.STEPS) { g.fillStyle = 'rgba(40,30,20,.55)'; g.fillRect(x * s, (y + 1) * s - Math.max(1, s / 3), s, Math.max(1, s / 3)); }
  }
  // Houses: floors, then roofs on top.
  for (const p of Object.values(plots)) {
    for (const [k, f] of Object.entries(p.floor || {})) {
      const [lx, ly] = k.split(',').map(Number);
      g.fillStyle = f === 'soil' ? '#6b4426' : f === 'floor_stone' ? '#b6af9f' : '#c99363';
      g.fillRect((p.x + lx) * s, (p.y + ly) * s, s, s);
    }
    for (const k of Object.keys(p.walls || {})) {
      const [l, d, ex, ey] = k.split(':');
      if (l !== '0') continue;
      g.fillStyle = '#5a3a22';
      if (d === 'h') g.fillRect((p.x + +ex) * s, (p.y + +ey) * s - Math.max(1, s / 4) / 2, s, Math.max(1, s / 4));
      else g.fillRect((p.x + +ex) * s - Math.max(1, s / 4) / 2, (p.y + +ey) * s, Math.max(1, s / 4), s);
    }
    for (const rf of p.roofs || []) {
      g.fillStyle = ITEMS[rf.m]?.color || '#b2412f';
      g.fillRect((p.x + rf.x) * s, (p.y + rf.y) * s, rf.w * s, rf.h * s);
      g.fillStyle = 'rgba(0,0,0,.18)';
      g.fillRect((p.x + rf.x) * s, (p.y + rf.y + rf.h / 2) * s, rf.w * s, (rf.h / 2) * s);
    }
  }
  // Plot outlines: yours in gold, owned ones white, land for sale dashed orange.
  g.lineWidth = Math.max(1, s / 2.5);
  for (const p of Object.values(plots)) {
    const mine = p.id === myPlot;
    g.setLineDash(p.owner ? [] : [s * 1.5, s]);
    g.strokeStyle = mine ? '#ffe36e' : p.owner ? 'rgba(255,255,255,.75)' : 'rgba(255,170,80,.85)';
    g.strokeRect(p.x * s + 0.5, p.y * s + 0.5, p.w * s - 1, p.h * s - 1);
  }
  g.setLineDash([]);
  return cv;
}

export class Minimap {
  constructor(small, big) {
    this.small = small;
    this.big = big;
    this.sig = '';
    this.layers = {};
  }

  // Rebuild the cached ground layers when roads or plots change.
  update(world, plots, myPlot) {
    const sig = `${world.roadsVersion}|${world.natureVersion || 0}|${myPlot}|${Object.values(plots).map((p) => `${p.id}.${p.rev ?? 0}.${p.x}.${p.y}.${p.w}.${p.h}.${p.owner}`).join(',')}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.layers = { small: paintStatic(world, plots, myPlot, 4), big: paintStatic(world, plots, myPlot, 6) };
  }

  // people: [{ x, y (world px), dir, kind: 'me'|'player'|'npc'|'pet', name }]
  draw(people, labels) {
    this.follow(this.small, this.layers.small, people, 4);
    if (!this.big.closest('[hidden]')) this.render(this.big, this.layers.big, people, 6, true, labels);
  }

  // The corner map: a square window that follows you around (you stay in the middle).
  follow(cv, layer, people, s) {
    if (!layer) return;
    const N = 128; // canvas pixels: 32 tiles across
    if (cv.width !== N) { cv.width = N; cv.height = N; }
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    const me = people.find((q) => q.kind === 'me');
    const ox = Math.round((me ? (me.x / TILE) * s : layer.width / 2) - N / 2), oy = Math.round((me ? (me.y / TILE) * s : layer.height / 2) - N / 2);
    g.fillStyle = '#244a22'; g.fillRect(0, 0, N, N); // the forest beyond the edge
    g.drawImage(layer, -ox, -oy);
    g.save(); g.translate(-ox, -oy);
    for (const p of people.filter((q) => q.kind !== 'me')) dot(g, p, s * 0.6, false, s);
    if (me) dot(g, me, s * 0.6, false, s);
    g.restore();
  }

  render(cv, layer, people, s, detailed, labels) {
    if (!layer) return;
    if (cv.width !== layer.width) { cv.width = layer.width; cv.height = layer.height; }
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(layer, 0, 0);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const p of people.filter((q) => q.kind !== 'me')) dot(g, p, s, detailed);
    const me = people.find((q) => q.kind === 'me');
    if (me) dot(g, me, s, detailed);
    // Place names go on top of everything so villagers never hide them.
    if (detailed) {
      g.textAlign = 'center'; g.textBaseline = 'middle';
      for (const a of PUBLIC_AREAS) {
        const cx = (a.x + a.w / 2) * s, cy = (a.y + a.h / 2) * s;
        g.font = `${s * 3}px sans-serif`;
        g.fillText(AREA_ICON[a.name] || '★', cx, cy - s * 2);
        label(g, a.name, cx, cy + s * 1.6, s * 1.9, '#fff');
      }
      for (const l of labels) label(g, l.text, l.x * s, l.y * s, s * 1.5, l.mine ? '#ffe36e' : '#f4efe2');
    }
  }
}

function label(g, text, x, y, size, col) {
  g.font = `bold ${size}px sans-serif`;
  g.lineWidth = Math.max(2, size / 4);
  g.strokeStyle = 'rgba(20,14,8,.85)';
  g.strokeText(text, x, y);
  g.fillStyle = col;
  g.fillText(text, x, y);
}

const DOT = { me: '#ffe36e', player: '#ffffff', npc: '#7dff8a', pet: '#ffb26b' };
function dot(g, p, s, detailed, scale = s) {
  const x = (p.x / TILE) * scale, y = (p.y / TILE) * scale;
  const r = p.kind === 'pet' ? s * 0.7 : p.kind === 'me' ? s * 1.6 : s * 1.2;
  if (p.kind === 'me') {
    // An arrow pointing the way you face.
    const [dx, dy] = [[0, 1], [0, -1], [-1, 0], [1, 0]][p.dir || 0];
    g.fillStyle = DOT.me; g.strokeStyle = '#3a2716'; g.lineWidth = Math.max(1, s / 2);
    g.beginPath();
    g.moveTo(x + dx * r * 1.4, y + dy * r * 1.4);
    g.lineTo(x - dy * r - dx * r * 0.6, y + dx * r - dy * r * 0.6);
    g.lineTo(x + dy * r - dx * r * 0.6, y - dx * r - dy * r * 0.6);
    g.closePath(); g.fill(); g.stroke();
  } else {
    g.fillStyle = DOT[p.kind]; g.strokeStyle = 'rgba(20,14,8,.8)'; g.lineWidth = Math.max(1, s / 3);
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.stroke();
  }
  if (detailed && p.name && p.kind !== 'pet') label(g, p.name, x, y - r - s * 1.3, s * 1.5, DOT[p.kind]);
}

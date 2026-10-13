// Wild trees and rocks, planted trees, and the weather. Shared by server and client.
//   The generated map has groves of trees and rocky outcrops on open land. Chop trees
//   with an axe (wood, sometimes a sapling) and break rocks with a pickaxe (stone).
//   They grow back over time, and new ones appear when the village runs low.
//   nature state: { cut: { tileIndex: when }, grown: { tileIndex: 'tree' | 'rock' } }.
//   Saplings planted on your plot grow into trees you can chop (and apple trees fruit).
import { ITEMS } from './catalog.js';
import { T, MAP_W, MAP_H, LAND, DAY_MS } from './world.js';
import { seasonOf } from './farm.js';

export const HITS = { tree: 3, rock: 4 };
export const TOOL_FOR = { tree: 'axe', rock: 'pickaxe' };
export const TREES = {
  oak: { growMs: 2 * DAY_MS, wood: [4, 6] },
  apple: { growMs: 3 * DAY_MS, wood: [3, 4], fruit: 'apple', fruitMs: DAY_MS, fruitN: 3 },
};
export const treeOf = (o) => TREES[ITEMS[o?.t]?.tree];
// 0 sapling, 1 young tree, 2 grown.
export function treeStage(o, now) {
  const d = treeOf(o);
  if (!d) return 0;
  const f = (now - (o.p || 0)) / d.growMs;
  return f >= 1 ? 2 : f >= 0.4 ? 1 : 0;
}
export function fruitReady(o, now) {
  const d = treeOf(o);
  if (!d?.fruit || treeStage(o, now) < 2) return false;
  return now - Math.max(o.f || 0, (o.p || 0) + d.growMs) >= d.fruitMs;
}

// Apply the saved changes to the generated map (call after applyRoads).
export function applyNature(world, nat) {
  for (const k of Object.keys(nat?.cut || {})) {
    const i = +k, t = world.tiles[i];
    if (t === T.TREE || t === T.ROCK) world.tiles[i] = T.GRASS;
  }
  for (const [k, kind] of Object.entries(nat?.grown || {})) {
    const i = +k;
    if (world.tiles[i] !== T.PATH) world.tiles[i] = kind === 'rock' ? T.ROCK : T.TREE;
  }
  world.natureVersion = (world.natureVersion || 0) + 1;
}
// Wild trees and rocks can be cleared anywhere inside the forest border.
export const inLand = (tx, ty) => tx >= LAND.x && ty >= LAND.y && tx < LAND.x + LAND.w && ty < LAND.y + LAND.h;
export const wildKind = (world, tx, ty) => {
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H || !inLand(tx, ty)) return null;
  const t = world.tiles[ty * MAP_W + tx];
  return t === T.TREE ? 'tree' : t === T.ROCK ? 'rock' : null;
};

// ---------- weather ----------
// One forecast per day for everyone: rain or snow for part of the day, depending on the season.
const hash = (n) => { let h = (n * 2654435761) >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13; return (h >>> 0) / 4294967296; };
export function forecast(day) {
  const s = seasonOf(day).id, r = hash(day * 13 + 7);
  const kind = s === 'winter' ? (r < 0.45 ? 'snow' : 'clear') : s === 'summer' ? (r < 0.18 ? 'rain' : r < 0.23 ? 'storm' : 'clear') : r < 0.32 ? 'rain' : 'clear';
  if (kind === 'clear') return { kind };
  const from = 6 + Math.floor(hash(day * 31 + 1) * 12), len = 3 + Math.floor(hash(day * 17 + 5) * 7);
  return { kind, from, to: from + len };
}
// What's falling right now: 'rain' | 'storm' | 'snow' | null. hours: 0..24 (5 AM day start).
export function weatherAt(day, hours) {
  const f = forecast(day);
  if (f.kind === 'clear') return null;
  const h = hours < 5 ? hours + 24 : hours;
  return h >= f.from && h < f.to ? f.kind : null;
}

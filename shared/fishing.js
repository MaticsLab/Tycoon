// Fishing: stand at the water's edge with a rod, cast, wait for a bite, then reel in
// quickly. What bites depends on the water (the square's pond, the park lake), the
// season and the time of day. A fast reel can land a better-quality fish.
import { T, MAP_W, MAP_H, TILE, SQUARE, PARK } from './world.js';
import { seasonOf } from './farm.js';

export const FISH = {
  sunfish:  { where: ['pond', 'lake'], seasons: ['spring', 'summer', 'fall'], w: 10 },
  carp:     { where: ['pond', 'lake'], seasons: ['spring', 'summer', 'fall', 'winter'], w: 8 },
  bass:     { where: ['lake'], seasons: ['spring', 'summer', 'fall'], w: 6 },
  trout:    { where: ['lake'], seasons: ['spring', 'fall'], w: 5 },
  catfish:  { where: ['pond', 'lake'], seasons: ['spring', 'summer', 'fall'], w: 4, night: true },
  pike:     { where: ['lake'], seasons: ['winter', 'fall'], w: 4 },
  koi:      { where: ['pond'], seasons: ['summer', 'spring'], w: 1.2 },
  whiskers: { where: ['lake'], seasons: ['fall'], w: 0.15, night: true, legend: true },
};
export const BITE_MIN = 1800, BITE_MAX = 6500; // ms after casting
export const REEL_WINDOW = 1400;               // ms to reel in after the bite

// The water next to (x, y) world px, or null: { tx, ty, where }.
export function waterNear(world, x, y) {
  const cx = Math.floor(x / TILE), cy = Math.floor(y / TILE);
  let best = null, bd = Infinity;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const tx = cx + dx, ty = cy + dy;
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H || world.tiles[ty * MAP_W + tx] !== T.WATER) continue;
    const d = Math.hypot((tx + 0.5) * TILE - x, (ty + 0.5) * TILE - y);
    if (d < bd && d < TILE * 2.2) { bd = d; best = { tx, ty }; }
  }
  if (!best) return null;
  const inA = (A) => best.tx >= A.x && best.ty >= A.y && best.tx < A.x + A.w && best.ty < A.y + A.h;
  best.where = inA(PARK) ? 'lake' : inA(SQUARE) ? 'pond' : 'lake';
  return best;
}

// What bites: rand() 0..1.
export function rollFish(where, day, hours, rand = Math.random) {
  const season = seasonOf(day).id;
  const night = hours >= 20 || hours < 5;
  const pool = Object.entries(FISH).filter(([, f]) => f.where.includes(where) && f.seasons.includes(season) && (!f.night || night));
  const total = pool.reduce((a, [, f]) => a + f.w, 0);
  let r = rand() * total;
  for (const [id, f] of pool) { r -= f.w; if (r <= 0) return id; }
  return pool[0]?.[0] || 'carp';
}

// How fast you reeled (ms after the bite) -> quality 0..2.
export const reelQuality = (ms, rand = Math.random) => (ms < 350 ? (rand() < 0.5 ? 2 : 1) : ms < 700 ? (rand() < 0.4 ? 1 : 0) : 0);

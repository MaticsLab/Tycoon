// World layout, tile types and clock. Shared by server and client so both sides
// agree on the map without sending it over the wire.
//
// The village is a grid of 4-tile-wide dirt roads. Between them lies open land that
// players claim as plots (rectangles owned and reshaped at runtime, see shared/plot.js),
// plus the public places nobody can own: the town square, City Hall, the park and the
// harvest fair. Roads are public too, even where a plot covers them, and players can
// reroute them through their own land (the live road layout is generated here and then
// edited at runtime with applyRoads).

export const WORLD_VERSION = 4;
export const TILE = 16;
export const MAP_W = 168;
export const MAP_H = 88;
export const PLOT_W = 24; // default plot size
export const PLOT_H = 16;
export const PLAYER_SPEED = 76; // world px per second

export const T = {
  GRASS: 0, PATH: 1, WATER: 2, TREE: 3, LAWN: 4, FENCE: 5, GATE: 6,
  FLOWERS: 7, SAND: 8, PLAZA: 9, FOUNTAIN: 10, ROCK: 11, TALLGRASS: 12, SHOP: 13,
  FIELD: 14, HALL: 15, CORN: 16,
};
export const SOLID_TILES = new Set([T.WATER, T.TREE, T.FENCE, T.FOUNTAIN, T.ROCK, T.SHOP, T.HALL, T.CORN]);

// Everything inside the forest border.
export const LAND = { x: 3, y: 3, w: MAP_W - 6, h: MAP_H - 6 };
export const ROAD_W = 4;
// Horizontal roads (y of their top row) and vertical roads (x of their left column).
export const ROAD_ROWS = [21, 41, 61, 81];
export const ROAD_COLS = [3, 58, 113, 161];

export const SQUARE = { x: 44, y: 45, w: 32, h: 16, name: 'Town Square' };
export const CIVIC = { x: 117, y: 25, w: 44, h: 16, name: 'City Hall' };
export const PARK = { x: 117, y: 45, w: 44, h: 16, name: 'Willow Park' };
export const FAIR = { x: 117, y: 65, w: 44, h: 16, name: 'Harvest Fair' };
export const PUBLIC_AREAS = [SQUARE, CIVIC, PARK, FAIR];
export const HALL = { x: 132, y: 26, w: 14, h: 7, name: 'City Hall' };
export const FOUNTAIN = { x: 58, y: 51, cx: 60, cz: 53 }; // 4x4 tiles
export const PLAZA_LAMPS = [[57.5, 50.5], [62.5, 50.5], [57.5, 55.5], [62.5, 55.5]];

// Shop buildings on the north side of the plaza. The keeper stands at the door.
export const SHOPS = [
  { id: 'rosa', name: "Rosa's Market", x: 53, y: 45, w: 5, h: 3, roof: '#c0392b', awning: ['#e74c3c', '#fdf2e0'] },
  { id: 'otto', name: "Otto's Furniture", x: 63, y: 45, w: 5, h: 3, roof: '#2c5d8a', awning: ['#3d7cb8', '#fdf2e0'] },
];

// Plots that exist when a world is first created (the rest of the land is open).
export const STARTER_PLOTS = [
  [7, 4, 24, 17], [33, 4, 24, 17], [62, 4, 24, 17], [88, 4, 24, 17], [119, 4, 19, 17], [140, 4, 20, 17],
  [7, 25], [33, 25], [62, 25], [88, 25],
  [7, 45], [88, 45],
  [7, 65], [33, 65], [62, 65], [88, 65],
].map(([x, y, w = PLOT_W, h = PLOT_H]) => ({ x, y, w, h }));

// Seasons follow the real calendar: fall colours from September to November, and
// Halloween decorations through October.
export function seasonOf(date = new Date()) {
  const m = date.getUTCMonth(), d = date.getUTCDate();
  return { fall: m >= 8 && m <= 10, halloween: m === 9 || (m === 10 && d <= 1) };
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function tileHash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const inRect = (r, x, y) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
export const publicAreaAt = (tx, ty) => PUBLIC_AREAS.find((a) => inRect(a, tx, ty)) || null;

// Public props: [item, x, y, r?]. Solid ones block their footprint tiles.
function publicDecor(season) {
  const out = [];
  const add = (t, x, y, r = 0) => out.push({ t, x, y, r });
  // City Hall forecourt
  for (const x of [128, 149]) add('flagpole', x, 34);
  for (const x of [123, 155]) for (const y of [35, 39]) add('lamppost', x, y);
  add('noticeboard', 136, 35); add('ballotbox', 141, 35);
  for (const x of [126, 152]) add('bench', x, 37);
  // Willow Park
  for (const [x, y] of [[121, 47], [121, 58], [156, 47], [156, 58], [138, 46], [138, 59]]) add('lamppost', x, y);
  for (const [x, y, r] of [[124, 50, 0], [124, 55, 0], [152, 50, 0], [152, 55, 0], [131, 47, 0], [145, 47, 0]]) add('bench', x, y, r);
  add('gazebo', 147, 52);
  // Harvest Fair (fall stand all year, scarecrows in the field)
  add('stall', 120, 66); add('stall', 127, 66);
  for (const [x, y] of [[133, 71], [140, 76]]) add('scarecrow', x, y);
  for (const [x, y] of [[121, 79], [158, 66]]) add('lamppost', x, y);
  // Pumpkins ripen in the patch all fall.
  if (season.fall) {
    for (let y = FAIR.y + 3; y < FAIR.y + 13; y += 2) for (let x = FAIR.x + 14; x < FAIR.x + 30; x += 2) {
      if (tileHash(x, y) < 0.62 && !(x === 133 && y === 71) && !(x === 140 && y === 76)) add('pumpkin_deco', x + (y % 4 === 0 ? 1 : 0), y);
    }
  }
  if (!season.halloween) return out;
  // Halloween: jack-o'-lanterns, hay bales, cauldrons and a little graveyard.
  for (const [x, y] of [[50, 46], [69, 46], [56, 49], [63, 49], [55, 58], [65, 58], [52, 59], [67, 59], [59, 60], [60, 60]]) add('jackolantern', x, y);
  for (const [x, y] of [[57, 46], [61, 46], [45, 46], [72, 59], [71, 46]]) add('pumpkin_deco', x, y);
  for (const [x, y] of [[54, 59], [64, 59]]) add('haybale', x, y);
  add('cauldron', 66, 52); add('cauldron', 53, 52);
  for (const [x, y] of [[46, 48], [74, 56]]) add('cornstalks', x, y);
  add('scarecrow', 70, 58);
  for (const [x, y] of [[129, 36], [146, 36], [133, 39], [144, 39]]) add('jackolantern', x, y);
  for (const [x, y] of [[125, 34], [153, 34]]) add('cornstalks', x, y);
  // graveyard in the fair's south-east corner
  for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) add('gravestone', 149 + i * 3, 74 + j * 3);
  for (let x = 147; x < 161; x++) { add('ironfence', x, 72); }
  add('cauldron', 154, 79);
  for (const [x, y] of [[147, 79], [160, 79], [123, 72], [123, 77], [130, 79]]) add('jackolantern', x, y);
  for (const [x, y] of [[121, 70], [127, 70], [121, 74]]) add('haybale', x, y);
  return out;
}

export function generateWorld(seed = 20261012, { date } = {}) {
  const rand = mulberry32(seed);
  const season = seasonOf(date);
  const tiles = new Uint8Array(MAP_W * MAP_H);
  const inb = (x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;
  const set = (x, y, t) => { if (inb(x, y)) tiles[y * MAP_W + x] = t; };
  const get = (x, y) => (inb(x, y) ? tiles[y * MAP_W + x] : T.TREE);
  const fill = (x0, y0, w, h, t) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, t); };

  // Forest border.
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    if (x < LAND.x || y < LAND.y || x >= LAND.x + LAND.w || y >= LAND.y + LAND.h) set(x, y, T.TREE);
  }

  // Roads. The avenue (x 58) stops at the town square, which is walkable plaza.
  const top = ROAD_ROWS[0], bottom = ROAD_ROWS[ROAD_ROWS.length - 1] + ROAD_W;
  for (const ry of ROAD_ROWS) fill(LAND.x, ry, LAND.w, ROAD_W, T.PATH);
  for (const rx of ROAD_COLS) fill(rx, top, ROAD_W, bottom - top, T.PATH);
  fill(58, SQUARE.y, ROAD_W, SQUARE.h, T.GRASS);

  // Town square: pond on the left, fountain plaza in the middle, garden on the right.
  const S = SQUARE;
  fill(S.x, S.y, S.w, S.h, T.PLAZA);
  const pond = { cx: 48.5, cy: 53.5, rx: 4.4, ry: 5.2 };
  for (let y = S.y; y < S.y + S.h; y++) for (let x = S.x; x < S.x + 10; x++) {
    const d = ((x + 0.5 - pond.cx) / pond.rx) ** 2 + ((y + 0.5 - pond.cy) / pond.ry) ** 2;
    if (d < 0.75) set(x, y, T.WATER);
    else if (d < 1.25) set(x, y, T.SAND);
    else set(x, y, T.GRASS);
  }
  fill(FOUNTAIN.x, FOUNTAIN.y, 4, 4, T.FOUNTAIN);
  for (let y = S.y; y < S.y + S.h; y++) for (let x = 69; x < S.x + S.w; x++) set(x, y, (x + y) % 3 === 0 ? T.FLOWERS : T.GRASS);
  for (const [x, y] of [[70, 46], [74, 46], [70, 59], [74, 59], [72, 52]]) set(x, y, T.TREE);
  for (const sh of SHOPS) fill(sh.x, sh.y, sh.w, sh.h, T.SHOP);

  // City Hall: lawn, the hall itself, a paved forecourt down to the road.
  fill(CIVIC.x, CIVIC.y, CIVIC.w, CIVIC.h, T.LAWN);
  fill(HALL.x - 2, HALL.y + HALL.h, HALL.w + 4, CIVIC.y + CIVIC.h - (HALL.y + HALL.h), T.PLAZA);
  fill(CIVIC.x + 4, 35, CIVIC.w - 8, 5, T.PLAZA);
  fill(HALL.x, HALL.y, HALL.w, HALL.h, T.HALL);
  for (const [x, y] of [[119, 27], [158, 27], [124, 27], [153, 27]]) set(x, y, T.TREE);
  for (let x = CIVIC.x + 1; x < CIVIC.x + CIVIC.w - 1; x++) if (get(x, 33) === T.LAWN && (x < 128 || x > 149)) set(x, 33, T.FLOWERS);

  // Willow Park: a big pond with an island path, trees, flowers and a gazebo.
  const P = PARK;
  fill(P.x, P.y, P.w, P.h, T.GRASS);
  const lake = { cx: 137, cy: 53, rx: 8.5, ry: 4.6 };
  for (let y = P.y; y < P.y + P.h; y++) for (let x = P.x; x < P.x + P.w; x++) {
    const d = ((x + 0.5 - lake.cx) / lake.rx) ** 2 + ((y + 0.5 - lake.cy) / lake.ry) ** 2;
    if (d < 0.8) set(x, y, T.WATER);
    else if (d < 1.15) set(x, y, T.SAND);
  }
  // loop path
  for (let x = P.x + 2; x < P.x + P.w - 2; x++) { set(x, P.y + 3, T.PLAZA); set(x, P.y + P.h - 4, T.PLAZA); }
  for (let y = P.y + 3; y < P.y + P.h - 3; y++) { set(P.x + 2, y, T.PLAZA); set(P.x + P.w - 3, y, T.PLAZA); }
  for (let y = P.y; y < P.y + 3; y++) set(138, y, T.PLAZA);
  for (let y = P.y + P.h - 3; y < P.y + P.h; y++) set(138, y, T.PLAZA);
  for (const [x, y] of [[119, 46], [119, 59], [126, 49], [128, 58], [149, 48], [158, 46], [158, 59], [131, 51], [143, 59], [154, 57]]) set(x, y, T.TREE);
  for (let i = 0; i < 40; i++) {
    const x = P.x + 3 + Math.floor(rand() * (P.w - 6)), y = P.y + 4 + Math.floor(rand() * (P.h - 8));
    if (get(x, y) === T.GRASS) set(x, y, T.FLOWERS);
  }

  // Harvest Fair: a pumpkin patch, a corn maze strip and a picnic lawn.
  const F = FAIR;
  fill(F.x, F.y, F.w, F.h, T.GRASS);
  fill(F.x + 13, F.y + 2, 18, 12, T.FIELD);
  for (let x = F.x + 2; x < F.x + 11; x++) for (const y of [F.y + 6, F.y + 9, F.y + 12]) if ((x + y) % 5) set(x, y, T.CORN);
  for (let y = F.y; y < F.y + F.h; y++) set(F.x + 12, y, T.PLAZA);
  fill(F.x, F.y + 4, F.w, 1, T.PLAZA);
  for (const [x, y] of [[119, 79], [158, 70], [145, 67]]) set(x, y, T.TREE);

  // Scatter decoration on open grass (no rocks on claimable land).
  for (let y = LAND.y; y < LAND.y + LAND.h; y++) for (let x = LAND.x; x < LAND.x + LAND.w; x++) {
    if (get(x, y) !== T.GRASS) continue;
    let nearPath = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (get(x + dx, y + dy) === T.PATH) nearPath = true;
    const r = rand();
    if (r < 0.04) set(x, y, T.FLOWERS);
    else if (r < 0.1) set(x, y, T.TALLGRASS);
    else if (r < 0.112 && !nearPath && publicAreaAt(x, y) === FAIR) set(x, y, T.ROCK);
  }

  // Props and the tiles they block.
  const decor = publicDecor(season);
  const block = new Uint8Array(MAP_W * MAP_H);
  for (const d of decor) {
    if (!PROP_SIZE[d.t]?.solid) continue;
    const [w, h] = PROP_SIZE[d.t].size || [1, 1];
    const [fw, fh] = d.r % 2 ? [h, w] : [w, h];
    for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) if (inb(d.x + i, d.y + j)) block[(d.y + j) * MAP_W + d.x + i] = 1;
  }

  const baseRoads = new Uint8Array(MAP_W * MAP_H);
  for (let i = 0; i < tiles.length; i++) baseRoads[i] = tiles[i] === T.PATH ? 1 : 0;
  const spawn = { x: 60 * TILE, y: 59.5 * TILE };
  // plotAt is filled at runtime from the live plots (see indexPlots in plot.js).
  return {
    tiles, baseRoads, block, decor, season,
    plotAt: new Int32Array(MAP_W * MAP_H).fill(-1),
    shops: SHOPS, spawn, w: MAP_W, h: MAP_H, roadsVersion: 0,
  };
}

// Footprints of public props (the catalog has the full definitions of the buyable ones).
const PROP_SIZE = {
  flagpole: { solid: true }, lamppost: { solid: true }, noticeboard: { solid: true, size: [2, 1] }, ballotbox: { solid: true },
  bench: { solid: true, size: [2, 1] }, gazebo: { solid: true, size: [4, 4] }, stall: { solid: true, size: [3, 2] },
  scarecrow: { solid: true }, jackolantern: { solid: true }, pumpkin_deco: { solid: false }, haybale: { solid: true, size: [2, 1] },
  cauldron: { solid: true }, cornstalks: { solid: true }, gravestone: { solid: true }, ironfence: { solid: true },
};

// The live road layout = generated roads, plus tiles players have paved, minus tiles
// they have dug up. roads = { add: [tileIndex], del: [tileIndex] }.
export function applyRoads(world, roads) {
  const add = new Set(roads?.add || []), del = new Set(roads?.del || []);
  for (let i = 0; i < world.tiles.length; i++) {
    const want = (world.baseRoads[i] && !del.has(i)) || add.has(i);
    const isRoad = world.tiles[i] === T.PATH;
    if (want && !isRoad) world.tiles[i] = T.PATH;
    else if (!want && isRoad) world.tiles[i] = T.GRASS;
  }
  world.roadsVersion++;
}

export const isRoad = (world, tx, ty) => tx >= 0 && ty >= 0 && tx < MAP_W && ty < MAP_H && world.tiles[ty * MAP_W + tx] === T.PATH;

export function plotIdAtPixel(world, x, y) {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return -1;
  return world.plotAt[ty * MAP_W + tx];
}

// The village day runs from 5:00 AM to 5:00 AM. The clock moves in 10-minute steps, and
// each step takes 6 real seconds, so a whole day lasts 14.4 real minutes.
export const STEP_MS = 6000;
export const DAY_STEPS = 144;              // 24 h / 10 min
export const DAY_MS = STEP_MS * DAY_STEPS;
export const DAYS_PER_YEAR = 112;          // used for terms of office
export const START_HOUR = 6;               // a new world opens at 6:00 AM on day 1

// epoch = when the world was founded.
//   day, year, dayOfYear  calendar (1-based)
//   hours                 continuous 0..24 for lighting
//   shownHours, minutes   the clock face: whole hour + 0/10/20/30/40/50
export function worldClock(ms, epoch = 0) {
  const t = Math.max(0, ms - epoch) + (START_HOUR - 5) * 6 * STEP_MS;
  const dayIdx = Math.floor(t / DAY_MS);
  const into = t - dayIdx * DAY_MS;
  const sinceFive = (into / DAY_MS) * 24;                // 0..24 hours after 5:00 AM
  const steps = Math.floor(into / STEP_MS);
  const hours = (5 + sinceFive) % 24;
  const shown = (5 + Math.floor(steps / 6)) % 24;
  return {
    day: dayIdx + 1, year: Math.floor(dayIdx / DAYS_PER_YEAR) + 1, dayOfYear: (dayIdx % DAYS_PER_YEAR) + 1,
    hours, shownHours: shown, minutes: (steps % 6) * 10, step: steps,
  };
}

// Real milliseconds from `ms` until the start of world day `day` (5:00 AM).
export function msUntilDay(ms, epoch, day) {
  const startOfDay1 = epoch - (START_HOUR - 5) * 6 * STEP_MS;
  return startOfDay1 + (day - 1) * DAY_MS - ms;
}

// 0 = full daylight, ~0.65 = darkest night.
export function darkness(hours) {
  if (hours >= 7 && hours < 18) return 0;
  if (hours >= 18 && hours < 21) return ((hours - 18) / 3) * 0.62;
  if (hours >= 5 && hours < 7) return (1 - (hours - 5) / 2) * 0.62;
  return 0.62;
}

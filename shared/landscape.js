// The countryside around the old village (world v6): everything outside CORE. A river
// winds down from the north into the sea; a beach runs along the south coast with a
// pier; east of the river the land rises into highlands (cliffs, rock formations and
// stone stairs up to a lookout), with a campsite in the pine woods below. Winding
// lanes link it all to the village, with lots for sale along them and the villagers'
// cottages dotted about. Shared by server and client (it's part of generateWorld).
import { T, MAP_W, MAP_H, tileHash } from './world.js';

// The original village (it keeps its coordinates, so old saves still line up).
export const CORE = { x: 3, y: 3, w: 162, h: 82 };
// Terrain height of one level, in world units (a tile is 1).
export const ELEV_H = 1.1;
// Bridge boards are painted flush with the banks; the rails stand on them.
export const BRIDGE_Y = 0.02;
// Stairs climb in a direction: 0 north, 1 east, 2 south, 3 west.
export const STEP_UP = [[0, -1], [1, 0], [0, 1], [-1, 0]];

// ---------- shapes ----------
const vn = (x, y, s, seed = 0) => {
  const X = Math.floor(x / s), Y = Math.floor(y / s), fx = x / s - X, fy = y / s - Y;
  const h = (i, j) => tileHash(i * 7 + seed * 131, j * 13 - seed * 71);
  const a = h(X, Y), b = h(X + 1, Y), c = h(X, Y + 1), d = h(X + 1, Y + 1);
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
// The river's middle at row y, and its half-width.
export const riverX = (y) => 191 + 6 * Math.sin(y / 13) + 2.5 * Math.sin(y / 5.3 + 1);
const RIVER_HALF = 2.4;
// Where the sea starts in column x (rows below are water).
export const shoreY = (x) => 161 + 2.2 * Math.sin(x / 11) + 1.3 * Math.sin(x / 4.7 + 2);
const BEACH = 7; // sand above the waterline

// Raised land: rectangles with ragged edges (except near the stairs). l: level.
const PLATEAUS = [
  { x: 206, y: 27, w: 44, h: 33, l: 1 },
  { x: 228, y: 32, w: 17, h: 13, l: 2 },
  { x: 3, y: 126, w: 34, h: 22, l: 1 }, // the headland in the south-west
];
// Outdoor stone stairs: tiles (x, y) at the lower level, climbing `dir`.
export const STAIRS = [
  { x: 213, y: 60, w: 2, h: 1, dir: 0 },   // up from the ridge road to the highlands
  { x: 205, y: 40, w: 1, h: 2, dir: 1 },   // up from the river path
  { x: 235, y: 45, w: 2, h: 1, dir: 0 },   // up to the lookout
  { x: 37, y: 135, w: 1, h: 2, dir: 3 },   // up onto the headland from the coast road
];

// Lanes: control points (tiles), smoothed into curves. w: width in tiles.
export const LANES = [
  // The old roads carry on east, over the river.
  { name: 'North Road', pts: [[165, 23], [252, 23]], w: 4 },
  { name: 'South Road', pts: [[165, 63], [203, 63]], w: 4 },
  // The avenue runs south out of the village and winds down to the coast.
  { name: 'Meadow Lane', pts: [[60, 64], [60, 90], [52, 104], [58, 118], [74, 128], [96, 134]], w: 3 },
  { name: 'Coast Road', pts: [[39, 135.5], [50, 134], [70, 131], [96, 134], [125, 139], [150, 141], [178, 141], [205, 142], [232, 140], [252, 137]], w: 3 },
  // From the fair, south past the pond to the coast.
  { name: 'Fair Lane', pts: [[138, 80], [140, 96], [132, 110], [128, 124], [125, 139]], w: 3 },
  // Across the meadows, west to east.
  { name: 'Orchard Way', pts: [[52, 104], [80, 106], [104, 100], [132, 110], [160, 106], [178, 96], [184, 82]], w: 3 },
  { name: 'Willow Walk', pts: [[18, 92], [36, 96], [52, 104]], w: 3 },
  // East of the river: along the bank, then up into the hills and down to camp.
  { name: 'Ridge Road', pts: [[203, 63], [214, 64], [226, 70], [230, 84], [226, 98], [232, 112], [236, 126], [232, 140]], w: 3 },
  { name: 'River Path', pts: [[201, 24], [200, 34], [201, 46], [203, 56], [203, 63]], w: 2 },
  { name: 'Riverbank Lane', pts: [[184, 82], [180, 100], [176, 118], [178, 141]], w: 3 },
  // Little lanes out to the quiet corners.
  { name: 'Stone Lane', pts: [[56, 116], [42, 114], [30, 119]], w: 3 },
  { name: 'Pinecone Lane', pts: [[178, 23], [177, 14], [181, 6]], w: 3 },
  { name: 'Hilltop Lane', pts: [[226, 70], [240, 74], [250, 82]], w: 3 },
  { name: 'Cove Lane', pts: [[96, 134], [94, 146], [100, 152]], w: 3 },
];

// Public places out here (nobody can buy them).
export const AREAS = [
  { id: 'beach', name: 'Seashell Beach', x: 150, y: 146, w: 102, h: 14 },
  { id: 'camp', name: 'Pine Hollow Campsite', x: 214, y: 96, w: 20, h: 14 },
  { id: 'lookout', name: 'Eagle Lookout', x: 228, y: 32, w: 17, h: 13 },
  { id: 'highlands', name: 'The Highlands', x: 206, y: 27, w: 44, h: 33 },
  { id: 'pond', name: 'Duck Pond', x: 104, y: 112, w: 16, h: 12 },
  { id: 'stones', name: 'Standing Stones', x: 14, y: 112, w: 16, h: 14 },
  { id: 'riverside', name: 'Riverside Green', x: 166, y: 120, w: 14, h: 12 },
  { id: 'headland', name: 'Gull Point', x: 3, y: 126, w: 34, h: 22 },
];

// The villagers' cottages (see townshops.js), scattered about the countryside, each
// where it suits them. face: the side the front door is on ('s' or 'n').
const HOME_NAMES = {
  hazel: 'Hazel’s Cabin', bram: 'The Forge', willa: 'Willa’s Cottage', ellis: 'The Clinic', pip: 'Pip’s House',
  marigold: 'The Flower Cottage', gus: 'The Saloon', theo: 'Theo’s Place', ivy: 'Ivy’s Studio', sam: 'The Post Office',
  nell: 'Nell’s Cottage', fern: 'The Apiary', rowan: 'Rowan’s Farmhouse', lila: 'Lila’s Cottage', felix: 'The Observatory', bea: 'Bea’s House',
};
export const HOMES = [
  ['hazel', 168, 106, 'n'], // on the riverbank
  ['bram', 200, 72, 'n'],   // below the highlands, by the rocks
  ['willa', 96, 92, 's'],
  ['ellis', 66, 98, 's'],   // where Meadow Lane leaves the village
  ['pip', 86, 113, 'n'],
  ['marigold', 125, 100, 's'],
  ['gus', 150, 132, 's', 8, 6], // the saloon on the coast road
  ['theo', 166, 133, 's'],
  ['ivy', 243, 124, 's'],   // in the woods past the campsite
  ['sam', 54, 124, 's'],
  ['nell', 36, 102, 'n'],
  ['fern', 20, 96, 'n'],    // the apiary in the far meadow
  ['rowan', 158, 94, 's'],
  ['lila', 86, 124, 's'],
  ['felix', 232, 14, 's'],  // the observatory up north, under dark skies
  ['bea', 210, 134, 's'],   // by the pier
].map(([id, x, y, face, w = 6, h = 5]) => ({ id, name: HOME_NAMES[id], x, y, w, h, face }));

// ---------- painting ----------
// Paints everything outside CORE into the world. tiles/elev/stepDir are the world
// arrays; returns the decor props for these places.
export function paintLandscape(world) {
  const { tiles } = world;
  const elev = (world.elev = new Uint8Array(MAP_W * MAP_H));
  const stepDir = (world.stepDir = new Int8Array(MAP_W * MAP_H).fill(-1));
  const inb = (x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;
  const core = (x, y) => x >= CORE.x && y >= CORE.y && x < CORE.x + CORE.w && y < CORE.y + CORE.h;
  const set = (x, y, t) => { if (inb(x, y)) tiles[y * MAP_W + x] = t; };
  const get = (x, y) => (inb(x, y) ? tiles[y * MAP_W + x] : T.TREE);
  const outside = (x, y) => inb(x, y) && !core(x, y);
  const border = (x, y) => x < 3 || y < 3 || x >= MAP_W - 3 || y >= MAP_H - 3;
  const inArea = (a, x, y) => x >= a.x && y >= a.y && x < a.x + a.w && y < a.y + a.h;

  // 1. Meadows and woods: grass, with forest where the noise is high (and always at
  //    the map's edge). The pinewoods round the campsite are thick.
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    if (!outside(x, y)) continue;
    const n = vn(x, y, 9) * 0.7 + vn(x, y, 4, 3) * 0.3;
    const pines = Math.hypot((x - 224) / 22, (y - 103) / 16) < 1;
    let t = T.GRASS;
    if (border(x, y) || n > (pines ? 0.38 : 0.6)) t = T.TREE;
    else if (tileHash(x * 3 + 1, y * 5) < 0.05) t = T.FLOWERS;
    else if (tileHash(x * 5, y * 3 + 2) < 0.08) t = T.TALLGRASS;
    set(x, y, t);
  }
  // 2. The sea along the south, with a sandy beach (rocks at the west end).
  for (let x = 0; x < MAP_W; x++) {
    const sy = shoreY(x);
    for (let y = Math.floor(sy - BEACH - 1); y < MAP_H; y++) {
      if (!outside(x, y)) continue;
      if (y >= sy) set(x, y, T.WATER);
      else if (y >= sy - BEACH + (x < 50 ? 4 : 0)) set(x, y, x < 50 && tileHash(x, y) < 0.3 ? T.ROCK : T.SAND);
    }
  }
  // 3. The river, from the top of the map down to the sea, with sandy banks.
  for (let y = 0; y < MAP_H; y++) {
    const cx = riverX(y);
    for (let x = Math.floor(cx - RIVER_HALF - 1.5); x <= Math.ceil(cx + RIVER_HALF + 1.5); x++) {
      if (!outside(x, y)) continue;
      const d = Math.abs(x + 0.5 - cx);
      if (d < RIVER_HALF) set(x, y, T.WATER);
      else if (d < RIVER_HALF + 1.2 && get(x, y) !== T.WATER) set(x, y, T.SAND);
    }
  }
  // 4. Raised land: ragged cliffs, flat (stairs keep a straight edge).
  const nearStair = (x, y) => STAIRS.some((s) => x >= s.x - 2 && x < s.x + s.w + 2 && y >= s.y - 2 && y < s.y + s.h + 2);
  for (const p of PLATEAUS) {
    for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) {
      const d = Math.min(x - p.x, p.x + p.w - 1 - x, y - p.y, p.y + p.h - 1 - y);
      const jag = nearStair(x, y) ? 0 : Math.floor(vn(x, y, 3, p.l + 5) * 3);
      if (d < jag || get(x, y) === T.WATER) continue;
      elev[y * MAP_W + x] = p.l;
      if (get(x, y) === T.SAND) set(x, y, T.GRASS);
    }
  }
  for (const s of STAIRS) {
    const [ux, uy] = STEP_UP[s.dir];
    for (let j = 0; j < s.h; j++) for (let i = 0; i < s.w; i++) {
      const x = s.x + i, y = s.y + j, k = y * MAP_W + x;
      const top = elev[(y + uy) * MAP_W + x + ux];
      elev[k] = Math.max(0, top - 1);
      stepDir[k] = s.dir;
      set(x, y, T.STEPS);
      // Clear the way at the bottom and the top.
      for (const [bx, by] of [[x - ux, y - uy], [x + ux, y + uy], [x + 2 * ux, y + 2 * uy]]) if (get(bx, by) === T.TREE || get(bx, by) === T.ROCK) set(bx, by, T.GRASS);
    }
  }
  // Rock formations on the high ground and along its foot.
  for (let y = 20; y < 66; y++) for (let x = 200; x < MAP_W - 3; x++) {
    const k = y * MAP_W + x;
    if (get(x, y) !== T.GRASS && get(x, y) !== T.TALLGRASS && get(x, y) !== T.TREE) continue;
    if (nearStair(x, y) || inArea(AREAS[2], x, y)) continue;
    const foot = !elev[k] && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => elev[(y + dy) * MAP_W + x + dx]);
    const r = vn(x, y, 5, 9);
    if ((foot && r > 0.45) || (elev[k] && r > 0.72)) set(x, y, T.ROCK);
    else if (elev[k] && get(x, y) === T.TREE && tileHash(x, y * 3) < 0.6) set(x, y, T.GRASS); // open moor on top
  }
  // High ground is open moorland: just the odd tree.
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) if (elev[y * MAP_W + x] && get(x, y) === T.TREE && !border(x, y) && tileHash(x * 5 + 1, y * 3) < 0.8) set(x, y, T.GRASS);
  // 5. Clearings for the public places.
  for (const a of AREAS) {
    if (a.id === 'highlands' || a.id === 'headland') continue;
    for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) {
      const t = get(x, y);
      if (t === T.TREE || t === T.ROCK || (t === T.TALLGRASS && a.id !== 'stones')) set(x, y, a.id === 'beach' ? T.SAND : T.GRASS);
    }
  }
  const pond = AREAS.find((a) => a.id === 'pond');
  for (let y = pond.y; y < pond.y + pond.h; y++) for (let x = pond.x; x < pond.x + pond.w; x++) {
    const d = ((x + 0.5 - 112) / 5) ** 2 + ((y + 0.5 - 117.5) / 3.6) ** 2;
    if (d < 0.8) set(x, y, T.WATER); else if (d < 1.2) set(x, y, T.SAND);
  }
  // The pier: boards out into the sea.
  for (let y = Math.floor(shoreY(200)) - 2; y < Math.floor(shoreY(200)) + 9; y++) for (const x of [198, 199, 200, 201, 202]) set(x, y, T.BRIDGE);
  // 6. Lanes, with bridges where they cross water. Trees and rocks back off a tile.
  for (const lane of LANES) {
    const pts = curve(lane.pts);
    const r = lane.w / 2;
    for (const [px, py] of pts) {
      for (let y = Math.floor(py - r - 1); y <= Math.ceil(py + r + 1); y++) for (let x = Math.floor(px - r - 1); x <= Math.ceil(px + r + 1); x++) {
        if (!inb(x, y) || (core(x, y) && !(lane.name === 'Meadow Lane' || lane.name === 'Fair Lane' || lane.pts[0][0] === 165))) continue;
        if (elev[y * MAP_W + x] || get(x, y) === T.STEPS) continue;
        const d = Math.max(Math.abs(x + 0.5 - px), Math.abs(y + 0.5 - py));
        if (d < r) {
          const t = get(x, y);
          if (t === T.WATER || t === T.BRIDGE) set(x, y, T.BRIDGE);
          else if (t !== T.PLAZA && t !== T.FOUNTAIN && t !== T.HALL && t !== T.SHOP) set(x, y, T.PATH);
        } else if (d < r + 1.2 && (get(x, y) === T.TREE || get(x, y) === T.ROCK) && !border(x, y)) set(x, y, T.GRASS);
      }
    }
  }
  // A bridge spans the whole river: board over any water left between its rails.
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    if (get(x, y) !== T.BRIDGE) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let n = 1;
      while (n < 4 && get(x + dx * n, y + dy * n) === T.WATER) n++;
      if (n > 1 && n < 4 && get(x + dx * n, y + dy * n) === T.BRIDGE) for (let i = 1; i < n; i++) set(x + dx * i, y + dy * i, T.BRIDGE);
    }
  }
  // 7. Cottages: grass underneath, a path from the front door to the road.
  for (const H of HOMES) {
    for (let y = H.y - 1; y <= H.y + H.h; y++) for (let x = H.x - 1; x <= H.x + H.w; x++) if (get(x, y) === T.TREE || get(x, y) === T.ROCK || get(x, y) === T.TALLGRASS) set(x, y, T.GRASS);
    const dx = H.x + Math.floor(H.w / 2) - 1, step = H.face === 's' ? 1 : -1;
    for (let y = H.face === 's' ? H.y + H.h : H.y - 1, n = 0; n < 14 && get(dx, y) !== T.PATH && get(dx, y) !== T.BRIDGE; y += step, n++) set(dx, y, T.PLAZA);
  }
  return decor();

  // Props for the new public places: [item, x, y, r].
  function decor() {
    const out = [];
    const add = (t, x, y, r = 0) => out.push({ t, x, y, r });
    // Beach: parasols and towels, rowboats pulled up on the sand, lamps along the pier.
    for (let x = 156; x < 248; x += 9) {
      const y = Math.floor(shoreY(x)) - 4 - Math.floor(tileHash(x, 3) * 2);
      if (get(x, y) !== T.SAND || Math.abs(x - 200) < 4) continue;
      if (tileHash(x, 9) < 0.5) { add('parasol', x, y); add('beachtowel', x + 1, y); } else add('rowboat', x, y + 2, 1);
    }
    for (let y = Math.floor(shoreY(200)) + 1; y < Math.floor(shoreY(200)) + 9; y += 3) { add('lamppost', 198, y); add('lamppost', 202, y); }
    add('bench', 196, Math.floor(shoreY(196)) - 6); add('bench', 205, Math.floor(shoreY(205)) - 6);
    // Campsite: tents round a fire, log seats, a picnic table and lanterns.
    add('firepit', 223, 102);
    add('logseat', 221, 100, 0); add('logseat', 225, 104, 2); add('logseat', 220, 103, 1); add('logseat', 226, 101, 3);
    add('tent', 216, 98); add('tent', 229, 97); add('tent', 217, 106); add('tent', 230, 105);
    add('picnic', 222, 107); add('lantern', 220, 99); add('lantern', 227, 106); add('stonelantern', 219, 109);
    // Lookout: a telescope at the edge and benches with a view.
    add('telescope', 236, 34); add('bench', 231, 36); add('bench', 239, 38); add('flagpole', 243, 33);
    // Highlands: big boulders among the rocks.
    for (const [x, y] of [[211, 32], [222, 50], [241, 52], [216, 44], [246, 30], [208, 55]]) if (get(x, y) !== T.STEPS && get(x + 1, y + 1) !== T.STEPS) add('boulder', x, y);
    // Standing stones in a ring.
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      add('boulder', Math.round(21 + Math.cos(a) * 5), Math.round(118 + Math.sin(a) * 4));
    }
    // Duck pond: benches and a lamp.
    add('bench', 106, 113); add('bench', 115, 121); add('lamppost', 105, 120); add('birdbath', 118, 113);
    // Riverside green: benches facing the water, a picnic table.
    add('bench', 170, 124, 3); add('bench', 170, 128, 3); add('picnic', 168, 121); add('lamppost', 167, 130);
    // Gull Point: a bench on the cliff top.
    add('bench', 14, 134); add('lamppost', 20, 132); add('telescope', 10, 140);
    return out.filter((d) => { const t = get(d.x, d.y); return t !== T.WATER && t !== T.TREE && t !== T.STEPS && !(t === T.BRIDGE && d.t !== 'lamppost'); });
  }
}

// Catmull-Rom through the points, sampled every quarter tile.
function curve(pts) {
  if (pts.length < 3) {
    const [[x0, y0], [x1, y1]] = pts, n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 4);
    return Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
  }
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const n = Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) * 4);
    for (let s = 0; s < n; s++) {
      const t = s / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// ---------- terrain rules ----------
// Is there a cliff between neighbouring tiles a and b? (Stairs join a level to the one
// above at their top end.)
export function cliffBetween(world, ax, ay, bx, by) {
  const E = world.elev;
  if (!E || ax < 0 || ay < 0 || bx < 0 || by < 0 || ax >= MAP_W || bx >= MAP_W || ay >= MAP_H || by >= MAP_H) return false;
  const ia = ay * MAP_W + ax, ib = by * MAP_W + bx;
  const ea = E[ia], eb = E[ib];
  const da = world.stepDir[ia], db = world.stepDir[ib];
  if (ea === eb) {
    // Not off the side of a flight of stairs onto ground at its own level... that's fine.
    return false;
  }
  if (da >= 0) { const [ux, uy] = STEP_UP[da]; if (bx - ax === ux && by - ay === uy && eb === ea + 1) return false; }
  if (db >= 0) { const [ux, uy] = STEP_UP[db]; if (ax - bx === ux && ay - by === uy && ea === eb + 1) return false; }
  return true;
}
// Height of the ground (world units) under world pixel (px, py).
export function groundAt(world, px, py, TILE = 16) {
  const E = world.elev;
  if (!E) return 0;
  const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return 0;
  const k = ty * MAP_W + tx, base = E[k] * ELEV_H, d = world.stepDir[k];
  if (d < 0) return base + (world.tiles[k] === T.BRIDGE ? BRIDGE_Y : 0);
  const fx = px / TILE - tx, fy = py / TILE - ty;
  const t = [1 - fy, fx, fy, 1 - fx][d];
  return base + Math.max(0, Math.min(1, t)) * ELEV_H;
}
// The tile's ground height (for props and trees).
export const tileGround = (world, x, y) => (world.elev ? world.elev[y * MAP_W + x] * ELEV_H : 0);

// ---------- lots for sale ----------
// Plots out in the countryside: rectangles of varied sizes on open, level ground that
// touch a lane, placed in a shuffled order so they don't line up in a grid.
const LOT_SIZES = [[22, 14], [18, 14], [16, 12], [24, 16], [14, 12], [20, 12], [16, 16], [12, 10], [14, 10]];
export function placeLots(world, homes = HOMES) {
  const { tiles, elev } = world;
  const inb = (x, y) => x >= 3 && y >= 3 && x < MAP_W - 3 && y < MAP_H - 3;
  const core = (x, y) => x >= CORE.x - 1 && y >= CORE.y - 1 && x < CORE.x + CORE.w + 1 && y < CORE.y + CORE.h + 1;
  const taken = new Uint8Array(MAP_W * MAP_H);
  const mark = (r, m) => { for (let y = r.y - m; y < r.y + r.h + m; y++) for (let x = r.x - m; x < r.x + r.w + m; x++) if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) taken[y * MAP_W + x] = 1; };
  for (const H of homes) mark(H, 2);
  for (const a of AREAS) mark(a, 1);
  const OPEN = new Set([T.GRASS, T.TALLGRASS, T.FLOWERS, T.TREE]);
  const ok = (x, y) => inb(x, y) && !core(x, y) && !taken[y * MAP_W + x] && !elev[y * MAP_W + x] && OPEN.has(tiles[y * MAP_W + x]);
  // Walk the lanes' edges (in a shuffled order) and try lots of each size flush
  // against the road there, shifted along it a little.
  const edges = [];
  for (let y = 4; y < MAP_H - 4; y++) for (let x = 4; x < MAP_W - 4; x++) {
    if (tiles[y * MAP_W + x] !== T.PATH || core(x, y)) continue;
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) if (ok(x + dx, y + dy)) edges.push([tileHash(x * 17 + dx * 5 + 3, y * 31 + dy * 7 + 7), x, y, dx, dy]);
  }
  edges.sort((a, b) => a[0] - b[0]);
  const lots = [];
  const fits = (x, y, w, h) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (!ok(x + i, y + j)) return false; return true; };
  for (const [h, rx, ry, dx, dy] of edges) {
    if (lots.length >= 48 || !ok(rx + dx, ry + dy)) continue;
    const order = LOT_SIZES.map((sz, i) => [tileHash(rx + i * 13, ry - i * 7), sz]).sort((a, b) => a[0] - b[0]).map(([, sz]) => sz);
    let got = null;
    for (const [w0, h0] of order) {
      // The side against the road is the lot's width.
      const [w, hh] = dy ? [w0, h0] : [h0, w0];
      for (const f of [h, (h + 0.33) % 1, (h + 0.66) % 1]) {
        const slide = Math.floor(f * (dy ? w : hh));
        const x = dy ? rx - slide : dx > 0 ? rx + 1 : rx - w;
        const y = dx ? ry - slide : dy > 0 ? ry + 1 : ry - hh;
        if (fits(x, y, w, hh)) { got = { x, y, w, h: hh }; break; }
      }
      if (got) break;
    }
    if (!got) continue;
    lots.push(got);
    mark(got, 1);
  }
  return lots;
}

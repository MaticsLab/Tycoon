// The village shops on the north side of the town square are real buildings you walk
// into: plots owned by the village (nobody can claim or edit them), built from walls,
// doors, floors and furniture like any house, with the shopkeeper behind the counter.
// They're generated from this layout every time the world starts.
import { GOODS } from './catalog.js';
import { edgeKey } from './plot.js';
import { SHOPS } from './world.js';

export const TOWN_OWNER = 'village';
export const TOWN_PLOT_BASE = 9000; // plot ids 9000+ (out of the way of player plots)

// Furniture: [item, lx, ly, r], plus goods shown on shelves.
const LAYOUTS = {
  rosa: {
    floor: 'floor_checker', outside: 'wall_stucco', inside: 'wall_paper', roof: 'roof_red',
    keeper: [3.5, 0.6],
    obj: [
      ['houseplant', 0, 0], ['coolercase', 1, 0], ['coolercase', 7, 0],
      ['counter', 2, 1], ['register', 3, 1], ['counter', 4, 1], ['counter', 5, 1],
      ['shelf', 0, 2, 3], ['shelf', 0, 3, 3], ['shelf', 0, 4, 3],
      ['shelf', 7, 2, 1], ['shelf', 7, 3, 1], ['shelf', 7, 4, 1],
      ['producestand', 1, 3], ['producestand', 5, 3],
      ['lamp', 0, 5],
    ],
    // Goods on display (what she buys and sells), shelf by shelf.
    stock: {
      '1,0': ['milk', 'egg', 'cheese'], '7,0': ['juice', 'jam', 'cake'],
      '0,2': ['turnip', 'carrot', 'berry'], '0,3': ['wheat', 'corn', 'kale'], '0,4': ['bread', 'soup', 'pie'],
      '7,2': ['bouquet', 'honeycake', 'tea'], '7,3': ['bookgift', 'wateringcan', 'hay'], '7,4': ['wool', 'cloth', 'melon'],
      '1,3': ['pumpkin', 'melon', 'corn', 'berry'], '5,3': ['turnip', 'carrot', 'kale', 'wheat'],
    },
  },
  otto: {
    floor: 'floor_wood', outside: 'wall_board', inside: 'wall_wainscot', roof: 'roof_blue',
    keeper: [3.5, 0.6],
    obj: [
      ['fireplace', 0, 0], ['bookshelf', 6, 0], ['grandclock', 7, 0],
      ['counter', 2, 1], ['register', 3, 1], ['counter', 4, 1],
      ['armchair', 0, 2], ['coffeetable', 0, 3], ['sofa', 0, 4, 2],
      ['piano', 7, 2, 1], ['displaytable', 5, 3], ['dresser', 6, 4], ['houseplant', 7, 4],
      ['lamp', 7, 5],
    ],
    stock: {},
  },
};

// Public projects the council can fund from the treasury (Council → Propose). Each is a
// village plot that appears once it's built.
export const PROJECTS = {
  garden: { name: 'Flower Garden', icon: '🌷', cost: 1500, x: 155, y: 49, w: 5, h: 4, where: 'Willow Park', line: 'A statue garden with flower beds and a bench in Willow Park.' },
  market: { name: 'Farmers’ Market', icon: '🧺', cost: 2500, x: 152, y: 29, w: 6, h: 5, where: 'City Hall lawn', line: 'Market stalls on the City Hall lawn.' },
  bandstand: { name: 'Bandstand', icon: '🎺', cost: 3000, x: 149, y: 66, w: 8, h: 6, where: 'the Harvest Fair', line: 'A bandstand with benches and lamps at the fair, for festivals.' },
  library: { name: 'Village Library', icon: '📚', cost: 4000, x: 118, y: 29, w: 6, h: 5, where: 'City Hall lawn', line: 'A cozy library anyone can walk into and read in.' },
};
const PROJECT_LAYOUTS = {
  garden: { path: 'floor_stone', obj: [['flowerbed', 0, 0], ['flowerbed', 1, 0], ['flowerbed', 3, 0], ['flowerbed', 4, 0], ['statue', 2, 1], ['birdbath', 0, 2], ['bush', 4, 2], ['bench', 1, 3], ['flowerbed', 3, 3], ['flowerbed', 4, 3]], paths: [[2, 2], [2, 3], [0, 1], [1, 1], [3, 1], [4, 1], [1, 2], [3, 2]] },
  market: { path: 'floor_stone', obj: [['stall', 0, 0], ['stall', 3, 0], ['producestand', 0, 3], ['producestand', 4, 3], ['lamppost', 2, 4], ['lamppost', 3, 4]], paths: 'all' },
  bandstand: { path: 'floor_stone', obj: [['gazebo', 2, 0], ['lamppost', 0, 0], ['lamppost', 7, 0], ['bench', 0, 5], ['bench', 3, 5], ['bench', 6, 5], ['flowerbed', 0, 2], ['flowerbed', 7, 2]], paths: [[2, 4], [3, 4], [4, 4], [5, 4], [1, 4], [6, 4]] },
  library: {
    building: true, floor: 'floor_wood', outside: 'wall_brick', inside: 'wall_wainscot', roof: 'roof_green',
    obj: [['bookshelf', 0, 0], ['bookshelf', 1, 0], ['bookshelf', 4, 0], ['bookshelf', 5, 0], ['grandclock', 2, 0], ['desk', 1, 2], ['chair', 1, 3, 2], ['armchair', 4, 2], ['armchair', 5, 2], ['rug', 4, 3], ['lamp', 0, 4], ['houseplant', 0, 2], ['globe', 3, 0]],
  },
};

function projectPlot(id, i) {
  const P = PROJECTS[id], L = PROJECT_LAYOUTS[id];
  if (L.building) return shopPlot({ id, name: P.name, x: P.x, y: P.y, w: P.w, h: P.h }, 10 + i, L, false);
  const plot = blank({ id: TOWN_PLOT_BASE + 10 + i, x: P.x, y: P.y, w: P.w, h: P.h }, id, P.name, null);
  const tiles = L.paths === 'all' ? [...Array(P.w * P.h)].map((_, k) => [k % P.w, Math.floor(k / P.w)]) : L.paths;
  for (const [x, y] of tiles) plot.floor[`${x},${y}`] = L.path;
  for (const [t, x, y, r] of L.obj) plot.obj[`${x},${y}`] = r ? { t, r } : { t };
  return plot;
}

function blank(at, town, name, keeper) {
  return {
    id: at.id, x: at.x, y: at.y, w: at.w, h: at.h, owner: TOWN_OWNER, ownerName: name, farm: '',
    town, name, keeper, rev: 1, floor: {}, obj: {}, l1: { floor: {}, obj: {} }, walls: {}, roofs: [],
  };
}

function shopPlot(shop, i, L = LAYOUTS[shop.id], keeper = true) {
  const { w, h } = shop;
  const plot = blank({ id: TOWN_PLOT_BASE + i, x: shop.x, y: shop.y, w, h }, shop.id, shop.name, keeper ? shop.id : null);
  plot.roofs = [{ x: 0, y: 0, w, h, l: 0, m: L.roof }];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) plot.floor[`${x},${y}`] = L.floor;
  // Walls: m is the north/west face, o the south/east one.
  const out = L.outside, inn = L.inside;
  for (let x = 0; x < w; x++) {
    plot.walls[edgeKey(0, 'h', x, 0)] = { m: out, o: inn };
    plot.walls[edgeKey(0, 'h', x, h)] = { m: inn, o: out };
  }
  for (let y = 0; y < h; y++) {
    plot.walls[edgeKey(0, 'v', 0, y)] = { m: out, o: inn };
    plot.walls[edgeKey(0, 'v', w, y)] = { m: inn, o: out };
  }
  // Shop front: big windows either side of glass double doors in the middle.
  const door = Math.floor(w / 2) - 1;
  for (let x = 0; x < w; x++) {
    const k = edgeKey(0, 'h', x, h);
    if (x === door || x === door + 1) plot.walls[k].f = 'door_shopdouble';
    else if (x !== door - 1 && x !== door + 2) plot.walls[k].f = 'window_shop';
  }
  // A window on each side wall, and two at the back.
  plot.walls[edgeKey(0, 'v', 0, Math.floor(h / 2))].f = 'window';
  plot.walls[edgeKey(0, 'v', w, Math.floor(h / 2))].f = 'window';
  for (const [k, item, r] of L.obj.map(([t, x, y, rr]) => [`${x},${y}`, t, rr])) plot.obj[k] = r ? { t: item, r } : { t: item };
  for (const [k, items] of Object.entries(L.stock || {})) {
    if (plot.obj[k]) plot.obj[k].stock = items.map((item) => ({ item, n: 9, price: GOODS[item]?.value || 0 }));
  }
  return plot;
}

// Every village plot: the shops, plus the projects built so far (ids from city data).
export const townShopPlots = (projects = []) => [
  ...SHOPS.map((sh, i) => shopPlot(sh, i)),
  ...Object.keys(PROJECTS).map((id, i) => (projects.includes(id) ? projectPlot(id, i) : null)).filter(Boolean),
];
// Where the keeper stands behind the counter (world tiles).
export const keeperSpot = (id) => {
  const sh = SHOPS.find((s) => s.id === id);
  const [x, y] = LAYOUTS[id].keeper;
  return { x: sh.x + x, y: sh.y + y };
};
export const isTownPlot = (plot) => !!plot?.town;

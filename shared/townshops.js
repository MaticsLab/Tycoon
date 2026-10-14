// The village shops on the north side of the town square are real buildings you walk
// into: plots owned by the village (nobody can claim or edit them), built from walls,
// doors, floors and furniture like any house, with the shopkeeper behind the counter.
// They're generated from this layout every time the world starts.
import { GOODS, ITEMS } from './catalog.js';
import { edgeKey } from './plot.js';
import { SHOPS, HOMES } from './world.js';

export const TOWN_OWNER = 'village';
export const TOWN_PLOT_BASE = 9000; // plot ids 9000+ (out of the way of player plots)

// Furniture: [item, lx, ly, r], plus goods shown on shelves.
const LAYOUTS = {
  rosa: {
    floor: 'floor_checker', outside: 'wall_stucco', inside: 'wall_paper', roof: 'roof_red',
    keeper: [3.5, 0.6],
    // Chilled cases and a wall of jars at the back, the bakery case on the counter,
    // shelves down both walls, produce stands and end caps either side of the aisle.
    // Kept roomy: displays round the walls and one produce stand, with a wide aisle from
    // the door to the counter.
    obj: [
      ['coolercase', 0, 0], ['coolercase', 7, 0],
      ['counter', 2, 1], ['register', 3, 1], ['bakerycase', 4, 1],
      ['wallshelf', 0, 2, 3], ['shelf', 0, 4, 3],
      ['shelf', 7, 2, 1], ['shelf', 7, 4, 1],
      ['producestand', 5, 3],
      ['houseplant', 0, 5],
    ],
    // Goods on display, shelf by shelf.
    stock: {
      '0,0': ['milk', 'egg', 'cheese'],
      '7,0': ['juice', 'milk', 'cheese'], '4,1': ['bread', 'pie', 'cake', 'honeycake'],
      '0,2': ['jam', 'tea', 'flour', 'soup', 'turnip', 'carrot'], '0,4': ['bread', 'corn', 'wheat'],
      '7,2': ['bouquet', 'bookgift', 'tea'], '7,4': ['wool', 'cloth', 'apple'],
      '5,3': ['pumpkin', 'melon', 'carrot', 'apple'],
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
      ['lamp', 7, 5], ['chalkboard', 1, 5], ['scale', 5, 5],
    ],
    stock: { '5,3': ['bookgift', 'cloth', 'wool', 'tea'] },
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

// The villagers' cottages, out in the countryside. Laid out as if the door is in the south wall
// (x = 2, or 3-4 for the saloon's double doors); houses facing north are mirrored.
// Furniture: [item, x, y, r] (r: 0 faces south, 1 west, 2 north, 3 east).
const BED = [['bed', 0, 0], ['nightstand', 1, 0]];
export const HOME_LAYOUTS = {
  hazel: { floor: 'floor_wood', outside: 'wall_wood', inside: 'wall_board', roof: 'roof_thatch',
    obj: [...BED, ['aquarium', 3, 0], ['fishbowl', 5, 0], ['table', 4, 2], ['chair', 4, 3, 2], ['chair', 5, 3, 2], ['rug', 0, 3], ['lantern', 5, 4], ['houseplant', 3, 4]] },
  bram: { floor: 'floor_stone', outside: 'wall_stone', inside: 'wall_darkstone', roof: 'roof_red',
    obj: [['bed', 0, 0], ['chest', 1, 0], ['fireplace', 3, 0], ['smoker', 5, 0], ['counter', 5, 2], ['counter', 5, 3], ['table', 0, 3], ['chair', 0, 4, 2], ['chair', 1, 4, 2], ['lantern', 3, 3]] },
  willa: { floor: 'floor_wood', outside: 'wall_brick', inside: 'wall_wainscot', roof: 'roof_green',
    obj: [['bed', 0, 0], ['bookshelf', 1, 0], ['bookshelf', 3, 0], ['bookshelf', 4, 0], ['bookshelf', 5, 0], ['desk', 4, 2], ['chair', 4, 3, 2], ['armchair', 0, 3, 3], ['endtable', 0, 4], ['lamp', 1, 3], ['globe', 5, 4]] },
  ellis: { floor: 'floor_tile', outside: 'wall_white', inside: 'wall_white', roof: 'roof_blue',
    obj: [...BED, ['pedestalsink', 3, 0], ['towelrack', 4, 0], ['bookshelf', 5, 0], ['desk', 3, 2], ['chair', 3, 3, 2], ['bed', 5, 2], ['endtable', 0, 3], ['armchair', 0, 4, 3], ['houseplant', 5, 4]] },
  pip: { floor: 'floor_blue', outside: 'wall_stucco', inside: 'wall_paper', roof: 'roof_red',
    obj: [['bunkbed', 0, 0], ['chest', 1, 0], ['nightstand', 4, 0], ['bed', 5, 0], ['table', 3, 2], ['chair', 3, 3, 2], ['chair', 4, 3, 2], ['beanbag', 0, 3], ['petbed', 0, 4], ['lamp', 5, 4]] },
  marigold: { floor: 'floor_wood', outside: 'wall_sage', inside: 'wall_paper', roof: 'roof_thatch',
    obj: [...BED, ['monstera', 3, 0], ['flowerbuckets', 4, 0], ['houseplant', 5, 0], ['table', 4, 2], ['chair', 4, 3, 2], ['chair', 5, 3, 2], ['cactus', 0, 3], ['floorvase', 0, 4], ['succulents', 3, 4]] },
  gus: { floor: 'floor_wood', outside: 'wall_board', inside: 'wall_wood', roof: 'roof_red', door: 'door_double',
    obj: [['fridge', 0, 0], ['stove', 1, 0], ['kitchensink', 2, 0], ['counter', 0, 2], ['counter', 1, 2], ['counter', 2, 2], ['barstool', 0, 3, 2], ['barstool', 1, 3, 2], ['barstool', 2, 3, 2],
      ['piano', 4, 0], ['nightstand', 6, 0], ['bed', 7, 0], ['chair', 5, 2], ['chair', 6, 2], ['table', 5, 3], ['chair', 5, 4, 2], ['chair', 6, 4, 2], ['arcade', 7, 4, 1], ['lantern', 0, 5], ['houseplant', 7, 5], ['recordplayer', 1, 5]] },
  theo: { floor: 'floor_red', outside: 'wall_shingle', inside: 'wall_shiplap', roof: 'roof_blue',
    obj: [...BED, ['piano', 3, 0], ['recordplayer', 5, 0], ['coffeetable', 4, 2], ['sofa', 4, 3, 2], ['arclamp', 0, 3], ['beanbag', 0, 4], ['lamp', 5, 4]] },
  ivy: { floor: 'floor_wood', outside: 'wall_wood', inside: 'wall_white', roof: 'roof_green',
    obj: [...BED, ['easel', 4, 0], ['bookshelf', 5, 0], ['easel', 3, 2, 3], ['table', 4, 3], ['chair', 4, 4, 2], ['houseplant', 0, 3], ['cattree', 0, 4], ['lamp', 5, 2]] },
  sam: { floor: 'floor_wood', outside: 'wall_paintbrick', inside: 'wall_paper', roof: 'roof_red',
    obj: [...BED, ['desk', 3, 0], ['chair', 3, 1, 2], ['chest', 5, 0], ['table', 4, 3], ['chair', 4, 2], ['chair', 4, 4, 2], ['lowshelf', 0, 4], ['lamp', 5, 1]] },
  nell: { floor: 'floor_red', outside: 'wall_brick', inside: 'wall_wainscot', roof: 'roof_blue',
    obj: [...BED, ['bookshelf', 3, 0], ['grandclock', 4, 0], ['bookshelf', 5, 0], ['rockingchair', 4, 2], ['loom', 4, 4], ['armchair', 0, 4, 3], ['endtable', 0, 3], ['lamp', 5, 2]] },
  fern: { floor: 'floor_wood', outside: 'wall_wood', inside: 'wall_board', roof: 'roof_thatch',
    obj: [...BED, ['preservesjar', 3, 0], ['counter', 4, 0], ['counter', 5, 0], ['table', 4, 2], ['chair', 4, 3, 2], ['chair', 5, 3, 2], ['houseplant', 0, 3], ['succulents', 0, 4], ['lamp', 5, 4]] },
  rowan: { floor: 'floor_wood', outside: 'wall_board', inside: 'wall_shiplap', roof: 'roof_red',
    obj: [...BED, ['stove', 3, 0], ['counter', 4, 0], ['fridge', 5, 0], ['table', 4, 2], ['chair', 4, 3, 2], ['chair', 5, 3, 2], ['chest', 0, 3], ['petbed', 0, 4], ['lamp', 5, 4]] },
  lila: { floor: 'floor_checker', outside: 'wall_stucco', inside: 'wall_subway', roof: 'roof_red',
    obj: [...BED, ['bakeryoven', 3, 0], ['counter', 4, 0], ['stove', 5, 0], ['island', 4, 2], ['barstool', 4, 3, 2], ['barstool', 5, 3, 2], ['houseplant', 0, 3], ['lamp', 0, 4]] },
  bea: { floor: 'floor_blue', outside: 'wall_blue', inside: 'wall_paper', roof: 'roof_blue',
    obj: [...BED, ['arcade', 3, 0], ['tv', 4, 0], ['recordplayer', 5, 0], ['beanbag', 4, 2], ['beanbag', 5, 2], ['wardrobe', 0, 3], ['pouf', 4, 3], ['lamp', 5, 4]] },
  felix: { floor: 'floor_wood', outside: 'wall_darkstone', inside: 'wall_wood', roof: 'roof_glass',
    obj: [...BED, ['globe', 3, 0], ['telescope', 4, 0], ['bookshelf', 5, 0], ['desk', 4, 2], ['chair', 4, 3, 2], ['telescope', 0, 3], ['lamp', 0, 4], ['grandclock', 5, 4]] },
};

const objSize = (t, r = 0) => { const [w, h] = ITEMS[t]?.size || [1, 1]; return r % 2 ? [h, w] : [w, h]; };
function homePlot(H, i) {
  const L = HOME_LAYOUTS[H.id], { w, h } = H, north = H.face === 'n';
  const plot = blank({ id: TOWN_PLOT_BASE + 30 + i, x: H.x, y: H.y, w, h }, 'home', H.name, null);
  plot.home = H.id;
  plot.face = H.face;
  plot.roofs = [{ x: 0, y: 0, w, h, l: 0, m: L.roof }];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) plot.floor[`${x},${y}`] = L.floor;
  const out = L.outside, inn = L.inside;
  for (let x = 0; x < w; x++) {
    plot.walls[edgeKey(0, 'h', x, 0)] = { m: out, o: inn };
    plot.walls[edgeKey(0, 'h', x, h)] = { m: inn, o: out };
  }
  for (let y = 0; y < h; y++) {
    plot.walls[edgeKey(0, 'v', 0, y)] = { m: out, o: inn };
    plot.walls[edgeKey(0, 'v', w, y)] = { m: inn, o: out };
  }
  // Front door (and a window either side of it), a window in each side wall and one at the back.
  const door = Math.floor(w / 2) - 1, front = north ? 0 : h, back = north ? h : 0;
  plot.walls[edgeKey(0, 'h', door, front)].f = L.door || 'door';
  if (L.door) plot.walls[edgeKey(0, 'h', door + 1, front)].f = L.door;
  plot.walls[edgeKey(0, 'h', 0, front)].f = 'window';
  plot.walls[edgeKey(0, 'h', w - 1, front)].f = 'window';
  plot.walls[edgeKey(0, 'h', w - 2, back)].f = 'window';
  plot.walls[edgeKey(0, 'v', 0, Math.floor(h / 2))].f = 'window';
  plot.walls[edgeKey(0, 'v', w, Math.floor(h / 2))].f = 'window';
  for (const [t, x, y0, r0 = 0] of L.obj) {
    const [, fh] = objSize(t, r0);
    const y = north ? h - y0 - fh : y0, r = north && r0 % 2 === 0 ? (r0 + 2) % 4 : r0;
    plot.obj[`${x},${y}`] = r ? { t, r } : { t };
  }
  return plot;
}

// Every village plot: the shops, the cottages, plus the projects built so far (ids from city data).
export const townShopPlots = (projects = []) => [
  ...SHOPS.map((sh, i) => shopPlot(sh, i)),
  ...HOMES.map((H, i) => homePlot(H, i)),
  ...Object.keys(PROJECTS).map((id, i) => (projects.includes(id) ? projectPlot(id, i) : null)).filter(Boolean),
];
// Where the keeper stands behind the counter (world tiles).
export const keeperSpot = (id) => {
  const sh = SHOPS.find((s) => s.id === id);
  const [x, y] = LAYOUTS[id].keeper;
  return { x: sh.x + x, y: sh.y + y };
};
export const isTownPlot = (plot) => !!plot?.town;

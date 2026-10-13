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

function shopPlot(shop, i) {
  const L = LAYOUTS[shop.id];
  const { w, h } = shop;
  const plot = {
    id: TOWN_PLOT_BASE + i, x: shop.x, y: shop.y, w, h, owner: TOWN_OWNER, ownerName: shop.name, farm: '',
    town: shop.id, name: shop.name, keeper: shop.id, rev: 1,
    floor: {}, obj: {}, l1: { floor: {}, obj: {} }, walls: {}, roofs: [{ x: 0, y: 0, w, h, l: 0, m: L.roof }],
  };
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
  for (const [k, items] of Object.entries(L.stock)) {
    if (plot.obj[k]) plot.obj[k].stock = items.map((item) => ({ item, n: 9, price: GOODS[item]?.value || 0 }));
  }
  return plot;
}

export const townShopPlots = () => SHOPS.map((sh, i) => shopPlot(sh, i));
// Where the keeper stands behind the counter (world tiles).
export const keeperSpot = (id) => {
  const sh = SHOPS.find((s) => s.id === id);
  const [x, y] = LAYOUTS[id].keeper;
  return { x: sh.x + x, y: sh.y + y };
};
export const isTownPlot = (plot) => !!plot?.town;

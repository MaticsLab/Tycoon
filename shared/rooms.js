// Styled rooms: ready-made, furnished rooms you can buy and drop onto your plot in
// one go (like The Sims' styled rooms). Each is a blueprint fragment (see blueprint.js).
import { rectEdges, edgeKey, LEVELS } from './plot.js';
import { fragmentValue } from './blueprint.js';

// w x h room with walls of `wall`, a door in the bottom wall at `door`, windows on the
// given edges, `floor` everywhere and objects [t, x, y, r].
function room(name, icon, { w, h, wall, floor, door, windows = [], objs = [], open = false }) {
  const levels = Array.from({ length: LEVELS }, () => ({ floor: {}, obj: {} }));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) levels[0].floor[`${x},${y}`] = floor;
  for (const [t, x, y, r = 0] of objs) levels[0].obj[`${x},${y}`] = r ? { t, r } : { t };
  const walls = {};
  if (!open) {
    for (const [d, x, y] of rectEdges(0, 0, w, h)) walls[edgeKey(0, d, x, y)] = { m: wall };
    if (door != null) walls[edgeKey(0, 'h', door, h)].f = 'door';
    for (const [d, x, y, f = 'window'] of windows) walls[edgeKey(0, d, x, y)].f = f;
  }
  const frag = { w, h, levels, walls, roofs: [] };
  return { name, icon, frag, price: fragmentValue(frag) };
}

export const STYLED_ROOMS = {
  bedroom: room('Cozy Bedroom', '🛏️', {
    w: 5, h: 4, wall: 'wall_white', floor: 'floor_wood', door: 2, windows: [['h', 1, 0], ['h', 3, 0]],
    objs: [['bed', 1, 0], ['nightstand', 2, 0], ['dresser', 3, 0], ['wardrobe', 4, 0], ['lamp', 4, 2], ['rug', 2, 2], ['houseplant', 0, 3], ['petbed', 4, 3]],
  }),
  // Shower, vanity and toilet along the back wall, each with a free tile in front.
  bathroom: room('Tiled Bathroom', '🛁', {
    w: 4, h: 3, wall: 'wall_white', floor: 'floor_tile', door: 1, windows: [['v', 4, 1]],
    objs: [['shower', 0, 0], ['towelrack', 1, 0], ['sink', 2, 0], ['toilet', 3, 0], ['bathmat', 0, 1], ['monstera', 0, 2], ['candles', 3, 2]],
  }),
  kitchen: room('Country Kitchen', '🍳', {
    w: 5, h: 4, wall: 'wall_white', floor: 'floor_checker', door: 2, windows: [['h', 2, 0]],
    objs: [['fridge', 0, 0], ['stove', 1, 0], ['counter', 2, 0], ['counter', 3, 0], ['lamp', 4, 0], ['table', 1, 2], ['chair', 0, 2, 3], ['chair', 3, 2, 1], ['monstera', 4, 3]],
  }),
  living: room('Living Room', '🛋️', {
    w: 6, h: 5, wall: 'wall_sage', floor: 'floor_wood', door: 3, windows: [['h', 1, 0, 'window_tall'], ['h', 4, 0, 'window_tall']],
    objs: [
      ['bookshelf', 0, 0], ['monstera', 1, 0], ['tv', 2, 0], ['floorvase', 4, 0], ['lamp', 5, 0],
      ['coffeetable', 2, 2], ['sofa', 2, 3, 2], ['armchair', 0, 2, 3], ['endtable', 0, 3],
      ['rug', 4, 1], ['beanbag', 5, 3], ['houseplant', 5, 4],
    ],
  }),
  study: room('Quiet Study', '📚', {
    w: 4, h: 3, wall: 'wall_wood', floor: 'floor_red', door: 1, windows: [['v', 0, 1]],
    objs: [['bookshelf', 0, 0], ['bookshelf', 1, 0], ['desk', 2, 0], ['chair', 2, 1, 2], ['armchair', 3, 1, 1], ['lamp', 0, 2], ['houseplant', 3, 2]],
  }),
  patio: room('Garden Patio', '🌻', {
    w: 4, h: 4, floor: 'floor_stone', open: true,
    objs: [['bench', 1, 0], ['lamppost', 0, 0], ['flowerbed', 3, 0], ['bush', 0, 3], ['flowerbed', 1, 3], ['flowerbed', 2, 3], ['bush', 3, 3]],
  }),
  // Arcade, records and books along the back wall with a free row in front of them.
  gameroom: room('Game Room', '🎮', {
    w: 5, h: 4, wall: 'wall_blue', floor: 'floor_blue', door: 2, windows: [['h', 2, 0]],
    objs: [['arcade', 0, 0], ['recordplayer', 1, 0], ['cattree', 2, 0], ['lowshelf', 3, 0], ['pouf', 3, 2], ['loveseat', 0, 3, 2], ['cactus', 3, 3], ['arclamp', 4, 3]],
  }),
  laundry: room('Laundry Nook', '🧺', {
    w: 3, h: 3, wall: 'wall_white', floor: 'floor_tile', door: 1, windows: [['v', 3, 1]],
    objs: [['washer', 0, 0], ['dryer', 1, 0], ['pedestalsink', 2, 0], ['succulents', 0, 2], ['houseplant', 2, 2]],
  }),
  backyard: room('Backyard Picnic', '🌭', {
    w: 5, h: 4, floor: 'floor_stone', open: true,
    objs: [
      ['stonelantern', 0, 0], ['flowerbed', 1, 0], ['flowerbed', 2, 0], ['grill', 4, 0], ['picnic', 1, 1],
      ['firepit', 4, 2], ['birdbath', 0, 3], ['gnome', 1, 3], ['hammock', 2, 3],
    ],
  }),
};

// Everything a player can place on their plot.
//   layer: 'floor' (one per tile, walkable) or 'obj' (one per tile, drawn on top)
//   solid: blocks movement     wall: drawn as a tall wall piece
//   light: glows at night      crop: seed that must go on tilled soil
export const CATEGORIES = [
  { id: 'build', name: 'Walls' },
  { id: 'floor', name: 'Floors' },
  { id: 'furniture', name: 'Furniture' },
  { id: 'garden', name: 'Garden' },
  { id: 'farm', name: 'Farm' },
];

export const ITEMS = {
  wall_wood:     { name: 'Wood Wall',    cat: 'build', layer: 'obj', price: 12, solid: true, wall: true },
  wall_brick:    { name: 'Brick Wall',   cat: 'build', layer: 'obj', price: 18, solid: true, wall: true },
  wall_white:    { name: 'Plaster Wall', cat: 'build', layer: 'obj', price: 15, solid: true, wall: true },
  window:        { name: 'Window',       cat: 'build', layer: 'obj', price: 20, solid: true, wall: true },
  door:          { name: 'Door',         cat: 'build', layer: 'obj', price: 25, solid: false, wall: true },

  floor_wood:    { name: 'Wood Floor',   cat: 'floor', layer: 'floor', price: 4 },
  floor_tile:    { name: 'Tile Floor',   cat: 'floor', layer: 'floor', price: 5 },
  floor_checker: { name: 'Checker Tile', cat: 'floor', layer: 'floor', price: 6 },
  floor_red:     { name: 'Red Carpet',   cat: 'floor', layer: 'floor', price: 6 },
  floor_blue:    { name: 'Blue Carpet',  cat: 'floor', layer: 'floor', price: 6 },
  floor_stone:   { name: 'Stone Path',   cat: 'floor', layer: 'floor', price: 3 },

  bed:           { name: 'Bed',          cat: 'furniture', layer: 'obj', price: 60, solid: true },
  table:         { name: 'Table',        cat: 'furniture', layer: 'obj', price: 30, solid: true },
  chair:         { name: 'Chair',        cat: 'furniture', layer: 'obj', price: 15 },
  sofa:          { name: 'Sofa',         cat: 'furniture', layer: 'obj', price: 50, solid: true },
  armchair:      { name: 'Armchair',     cat: 'furniture', layer: 'obj', price: 30, solid: true },
  rug:           { name: 'Rug',          cat: 'furniture', layer: 'obj', price: 20, flat: true },
  lamp:          { name: 'Lamp',         cat: 'furniture', layer: 'obj', price: 20, solid: true, light: true },
  bookshelf:     { name: 'Bookshelf',    cat: 'furniture', layer: 'obj', price: 40, solid: true },
  tv:            { name: 'TV',           cat: 'furniture', layer: 'obj', price: 80, solid: true },
  fridge:        { name: 'Fridge',       cat: 'furniture', layer: 'obj', price: 70, solid: true },
  stove:         { name: 'Stove',        cat: 'furniture', layer: 'obj', price: 65, solid: true },
  counter:       { name: 'Counter',      cat: 'furniture', layer: 'obj', price: 25, solid: true },
  dresser:       { name: 'Dresser',      cat: 'furniture', layer: 'obj', price: 35, solid: true },
  bathtub:       { name: 'Bathtub',      cat: 'furniture', layer: 'obj', price: 60, solid: true },
  toilet:        { name: 'Toilet',       cat: 'furniture', layer: 'obj', price: 30, solid: true },
  houseplant:    { name: 'House Plant',  cat: 'furniture', layer: 'obj', price: 12, solid: true },

  flowerbed:     { name: 'Flower Bed',   cat: 'garden', layer: 'obj', price: 8, flat: true },
  bush:          { name: 'Bush',         cat: 'garden', layer: 'obj', price: 10, solid: true },
  sapling:       { name: 'Young Tree',   cat: 'garden', layer: 'obj', price: 20, solid: true },
  picket:        { name: 'Picket Fence', cat: 'garden', layer: 'obj', price: 6, solid: true },
  lamppost:      { name: 'Lamp Post',    cat: 'garden', layer: 'obj', price: 30, solid: true, light: true },
  bench:         { name: 'Bench',        cat: 'garden', layer: 'obj', price: 25, solid: true },
  mailbox:       { name: 'Mailbox',      cat: 'garden', layer: 'obj', price: 15, solid: true },

  soil:          { name: 'Tilled Soil',  cat: 'farm', layer: 'floor', price: 2 },
  seed_turnip:   { name: 'Turnip Seeds', cat: 'farm', layer: 'obj', price: 5, crop: 'turnip' },
  seed_carrot:   { name: 'Carrot Seeds', cat: 'farm', layer: 'obj', price: 10, crop: 'carrot' },
  seed_berry:    { name: 'Strawberry',   cat: 'farm', layer: 'obj', price: 18, crop: 'berry' },
  seed_pumpkin:  { name: 'Pumpkin Seeds', cat: 'farm', layer: 'obj', price: 30, crop: 'pumpkin' },
  scarecrow:     { name: 'Scarecrow',    cat: 'farm', layer: 'obj', price: 15, solid: true },
};

export const CROPS = {
  turnip:  { name: 'Turnip',     growMs: 60_000,  sell: 14 },
  carrot:  { name: 'Carrot',     growMs: 180_000, sell: 32 },
  berry:   { name: 'Strawberry', growMs: 360_000, sell: 60 },
  pumpkin: { name: 'Pumpkin',    growMs: 720_000, sell: 130 },
};

export const START_COINS = 500;

// 0..3, where 3 is ripe.
export function cropStage(obj, now) {
  const crop = CROPS[ITEMS[obj.t]?.crop];
  if (!crop) return 0;
  const f = (now - (obj.p || 0)) / crop.growMs;
  return f >= 1 ? 3 : Math.min(2, Math.floor(f * 3));
}

// Shared placement rule so the client can preview what the server will accept.
// Returns null when OK, or a short reason string.
export function placementError(plotState, lx, ly, itemId) {
  const item = ITEMS[itemId];
  if (!item) return 'Unknown item';
  const k = `${lx},${ly}`;
  const floor = plotState.floor[k];
  const obj = plotState.obj[k];
  if (item.layer === 'floor') {
    if (floor === itemId) return 'Already there';
    if (obj && ITEMS[obj.t]?.crop) return 'Harvest the crop first';
    if (floor === 'soil' && obj) return 'Clear it first';
    return null;
  }
  if (obj) return 'Tile is occupied';
  if (item.crop && floor !== 'soil') return 'Seeds need tilled soil';
  return null;
}

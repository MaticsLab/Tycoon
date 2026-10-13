// Everything a player can place on their plot.
//   layer: 'floor' (one per tile, walkable), 'obj' (furniture etc. on a tile),
//          'wall' (a wall segment on a tile edge, priced per segment),
//          'feature' (a door or window set into an existing wall segment),
//          'roof' (a roof over a rectangle, priced per tile covered)
//   size:  [w, h] footprint in tiles when unrotated (default 1x1)
//   rot:   'none' (looks the same every way), 'turn' (top-down, footprint turns),
//          'face' (has front/back/side art)
//   solid: blocks movement     wall: tall wall piece     light: glows at night
//   crop:  seed that must go on tilled soil
//   stairs: walkable between floors; climbs away from its front (see plot.js)
//   shop:  only sold by that NPC; bought into your bag, placed from the Bag tab
//   cat 'public': props for the village's public places, never for sale
export const CATEGORIES = [
  { id: 'build', name: 'Walls & Stairs' },
  { id: 'opening', name: 'Doors & Windows' },
  { id: 'floor', name: 'Floors' },
  { id: 'roof', name: 'Roofs' },
  { id: 'furniture', name: 'Furniture' },
  { id: 'kitchen', name: 'Kitchen & Bath' },
  { id: 'decor', name: 'Decor' },
  { id: 'shop', name: 'Shop & Machines' },
  { id: 'utility', name: 'Water, Power & Automation' },
  { id: 'garden', name: 'Garden' },
  { id: 'fall', name: 'Fall & Halloween' },
  { id: 'farm', name: 'Farm' },
];

export const ITEMS = {
  wall_wood:     { name: 'Log Cabin',    cat: 'build', layer: 'wall', price: 10, color: '#a8703f' },
  wall_white:    { name: 'Plaster',      cat: 'build', layer: 'wall', price: 12, color: '#ece4d2' },
  wall_brick:    { name: 'Red Brick',    cat: 'build', layer: 'wall', price: 16, color: '#b0533c' },
  wall_stone:    { name: 'Fieldstone',   cat: 'build', layer: 'wall', price: 18, color: '#a9a294' },
  wall_blue:     { name: 'Blue Siding',  cat: 'build', layer: 'wall', price: 14, color: '#7fa7c9' },
  wall_sage:     { name: 'Sage Siding',  cat: 'build', layer: 'wall', price: 14, color: '#9cb88a' },
  wall_shiplap:  { name: 'White Shiplap', cat: 'build', layer: 'wall', price: 14, color: '#f2efe6' },
  wall_stucco:   { name: 'Warm Stucco',   cat: 'build', layer: 'wall', price: 15, color: '#e8c9a0' },
  wall_shingle:  { name: 'Cedar Shingles', cat: 'build', layer: 'wall', price: 18, color: '#a8683a' },
  wall_board:    { name: 'Board & Batten', cat: 'build', layer: 'wall', price: 16, color: '#4f7a5a' },
  wall_paintbrick: { name: 'Painted Brick', cat: 'build', layer: 'wall', price: 18, color: '#e9e4da' },
  wall_darkstone: { name: 'Slate Stone',  cat: 'build', layer: 'wall', price: 20, color: '#5d6470' },
  wall_shopfront: { name: 'Shopfront Panel', cat: 'build', layer: 'wall', price: 22, color: '#2f4f6a' },
  wall_subway:   { name: 'Subway Tile',   cat: 'build', layer: 'wall', price: 16, color: '#f4f6f7' },
  wall_paper:    { name: 'Floral Wallpaper', cat: 'build', layer: 'wall', price: 14, color: '#e8c3c9' },
  wall_wainscot: { name: 'Wainscoting',   cat: 'build', layer: 'wall', price: 17, color: '#c9dcc4' },

  stairs:        { name: 'Staircase',    cat: 'build', layer: 'obj', price: 120, size: [1, 3], rot: 'face', stairs: true },

  door:          { name: 'Wood Door',    cat: 'opening', layer: 'feature', price: 25, passable: true },
  door_glass:    { name: 'French Door',  cat: 'opening', layer: 'feature', price: 45, passable: true },
  arch:          { name: 'Open Archway', cat: 'opening', layer: 'feature', price: 15, passable: true },
  window:        { name: 'Window',       cat: 'opening', layer: 'feature', price: 20 },
  window_tall:   { name: 'Tall Window',  cat: 'opening', layer: 'feature', price: 30 },
  // Shopfronts: storefront windows join into one glass wall when side by side; double
  // doors are two segments wide (width: 2).
  window_shop:   { name: 'Storefront Window', cat: 'opening', layer: 'feature', price: 40 },
  door_shop:     { name: 'Glass Shop Door', cat: 'opening', layer: 'feature', price: 55, passable: true },
  door_double:   { name: 'Double Door',    cat: 'opening', layer: 'feature', price: 70, passable: true, width: 2 },
  door_shopdouble: { name: 'Shopfront Double Doors', cat: 'opening', layer: 'feature', price: 110, passable: true, width: 2 },

  roof_red:      { name: 'Red Shingles',  cat: 'roof', layer: 'roof', price: 3, color: '#b2412f' },
  roof_blue:     { name: 'Slate Blue',    cat: 'roof', layer: 'roof', price: 3, color: '#3f5f86' },
  roof_green:    { name: 'Moss Green',    cat: 'roof', layer: 'roof', price: 3, color: '#4f7a3a' },
  roof_thatch:   { name: 'Thatch',        cat: 'roof', layer: 'roof', price: 2, color: '#c9a24c' },
  roof_glass:    { name: 'Greenhouse Glass', cat: 'roof', layer: 'roof', price: 6, color: '#a9d8e8' },

  floor_wood:    { name: 'Wood Floor',   cat: 'floor', layer: 'floor', price: 4 },
  floor_tile:    { name: 'Tile Floor',   cat: 'floor', layer: 'floor', price: 5 },
  floor_checker: { name: 'Checker Tile', cat: 'floor', layer: 'floor', price: 6 },
  floor_red:     { name: 'Red Carpet',   cat: 'floor', layer: 'floor', price: 6 },
  floor_blue:    { name: 'Blue Carpet',  cat: 'floor', layer: 'floor', price: 6 },
  floor_stone:   { name: 'Stone Path',   cat: 'floor', layer: 'floor', price: 3 },

  bed:           { name: 'Bed',          cat: 'furniture', layer: 'obj', price: 60, solid: true, size: [1, 2], rot: 'turn' },
  table:         { name: 'Dining Table', cat: 'furniture', layer: 'obj', price: 30, solid: true, size: [2, 1], rot: 'turn' },
  chair:         { name: 'Chair',        cat: 'furniture', layer: 'obj', price: 15, rot: 'face' },
  sofa:          { name: 'Sofa',         cat: 'furniture', layer: 'obj', price: 50, solid: true, size: [2, 1], rot: 'face' },
  armchair:      { name: 'Armchair',     cat: 'furniture', layer: 'obj', price: 30, solid: true, rot: 'face' },
  rug:           { name: 'Rug',          cat: 'furniture', layer: 'obj', price: 20, flat: true, size: [2, 2], rot: 'turn' },
  lamp:          { name: 'Lamp',         cat: 'furniture', layer: 'obj', price: 20, solid: true, light: true },
  bookshelf:     { name: 'Bookshelf',    cat: 'furniture', layer: 'obj', price: 40, solid: true },
  tv:            { name: 'TV',           cat: 'furniture', layer: 'obj', price: 80, solid: true, rot: 'face' },
  fridge:        { name: 'Fridge',       cat: 'kitchen', layer: 'obj', price: 70, solid: true },
  stove:         { name: 'Stove',        cat: 'kitchen', layer: 'obj', price: 65, solid: true },
  counter:       { name: 'Counter',      cat: 'kitchen', layer: 'obj', price: 25, solid: true },
  dresser:       { name: 'Dresser',      cat: 'furniture', layer: 'obj', price: 35, solid: true },
  bathtub:       { name: 'Bathtub',      cat: 'kitchen', layer: 'obj', price: 60, solid: true, size: [2, 1], rot: 'turn' },
  toilet:        { name: 'Toilet',       cat: 'kitchen', layer: 'obj', price: 30, solid: true, rot: 'face' },
  shower:        { name: 'Shower',       cat: 'kitchen', layer: 'obj', price: 70, solid: true, rot: 'face' },
  sink:          { name: 'Vanity Sink',  cat: 'kitchen', layer: 'obj', price: 40, solid: true, rot: 'face' },
  towelrack:     { name: 'Towel Rack',   cat: 'kitchen', layer: 'obj', price: 15, solid: true, rot: 'face' },
  bathmat:       { name: 'Bath Mat',     cat: 'kitchen', layer: 'obj', price: 8, flat: true, rot: 'turn' },
  nightstand:    { name: 'Nightstand',   cat: 'decor', layer: 'obj', price: 20, solid: true, rot: 'face' },
  wardrobe:      { name: 'Wardrobe',     cat: 'decor', layer: 'obj', price: 55, solid: true, rot: 'face' },
  coffeetable:   { name: 'Coffee Table', cat: 'decor', layer: 'obj', price: 25, solid: true, size: [2, 1], rot: 'turn' },
  endtable:      { name: 'End Table',    cat: 'decor', layer: 'obj', price: 15, solid: true },
  desk:          { name: 'Desk',         cat: 'decor', layer: 'obj', price: 45, solid: true, size: [2, 1], rot: 'face' },
  beanbag:       { name: 'Bean Bag',     cat: 'decor', layer: 'obj', price: 20, solid: true },
  floorvase:     { name: 'Floor Vase',   cat: 'decor', layer: 'obj', price: 18, solid: true },
  candles:       { name: 'Candles',      cat: 'decor', layer: 'obj', price: 10, light: true },
  monstera:      { name: 'Monstera',     cat: 'decor', layer: 'obj', price: 22, solid: true },
  petbed:        { name: 'Pet Bed',      cat: 'furniture', layer: 'obj', price: 25 },
  houseplant:    { name: 'House Plant',  cat: 'furniture', layer: 'obj', price: 12, solid: true },

  flowerbed:     { name: 'Flower Bed',   cat: 'garden', layer: 'obj', price: 8, flat: true },
  bush:          { name: 'Bush',         cat: 'garden', layer: 'obj', price: 10, solid: true },
  sapling:       { name: 'Young Tree',   cat: 'garden', layer: 'obj', price: 20, solid: true },
  picket:        { name: 'Picket Fence', cat: 'garden', layer: 'obj', price: 6, solid: true },
  lamppost:      { name: 'Lamp Post',    cat: 'garden', layer: 'obj', price: 30, solid: true, light: true },
  bench:         { name: 'Bench',        cat: 'garden', layer: 'obj', price: 25, solid: true, size: [2, 1], rot: 'turn' },
  mailbox:       { name: 'Mailbox',      cat: 'garden', layer: 'obj', price: 15, solid: true },

  // More furniture and decorations.
  recliner:      { name: 'Recliner',        cat: 'furniture', layer: 'obj', price: 55, solid: true, rot: 'face' },
  loveseat:      { name: 'Spindle Loveseat', cat: 'furniture', layer: 'obj', price: 45, solid: true, size: [2, 1], rot: 'face' },
  pouf:          { name: 'Knitted Pouf',    cat: 'furniture', layer: 'obj', price: 15 },
  lowshelf:      { name: 'Low Bookcase',    cat: 'furniture', layer: 'obj', price: 45, solid: true, size: [2, 1], rot: 'face' },
  recordplayer:  { name: 'Record Player',   cat: 'furniture', layer: 'obj', price: 65, solid: true, rot: 'face' },
  arcade:        { name: 'Arcade Cabinet',  cat: 'furniture', layer: 'obj', price: 150, solid: true, rot: 'face' },
  arclamp:       { name: 'Arc Floor Lamp',  cat: 'furniture', layer: 'obj', price: 35, solid: true, rot: 'face', light: true },
  bunkbed:       { name: 'Bunk Bed',        cat: 'furniture', layer: 'obj', price: 90, solid: true, size: [1, 2], rot: 'turn' },
  rockingchair:  { name: 'Rocking Chair',   cat: 'furniture', layer: 'obj', price: 35, solid: true, rot: 'face' },
  vanity:        { name: 'Vanity Table',    cat: 'furniture', layer: 'obj', price: 50, solid: true, rot: 'face' },
  island:        { name: 'Kitchen Island',  cat: 'kitchen', layer: 'obj', price: 75, solid: true, size: [2, 1], rot: 'turn' },
  kitchensink:   { name: 'Kitchen Sink',    cat: 'kitchen', layer: 'obj', price: 45, solid: true, rot: 'face' },
  dishwasher:    { name: 'Dishwasher',      cat: 'kitchen', layer: 'obj', price: 55, solid: true, rot: 'face' },
  barstool:      { name: 'Bar Stool',       cat: 'kitchen', layer: 'obj', price: 15 },
  washer:        { name: 'Washing Machine', cat: 'kitchen', layer: 'obj', price: 60, solid: true, rot: 'face' },
  dryer:         { name: 'Tumble Dryer',    cat: 'kitchen', layer: 'obj', price: 55, solid: true, rot: 'face' },
  pedestalsink:  { name: 'Pedestal Sink',   cat: 'kitchen', layer: 'obj', price: 30, solid: true, rot: 'face' },
  cactus:        { name: 'Potted Cactus',   cat: 'decor', layer: 'obj', price: 14, solid: true },
  succulents:    { name: 'Succulent Trio',  cat: 'decor', layer: 'obj', price: 12 },
  globe:         { name: 'Globe',           cat: 'decor', layer: 'obj', price: 30, solid: true },
  easel:         { name: 'Painting Easel',  cat: 'decor', layer: 'obj', price: 40, solid: true, rot: 'face' },
  fishbowl:      { name: 'Fishbowl',        cat: 'decor', layer: 'obj', price: 35, solid: true },
  lantern:       { name: 'Candle Lantern',  cat: 'decor', layer: 'obj', price: 18, light: true },
  cattree:       { name: 'Cat Tree',        cat: 'decor', layer: 'obj', price: 40, solid: true },
  picnic:        { name: 'Picnic Table',    cat: 'garden', layer: 'obj', price: 45, solid: true, size: [2, 1], rot: 'turn' },
  grill:         { name: 'BBQ Grill',       cat: 'garden', layer: 'obj', price: 70, solid: true, rot: 'face' },
  birdbath:      { name: 'Birdbath',        cat: 'garden', layer: 'obj', price: 25, solid: true },
  gnome:         { name: 'Garden Gnome',    cat: 'garden', layer: 'obj', price: 12, rot: 'face' },
  hammock:       { name: 'Hammock',         cat: 'garden', layer: 'obj', price: 55, solid: true, size: [2, 1], rot: 'turn' },
  trellis:       { name: 'Rose Arch',       cat: 'garden', layer: 'obj', price: 40, rot: 'face' },
  firepit:       { name: 'Fire Pit',        cat: 'garden', layer: 'obj', price: 65, solid: true, light: true },
  stonelantern:  { name: 'Stone Lantern',   cat: 'garden', layer: 'obj', price: 40, solid: true, light: true },

  pumpkin_deco:  { name: 'Pumpkin',       cat: 'fall', layer: 'obj', price: 12 },
  jackolantern:  { name: 'Jack-o’-Lantern', cat: 'fall', layer: 'obj', price: 25, solid: true, light: true, rot: 'face' },
  haybale:       { name: 'Hay Bale',      cat: 'fall', layer: 'obj', price: 18, solid: true, size: [2, 1], rot: 'turn' },
  cornstalks:    { name: 'Corn Stalks',   cat: 'fall', layer: 'obj', price: 10, solid: true },
  leafpile:      { name: 'Leaf Pile',     cat: 'fall', layer: 'obj', price: 6, flat: true },
  gravestone:    { name: 'Spooky Gravestone', cat: 'fall', layer: 'obj', price: 30, solid: true, rot: 'face' },
  cauldron:      { name: 'Bubbling Cauldron', cat: 'fall', layer: 'obj', price: 45, solid: true, light: true },
  ironfence:     { name: 'Iron Fence',    cat: 'fall', layer: 'obj', price: 12, solid: true, rot: 'turn' },

  flagpole:      { name: 'Flagpole',      cat: 'public', layer: 'obj', price: 0, solid: true },
  noticeboard:   { name: 'Notice Board',  cat: 'public', layer: 'obj', price: 0, solid: true, size: [2, 1] },
  ballotbox:     { name: 'Ballot Box',    cat: 'public', layer: 'obj', price: 0, solid: true },
  gazebo:        { name: 'Gazebo',        cat: 'public', layer: 'obj', price: 0, solid: true, size: [4, 4] },
  stall:         { name: 'Market Stall',  cat: 'public', layer: 'obj', price: 0, solid: true, size: [3, 2] },

  soil:          { name: 'Tilled Soil',  cat: 'farm', layer: 'floor', price: 2 },
  soil_rich:     { name: 'Rich Soil',    cat: 'farm', layer: 'floor', price: 14 },   // fertilised: better crops
  seed_turnip:   { name: 'Turnip Seeds', cat: 'farm', layer: 'obj', price: 5, crop: 'turnip' },
  seed_carrot:   { name: 'Carrot Seeds', cat: 'farm', layer: 'obj', price: 10, crop: 'carrot' },
  seed_berry:    { name: 'Strawberry',   cat: 'farm', layer: 'obj', price: 18, crop: 'berry' },
  seed_pumpkin:  { name: 'Pumpkin Seeds', cat: 'farm', layer: 'obj', price: 30, crop: 'pumpkin' },
  seed_wheat:    { name: 'Wheat Seeds',  cat: 'farm', layer: 'obj', price: 4, crop: 'wheat' },
  seed_corn:     { name: 'Corn Seeds',   cat: 'farm', layer: 'obj', price: 14, crop: 'corn' },
  seed_melon:    { name: 'Melon Seeds',  cat: 'farm', layer: 'obj', price: 35, crop: 'melon' },
  seed_kale:     { name: 'Kale Seeds',   cat: 'farm', layer: 'obj', price: 12, crop: 'kale' },
  // Animal houses: buy animals from the coop / barn, feed them hay or wheat every day,
  // collect what they make the next morning.
  coop:          { name: 'Chicken Coop', cat: 'farm', layer: 'obj', price: 400, solid: true, size: [2, 2], rot: 'face', animals: ['chicken'], cap: 4 },
  barn:          { name: 'Barn',         cat: 'farm', layer: 'obj', price: 1200, solid: true, size: [3, 3], rot: 'face', animals: ['cow', 'sheep'], cap: 4 },
  scarecrow:     { name: 'Scarecrow',    cat: 'farm', layer: 'obj', price: 15, solid: true },

  // Business: shelves hold stock for sale (slots), the register lets you be the cashier,
  // machines turn crops into products (see shared/business.js).
  shelf:         { name: 'Shop Shelf',     cat: 'shop', layer: 'obj', price: 40, solid: true, rot: 'face', slots: 3 },
  producestand:  { name: 'Produce Stand',  cat: 'shop', layer: 'obj', price: 55, solid: true, size: [2, 1], rot: 'face', slots: 4 },
  displaytable:  { name: 'Display Table',  cat: 'shop', layer: 'obj', price: 45, solid: true, size: [2, 1], rot: 'turn', slots: 4 },
  coolercase:    { name: 'Chilled Case',   cat: 'shop', layer: 'obj', price: 90, solid: true, rot: 'face', slots: 3, light: true },
  register:      { name: 'Cash Register',  cat: 'shop', layer: 'obj', price: 120, solid: true, rot: 'face' },
  shopsign:      { name: 'Shop Sign',      cat: 'shop', layer: 'obj', price: 25, solid: true, rot: 'face' },
  preservesjar:  { name: 'Preserves Jar',  cat: 'shop', layer: 'obj', price: 60, solid: true, machine: true },
  juicer:        { name: 'Juice Press',    cat: 'shop', layer: 'obj', price: 75, solid: true, rot: 'face', machine: true },
  bakeryoven:    { name: 'Bakery Oven',    cat: 'shop', layer: 'obj', price: 140, solid: true, rot: 'face', machine: true, light: true },
  soupot:        { name: 'Soup Pot',       cat: 'shop', layer: 'obj', price: 50, solid: true, machine: true },
  cheesepress:   { name: 'Cheese Press',   cat: 'shop', layer: 'obj', price: 160, solid: true, rot: 'face', machine: true },
  loom:          { name: 'Loom',           cat: 'shop', layer: 'obj', price: 220, solid: true, size: [2, 1], rot: 'face', machine: true },

  // Utilities and automation. Spouts and power boxes come from City Hall (Mabel) when you
  // sign up for water or electricity; they live in your bag until you place them. Pipes and cables carry
  // them to things that need them (needs: 'water' | 'power').
  spout:         { name: 'Ground Spout',   cat: 'utility', layer: 'obj', price: 60, solid: true, utility: 'water', shop: 'mabel' },
  powerbox:      { name: 'Power Box',      cat: 'utility', layer: 'obj', price: 90, solid: true, rot: 'face', utility: 'power', shop: 'mabel' },
  pipe:          { name: 'Water Pipe',     cat: 'utility', layer: 'obj', price: 3, flat: true, carries: 'water' },
  cable:         { name: 'Power Cable',    cat: 'utility', layer: 'obj', price: 3, flat: true, carries: 'power' },
  sprinkler:     { name: 'Sprinkler',      cat: 'utility', layer: 'obj', price: 45, needs: 'water', reach: 1 },
  bigsprinkler:  { name: 'Big Sprinkler',  cat: 'utility', layer: 'obj', price: 120, needs: 'water', reach: 2 },
  harvester:     { name: 'Auto-Harvester', cat: 'utility', layer: 'obj', price: 260, solid: true, needs: 'power', reach: 3 },
  tractor:       { name: 'Tractor',        cat: 'utility', layer: 'obj', price: 650, solid: true, size: [1, 2], rot: 'turn' },

  // Otto's Furniture exclusives.
  piano:         { name: 'Grand Piano',  cat: 'special', layer: 'obj', price: 260, solid: true, size: [2, 1], rot: 'face', shop: 'otto' },
  fireplace:     { name: 'Fireplace',    cat: 'special', layer: 'obj', price: 180, solid: true, size: [2, 1], rot: 'face', shop: 'otto', light: true },
  aquarium:      { name: 'Aquarium',     cat: 'special', layer: 'obj', price: 220, solid: true, size: [2, 1], rot: 'turn', shop: 'otto' },
  grandclock:    { name: 'Grandfather Clock', cat: 'special', layer: 'obj', price: 150, solid: true, shop: 'otto' },
  telescope:     { name: 'Telescope',    cat: 'special', layer: 'obj', price: 200, solid: true, shop: 'otto' },
  statue:        { name: 'Garden Statue', cat: 'special', layer: 'obj', price: 240, solid: true, shop: 'otto' },
};

// Things that live in your bag but can't be placed: produce and gifts.
export const GOODS = {
  turnip:    { name: 'Turnip',     kind: 'produce', value: 14, icon: '🥔' },
  carrot:    { name: 'Carrot',     kind: 'produce', value: 32, icon: '🥕' },
  berry:     { name: 'Strawberry', kind: 'produce', value: 60, icon: '🍓' },
  pumpkin:   { name: 'Pumpkin',    kind: 'produce', value: 130, icon: '🎃' },
  bouquet:   { name: 'Bouquet',    kind: 'gift', value: 25, icon: '💐' },
  honeycake: { name: 'Honey Cake', kind: 'gift', value: 40, icon: '🍰' },
  tea:       { name: 'Herbal Tea', kind: 'gift', value: 15, icon: '🍵' },
  bookgift:  { name: 'Old Novel',  kind: 'gift', value: 35, icon: '📕' },
  // Products made in machines (see shared/business.js).
  jam:       { name: 'Strawberry Jam', kind: 'product', value: 150, icon: '🍓' },
  juice:     { name: 'Carrot Juice',   kind: 'product', value: 85, icon: '🧃' },
  pie:       { name: 'Pumpkin Pie',    kind: 'product', value: 320, icon: '🥧' },
  bread:     { name: 'Turnip Bread',   kind: 'product', value: 60, icon: '🍞' },
  soup:      { name: 'Veggie Soup',    kind: 'product', value: 75, icon: '🍲' },
  wheat:     { name: 'Wheat',      kind: 'produce', value: 20, icon: '🌾' },
  corn:      { name: 'Corn',       kind: 'produce', value: 45, icon: '🌽' },
  melon:     { name: 'Melon',      kind: 'produce', value: 150, icon: '🍈' },
  kale:      { name: 'Kale',       kind: 'produce', value: 50, icon: '🥬' },
  egg:       { name: 'Egg',        kind: 'animal', value: 30, icon: '🥚' },
  milk:      { name: 'Milk',       kind: 'animal', value: 65, icon: '🥛' },
  wool:      { name: 'Wool',       kind: 'animal', value: 120, icon: '🧶' },
  hay:       { name: 'Hay',        kind: 'feed', value: 8, icon: '🌿' },
  cheese:    { name: 'Cheese',         kind: 'product', value: 230, icon: '🧀' },
  cloth:     { name: 'Cloth',          kind: 'product', value: 330, icon: '🧵' },
  cake:      { name: 'Farmhouse Cake', kind: 'product', value: 380, icon: '🎂' },
  // Tools: kept in the bag.
  wateringcan: { name: 'Watering Can', kind: 'tool', value: 40, icon: '🚿' },
};

export const CROPS = {
  turnip:  { name: 'Turnip',     growMs: 60_000 },
  carrot:  { name: 'Carrot',     growMs: 180_000 },
  berry:   { name: 'Strawberry', growMs: 360_000 },
  pumpkin: { name: 'Pumpkin',    growMs: 720_000 },
  wheat:   { name: 'Wheat',      growMs: 120_000 },
  corn:    { name: 'Corn',       growMs: 240_000 },
  melon:   { name: 'Melon',      growMs: 600_000 },
  kale:    { name: 'Kale',       growMs: 300_000 },
};
// Watered crops grow twice as fast while the soil is wet: o.wf..o.wu is the current wet
// spell, o.b the head start banked from earlier ones.

export const START_COINS = 500;

export const itemName = (id) => ITEMS[id]?.name || GOODS[id]?.name || id;

export const isWet = (obj, now) => !!obj.wu && obj.wu > now;
export const isSoil = (f) => f === 'soil' || f === 'soil_rich';
// The head start a crop got from being watered (ms).
export function wetBonus(obj, now) {
  const wet = obj.wu ? Math.max(0, Math.min(now, obj.wu) - Math.max(obj.wf || 0, obj.p || 0)) : 0;
  return (obj.b || 0) + wet;
}

// 0..3, where 3 is ripe.
export function cropStage(obj, now) {
  const crop = CROPS[ITEMS[obj.t]?.crop];
  if (!crop) return 0;
  const f = (now - (obj.p || 0) + wetBonus(obj, now)) / crop.growMs;
  return f >= 1 ? 3 : Math.min(2, Math.floor(f * 3));
}

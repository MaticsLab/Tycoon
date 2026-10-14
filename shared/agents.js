// Villagers as agents: how each one talks (diction and catchphrases), what they dream of
// building, and the blueprints for the shops and getaways they put up on real lots, a
// stage at a time. The minds that use all this live in worker/src/agents.js.
import { edgeKey, inInterior, roadIn, placementError } from './plot.js';
import { ITEMS } from './catalog.js';

// How they talk. `diction` goes into every prompt; `quirks` are lines they really say
// (used when the AI is away, and as flavour for it).
export const VOICES = {
  rosa: { diction: 'Warm, rapid-fire, auntie-ish. Calls everyone “dear” or “sweetheart”, asks if you’ve eaten, food metaphors, ends with a little tsk.', quirks: ['Have you eaten, dear?', 'Tsk, look at you, all skin and bones.', 'Now THAT is a juicy bit of news.'] },
  otto: { diction: 'Clipped and gruff. Short sentences. Rarely uses more than ten words. Woodworking terms. Says “Hm.” a lot. Never exclaims.', quirks: ['Hm.', 'Measure twice. Cut once.', 'Fine. But I’m not smiling.'] },
  juniper: { diction: 'Breathless and dreamy, lots of “oh!” and trailing thoughts, speaks of plants as people, occasional emoji-like sounds (“ooh”).', quirks: ['Oh! The tulips will be thrilled.', 'The snails are up to something, I can feel it.', 'Ooh, do you hear that? It’s the ferns gossiping.'] },
  mabel: { diction: 'Formal civil-servant register: “per regulation”, “duly noted”, precise numbers, alphabetised lists, cheery bureaucratic enthusiasm.', quirks: ['Duly noted!', 'There is a form for that.', 'Statistically speaking, that is delightful.'] },
  hazel: { diction: 'Laconic, salty, drops words (“Fish biting. Good day.”), nautical proverbs she invents, never more than two sentences.', quirks: ['Red sky, wet socks.', 'Seen bigger.', 'Pond’s calm. So am I.'] },
  bram: { diction: 'LOUD and hearty. Capitalises words for emphasis, laughs “HA!”, everything is forged, hammered or tempered, calls people “friend”.', quirks: ['HA! Good one, friend!', 'Strike while the iron’s hot!', 'That’s the spirit, tempered and true!'] },
  willa: { diction: 'Quiet, precise, literary. Uses semicolons in speech, quotes books, polite little cutting remarks, says “strictly speaking”.', quirks: ['Strictly speaking, that’s chapter three.', 'Overdue, I’m afraid; like most things.', 'How very Dickensian.'] },
  ellis: { diction: 'Calm bedside manner, gentle questions, prescribes silly remedies (“two naps, call me in the morning”), reassuring.', quirks: ['Deep breath. Good.', 'Doctor’s orders: one cup of tea.', 'Any dizziness? No? Splendid.'] },
  pip: { diction: 'Eight years old: run-on sentences with “and then”, “actually”, wild made-up facts, dares, ALL CAPS when excited.', quirks: ['Actually, frogs can talk but only on Tuesdays.', 'I DARE you.', 'That’s SO cool, can I keep it?'] },
  marigold: { diction: 'Theatrical and romantic, flowery adjectives, swoons, “darling”, speaks in the language of flowers, matchmaking hints.', quirks: ['Darling, that’s positively peony!', 'Love is in the pollen.', 'Oh, my heart! A sunset like that!'] },
  gus: { diction: 'Slow barkeep cadence, few words, folksy wisdom that sums things up, says “pardner” now and then, wipes the bar between thoughts.', quirks: ['Mm. Chilli’s on.', 'Trouble’s just weather, pardner.', 'Pull up a stool.'] },
  theo: { diction: 'Dreamy and dramatic, speaks like song lyrics, dramatic pauses (“…”), rhymes by accident, calls things “a vibe”.', quirks: ['That’s… a whole song, man.', 'The turnips, they don’t judge.', 'It’s a vibe… a real vibe.'] },
  ivy: { diction: 'Art-school mystic. Colours have feelings, everything is a metaphor, critiques light and clouds, lowercase calm.', quirks: ['the light today is so… honest.', 'that’s a very ochre feeling.', 'everything is a canvas, really.'] },
  sam: { diction: 'Relentlessly upbeat, delivery puns, tracking-number precision for gossip, exclamation marks, quick-fire.', quirks: ['Special delivery!', 'Signed, sealed, delightful!', 'Package 4471-B: one fresh rumour!'] },
  nell: { diction: 'Retired schoolteacher: corrects grammar fondly, “back in my day”, calls adults “young man/young lady”, knitting asides.', quirks: ['“Fewer”, dear, not “less”.', 'Back in my day we walked uphill both ways.', 'I’ve knitted you a scarf. Don’t argue.'] },
  fern: { diction: 'Soft and calm, bee facts mid-sentence, buzzing puns (“bee-lieve”), treats hives like gossiping aunties.', quirks: ['Did you know bees dance to give directions?', 'I bee-lieve in you.', 'The queen is in a mood today.'] },
  rowan: { diction: 'Weather-beaten farm talk: deadpan about disaster, cow names, competitive about vegetables, “reckon” and “yep”.', quirks: ['Reckon it’ll rain. Always does.', 'Daisy the cow agrees.', 'Biggest pumpkin. Three years. Just saying.'] },
  lila: { diction: 'Flour-dusted optimist, baking puns (“you’re the yeast I could do”), sing-song, cheerful about catastrophes.', quirks: ['You’re the yeast I could do!', 'Oops, burnt it. Rustic!', 'Life’s short, eat the croissant.'] },
  felix: { diction: 'Absent-minded professor, cosmic perspective on tiny problems, star facts, trails off mid-sentence, “where are my glasses”.', quirks: ['In a billion years, will it matter? Probably not.', 'Ah, Venus is up. Where are my glasses?', 'Fascinating. Truly cosmic.'] },
  bea: { diction: 'Teen: “literally”, “lowkey”, “no cap”, eye-roll energy, roasts adults, short lowercase replies, secretly sweet.', quirks: ['literally iconic.', 'lowkey that’s cute ngl.', 'ok boomer. jk. kinda.'] },
};
export const voiceOf = (id) => VOICES[id] || { diction: 'Friendly and plain-spoken.', quirks: ['Hello there!'] };

// Shops and getaways the villagers can found. Building rect is local to the structure
// (door on the front edge); `obj` like the cottage layouts ([item, x, y, r]); `stock`
// is what the shelves carry; `stage` 2 objects come with the roof, `decor` at stage 3.
export const VENTURES = {
  bakery: { label: 'Bakery', icon: '🥐', biz: true, w: 7, h: 6, floor: 'floor_checker', outside: 'wall_stucco', inside: 'wall_subway', roof: 'roof_red', door: 'door_shop',
    obj: [['bakeryoven', 0, 0], ['counter', 2, 1], ['register', 3, 1], ['bakerycase', 4, 1], ['shelf', 6, 0, 1], ['table', 1, 3], ['chair', 1, 4, 2]],
    decor: [['chalkboard', 6, 4], ['houseplant', 0, 5]], outdoor: [['opensign', 0, 0], ['bench', 2, 0]],
    stock: ['bread', 'cake', 'pie', 'honeycake', 'flour'] },
  cafe: { label: 'Tea Room', icon: '🫖', biz: true, w: 7, h: 6, floor: 'floor_wood', outside: 'wall_sage', inside: 'wall_paper', roof: 'roof_green', door: 'door_glass',
    obj: [['counter', 2, 0], ['register', 3, 0], ['bakerycase', 4, 0], ['table', 1, 3], ['chair', 0, 3, 3], ['table', 5, 3], ['chair', 6, 3, 1]],
    decor: [['houseplant', 0, 0], ['lamp', 6, 0], ['candles', 3, 4]], outdoor: [['parasol', 0, 0], ['picnic', 2, 0]],
    stock: ['tea', 'honeycake', 'soup', 'juice', 'cake'] },
  florist: { label: 'Flower Shop', icon: '💐', biz: true, w: 6, h: 5, floor: 'floor_wood', outside: 'wall_white', inside: 'wall_paper', roof: 'roof_thatch', door: 'door_glass',
    obj: [['flowerbuckets', 0, 0], ['displaytable', 2, 2], ['counter', 4, 0], ['register', 5, 0]],
    decor: [['monstera', 0, 3], ['floorvase', 5, 3]], outdoor: [['flowerbed', 0, 0], ['flowerbed', 3, 0]],
    stock: ['bouquet', 'tea', 'berry'] },
  fishshack: { label: 'Fish Shack', icon: '🐟', biz: true, w: 6, h: 5, floor: 'floor_stone', outside: 'wall_wood', inside: 'wall_board', roof: 'roof_blue', door: 'door',
    obj: [['smoker', 0, 0], ['fishstall', 2, 2], ['counter', 4, 0], ['register', 5, 0]],
    decor: [['lantern', 0, 3], ['fishbowl', 5, 3]], outdoor: [['cratestack', 0, 0], ['lamppost', 3, 0]],
    stock: ['smokedfish', 'fishstew', 'trout', 'bass', 'carp'] },
  forge: { label: 'Forge', icon: '⚒️', biz: true, w: 7, h: 6, floor: 'floor_stone', outside: 'wall_stone', inside: 'wall_darkstone', roof: 'roof_red', door: 'door_double',
    obj: [['fireplace', 0, 0], ['displaytable', 3, 2], ['counter', 5, 0], ['register', 6, 0], ['chest', 0, 4]],
    decor: [['lantern', 6, 4], ['trophy', 2, 0]], outdoor: [['barreldisplay', 0, 0], ['lamppost', 3, 0]],
    stock: ['axe', 'pickaxe', 'scythe', 'wateringcan', 'bigcan'] },
  bookshop: { label: 'Bookshop', icon: '📚', biz: true, w: 7, h: 6, floor: 'floor_red', outside: 'wall_brick', inside: 'wall_wainscot', roof: 'roof_blue', door: 'door_glass',
    obj: [['bookshelf', 0, 0], ['bookshelf', 1, 0], ['displaytable', 3, 2], ['counter', 5, 0], ['register', 6, 0], ['armchair', 0, 4, 3]],
    decor: [['lamp', 1, 4], ['globe', 6, 4], ['rug', 3, 4]], outdoor: [['bench', 0, 0], ['lamppost', 3, 0]],
    stock: ['bookgift', 'tea'] },
  farmstand: { label: 'Farm Stand', icon: '🥕', biz: true, w: 6, h: 5, floor: 'floor_wood', outside: 'wall_board', inside: 'wall_wood', roof: 'roof_thatch', door: 'door_double',
    obj: [['producestand', 0, 0], ['producecart', 3, 2], ['counter', 4, 0], ['register', 5, 0]],
    decor: [['haybale', 0, 3], ['cornstalks', 5, 3]], outdoor: [['scarecrow', 0, 0], ['basketstack', 3, 0]],
    stock: ['pumpkin', 'melon', 'corn', 'egg', 'milk', 'apple'] },
  apiary: { label: 'Honey House', icon: '🍯', biz: true, w: 6, h: 5, floor: 'floor_wood', outside: 'wall_shingle', inside: 'wall_shiplap', roof: 'roof_thatch', door: 'door',
    obj: [['preservesjar', 0, 0], ['wallshelf', 2, 0], ['counter', 4, 0], ['register', 5, 0], ['displaytable', 2, 2]],
    decor: [['candles', 0, 3], ['houseplant', 5, 3]], outdoor: [['flowerbed', 0, 0], ['birdbath', 3, 0]],
    stock: ['honeycake', 'jam', 'tea'] },
  diner: { label: 'Diner', icon: '🍲', biz: true, w: 8, h: 6, floor: 'floor_checker', outside: 'wall_paintbrick', inside: 'wall_subway', roof: 'roof_red', door: 'door_double',
    obj: [['stove', 0, 0], ['soupot', 1, 0], ['counter', 3, 1], ['register', 4, 1], ['coolercase', 7, 0, 1], ['table', 1, 3], ['chair', 1, 4, 2], ['table', 5, 3], ['chair', 5, 4, 2]],
    decor: [['recordplayer', 7, 4], ['houseplant', 0, 5]], outdoor: [['opensign', 0, 0], ['picnic', 2, 0]],
    stock: ['soup', 'fishstew', 'pie', 'juice', 'bread'] },
  knits: { label: 'Wool & Yarn', icon: '🧶', biz: true, w: 6, h: 5, floor: 'floor_blue', outside: 'wall_blue', inside: 'wall_paper', roof: 'roof_blue', door: 'door_glass',
    obj: [['loom', 0, 0], ['shelf', 2, 0], ['counter', 4, 0], ['register', 5, 0], ['rockingchair', 0, 3]],
    decor: [['basketstack', 5, 3], ['lamp', 2, 3]], outdoor: [['bench', 0, 0], ['flowerbed', 3, 0]],
    stock: ['wool', 'cloth'] },
  cabin: { label: 'Cabin', icon: '🛖', biz: false, w: 6, h: 5, floor: 'floor_wood', outside: 'wall_wood', inside: 'wall_board', roof: 'roof_green', door: 'door',
    obj: [['bed', 0, 0], ['fireplace', 3, 0], ['rug', 2, 2], ['armchair', 4, 2, 3]],
    decor: [['lantern', 0, 3], ['bookshelf', 5, 0], ['houseplant', 5, 3]], outdoor: [['firepit', 0, 0], ['bench', 2, 0]] },
  garden: { label: 'Garden', icon: '🌷', biz: false, w: 7, h: 5, open: true,
    obj: [['flowerbed', 0, 0], ['flowerbed', 2, 0], ['flowerbed', 4, 0], ['bench', 2, 3]],
    decor: [['birdbath', 6, 0], ['stonelantern', 0, 3], ['gnome', 5, 3], ['trellis', 6, 3]], outdoor: [['lamppost', 0, 0]] },
};

// What each villager dreams of building, and who they'd love to build it with.
export const AMBITIONS = {
  rosa: { kind: 'cafe', partners: ['lila', 'fern'] }, otto: { kind: 'cabin', partners: ['bram'] }, juniper: { kind: 'garden', partners: ['marigold', 'fern'] },
  hazel: { kind: 'fishshack', partners: ['gus', 'rowan'] }, bram: { kind: 'forge', partners: ['otto', 'rowan'] }, willa: { kind: 'bookshop', partners: ['nell', 'felix'] },
  ellis: { kind: 'garden', partners: ['fern', 'nell'] }, pip: { kind: 'farmstand', partners: ['rowan', 'bea'] }, marigold: { kind: 'florist', partners: ['juniper', 'ivy'] },
  gus: { kind: 'diner', partners: ['hazel', 'lila'] }, theo: { kind: 'cafe', partners: ['ivy', 'gus'] }, ivy: { kind: 'cabin', partners: ['theo', 'felix'] },
  sam: { kind: 'diner', partners: ['gus', 'bea'] }, nell: { kind: 'knits', partners: ['willa', 'marigold'] }, fern: { kind: 'apiary', partners: ['lila', 'rosa'] },
  rowan: { kind: 'farmstand', partners: ['pip', 'hazel'] }, lila: { kind: 'bakery', partners: ['rosa', 'fern'] }, felix: { kind: 'bookshop', partners: ['willa'] },
  bea: { kind: 'cafe', partners: ['theo', 'pip'] },
};
// Things they make or grow themselves and will sell you on the spot.
export const WARES = {
  rosa: ['honeycake', 'tea'], otto: ['bookgift'], juniper: ['bouquet', 'berry'], hazel: ['sunfish', 'carp', 'smokedfish'], bram: ['axe', 'pickaxe', 'wateringcan'],
  willa: ['bookgift'], ellis: ['tea', 'soup'], pip: ['apple', 'berry'], marigold: ['bouquet'], gus: ['soup', 'fishstew'], theo: ['bookgift'], ivy: ['bouquet'],
  sam: ['tea', 'bookgift'], nell: ['wool', 'cloth'], fern: ['honeycake', 'jam'], rowan: ['pumpkin', 'egg', 'milk', 'corn'], lila: ['bread', 'cake', 'pie'], felix: ['bookgift', 'tea'], bea: ['juice', 'apple'],
};
// Money they bring in from their day job (coins a day), and what they start with.
export const WAGE = { rosa: 120, otto: 110, juniper: 70, mabel: 90, hazel: 80, bram: 100, willa: 70, ellis: 120, pip: 15, marigold: 80, gus: 110, theo: 50, ivy: 60, sam: 80, nell: 60, fern: 80, rowan: 90, lila: 90, felix: 70, bea: 20 };
export const START_WALLET = (id) => 300 + (WAGE[id] || 60) * 4;

// Each build stage: what it costs and what goes up.
export const STAGES = [
  { label: 'Foundations & walls', cost: 0.45 },
  { label: 'Roof & fittings', cost: 0.35 },
  { label: 'Finishing touches', cost: 0.2 },
];
export const ventureCost = (kind) => { const v = VENTURES[kind]; return v.biz ? 900 : 600; };

// Decorations a villager might buy to spruce a place up.
export const DECOR = ['houseplant', 'lamp', 'floorvase', 'candles', 'rug', 'monstera', 'succulents', 'lantern', 'cactus', 'endtable'];
export const YARD_DECOR = ['flowerbed', 'bench', 'birdbath', 'lamppost', 'stonelantern', 'bush', 'gnome', 'picnic'];

// Where the structure sits on the lot: a spot the size of the building (plus a strip in
// front for the yard) away from road tiles, its front facing the road.
export function siteFor(plot, kind, world, entrance) {
  const v = VENTURES[kind];
  const w = v.w, h = v.h + 2;
  if (w + 2 > plot.w || h + 1 > plot.h) return null;
  const front = entrance && entrance.y < (plot.y + plot.h / 2) * 16 ? 'n' : 's';
  const clear = (x, y) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (!inInterior(plot, x + i, y + j) || roadIn(world, plot, x + i, y + j)) return false; return true; };
  const cx = Math.floor((plot.w - w) / 2);
  const ys = front === 's' ? [plot.h - h - 1, plot.h - h, plot.h - h - 2, 1] : [1, 2, 0, plot.h - h - 1];
  for (const y of ys) for (const dx of [0, -1, 1, -2, 2]) {
    const x = cx + dx;
    if (y >= 0 && x >= 0 && clear(x, y)) return { x, y: front === 's' ? y : y + 2, w, h: v.h, face: front, yardY: front === 's' ? y + v.h : y };
  }
  return null;
}

// Put up one stage of the structure (0: floor, walls, door and windows; 1: roof and
// fittings; 2: decor and the yard). Returns the number of things placed.
export function buildStage(plot, kind, site, stage, world) {
  const v = VENTURES[kind];
  const { x: bx, y: by, w, h, face } = site;
  const north = face === 'n';
  let n = 0;
  const put = (t, x, y0, r0 = 0, yard = false) => {
    const [, fh] = sizeOf(t, r0);
    const y = yard ? site.yardY + (north ? 1 - y0 : y0) : by + (north ? h - y0 - fh : y0);
    const r = !yard && north && r0 % 2 === 0 ? (r0 + 2) % 4 : r0;
    const lx = bx + x;
    if (placementError(plot, lx, y, t, r, 0, world)) return;
    plot.obj[`${lx},${y}`] = r ? { t, r } : { t };
    n++;
  };
  if (stage === 0) {
    if (!v.open) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { plot.floor[`${bx + x},${by + y}`] = v.floor; n++; }
      const out = v.outside, inn = v.inside;
      for (let x = 0; x < w; x++) {
        plot.walls[edgeKey(0, 'h', bx + x, by)] = { m: out, o: inn };
        plot.walls[edgeKey(0, 'h', bx + x, by + h)] = { m: inn, o: out };
      }
      for (let y = 0; y < h; y++) {
        plot.walls[edgeKey(0, 'v', bx, by + y)] = { m: out, o: inn };
        plot.walls[edgeKey(0, 'v', bx + w, by + y)] = { m: inn, o: out };
      }
      const door = Math.floor(w / 2) - 1, front = north ? by : by + h, back = north ? by + h : by;
      const dw = ITEMS[v.door]?.width || 1;
      plot.walls[edgeKey(0, 'h', bx + door, front)].f = v.door;
      if (dw > 1) plot.walls[edgeKey(0, 'h', bx + door + 1, front)].f = v.door;
      plot.walls[edgeKey(0, 'h', bx, front)].f = v.biz ? 'window_shop' : 'window';
      plot.walls[edgeKey(0, 'h', bx + w - 1, front)].f = v.biz ? 'window_shop' : 'window';
      plot.walls[edgeKey(0, 'h', bx + w - 2, back)].f = 'window';
      plot.walls[edgeKey(0, 'v', bx, by + Math.floor(h / 2))].f = 'window';
      plot.walls[edgeKey(0, 'v', bx + w, by + Math.floor(h / 2))].f = 'window';
      n += w * 2 + h * 2;
    } else for (const [t, x, y, r] of v.obj.slice(0, 2)) put(t, x, y, r);
  } else if (stage === 1) {
    if (!v.open) { plot.roofs = [...(plot.roofs || []), { x: bx, y: by, w, h, l: 0, m: v.roof }]; n++; }
    for (const [t, x, y, r] of v.open ? v.obj.slice(2) : v.obj) put(t, x, y, r);
  } else {
    for (const [t, x, y, r] of v.decor || []) put(t, x, y, r);
    // Yard things go either side of the path to the door.
    (v.outdoor || []).forEach(([t, , y, r], k) => put(t, k % 2 ? w - sizeOf(t, r)[0] : 0, y, r, true));
  }
  return n;
}
const sizeOf = (t, r = 0) => { const [w, h] = ITEMS[t]?.size || [1, 1]; return r % 2 ? [h, w] : [w, h]; };

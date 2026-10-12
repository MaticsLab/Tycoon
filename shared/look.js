// Character appearance: what the character creator edits, what the server stores on
// a profile and what every client paints. All fields are small integers so a look is
// cheap to validate and to send around.
//
//   body   0 | 1             broader or narrower build (with lashes)
//   skin   index into SKINS
//   hair   index into HAIR (style)
//   shirt  index into SHIRTS (design + colours)
//   acc    index into ACCESSORIES
//   eyes, hairColor, pants   [hue, saturation, value], each 0..100

export const SKINS = [
  '#ffe0c8', '#fbd3b4', '#f6c7a0', '#f2c79a', '#ecb98c', '#e8b48a', '#dea47a', '#d9a679',
  '#cf9467', '#c08158', '#b0714b', '#9c6240', '#8a5536', '#77472c', '#663b24', '#55301d',
  '#f3d1c4', '#e6bfae', '#d8ab90', '#bfe0a8', '#a9c9ef', '#d8b8ec', '#9a9a9a', '#f5eedc',
];

// vol: extra height on top · fringe: front hair · len: 0 ears, 1 chin, 2 shoulders, 3 long
// extra: bun, pony, pigtails, curly, spiky
export const HAIR = [
  { name: 'Tousled', vol: 1, fringe: 'side', len: 0 },
  { name: 'Neat part', vol: 1, fringe: 'part', len: 0 },
  { name: 'Shaggy', vol: 1, fringe: 'full', len: 1 },
  { name: 'Spiky', vol: 2, fringe: 'spiky', len: 0, extra: 'spiky' },
  { name: 'Buzz', vol: 0, fringe: 'none', len: 0 },
  { name: 'Bob', vol: 1, fringe: 'full', len: 1 },
  { name: 'Shoulder', vol: 1, fringe: 'side', len: 2 },
  { name: 'Long', vol: 1, fringe: 'part', len: 3 },
  { name: 'Ponytail', vol: 1, fringe: 'side', len: 0, extra: 'pony' },
  { name: 'Bun', vol: 1, fringe: 'part', len: 0, extra: 'bun' },
  { name: 'Pigtails', vol: 1, fringe: 'full', len: 0, extra: 'pigtails' },
  { name: 'Curly', vol: 2, fringe: 'full', len: 1, extra: 'curly' },
  { name: 'Wavy long', vol: 2, fringe: 'side', len: 3, extra: 'curly' },
  { name: 'Swoop', vol: 2, fringe: 'swoop', len: 0 },
  { name: 'Mohawk', vol: 2, fringe: 'none', len: 0, extra: 'mohawk' },
  { name: 'Bald', vol: 0, fringe: 'bald', len: 0 },
];

// kind decides the pattern; a is the main colour, b the second one.
export const SHIRTS = [
  { name: 'Overalls', kind: 'overalls', a: '#3b5ea8', b: '#f2c94c' },
  { name: 'Open jacket', kind: 'jacket', a: '#d98b1f', b: '#2f4f9a' },
  { name: 'Tee', kind: 'tee', a: '#d64541', b: '#f2efe6' },
  { name: 'Striped tee', kind: 'stripes', a: '#2e86c1', b: '#f2efe6' },
  { name: 'Hoodie', kind: 'hoodie', a: '#4f8f3a', b: '#e9e3d0' },
  { name: 'Polo', kind: 'polo', a: '#2a9d8f', b: '#f2efe6' },
  { name: 'Sweater', kind: 'sweater', a: '#9b3d5a', b: '#f0c75e' },
  { name: 'Vest', kind: 'vest', a: '#6b4a2b', b: '#ece4d2' },
  { name: 'Sundress', kind: 'dress', a: '#2f6fd6', b: '#e8b33a' },
  { name: 'Apron', kind: 'apron', a: '#d35400', b: '#fdf2e0' },
  { name: 'Flannel', kind: 'flannel', a: '#b03a2e', b: '#2b2b2b' },
  { name: 'Work shirt', kind: 'collar', a: '#2c5d8a', b: '#a8c6e0' },
  { name: 'Cardigan', kind: 'jacket', a: '#e8a3b8', b: '#f7f1e3' },
  { name: 'Green jacket', kind: 'jacket', a: '#3e7a3a', b: '#e9c46a' },
  { name: 'Tank top', kind: 'tank', a: '#f1c40f', b: '#ffffff' },
  { name: 'Purple dress', kind: 'dress', a: '#7d4fb0', b: '#f2d0ff' },
  { name: 'Dungarees', kind: 'overalls', a: '#9a4b2a', b: '#e8e0d0' },
  { name: 'Sailor', kind: 'sailor', a: '#f2efe6', b: '#2f4f9a' },
  { name: 'Leather jacket', kind: 'jacket', a: '#2b2420', b: '#c0392b' },
  { name: 'Gardening smock', kind: 'apron', a: '#27ae60', b: '#e8c97a' },
];

export const ACCESSORIES = [
  { name: 'None' },
  { name: 'Glasses', kind: 'glasses', color: '#2a2a2a' },
  { name: 'Round glasses', kind: 'round', color: '#a0742a' },
  { name: 'Sunglasses', kind: 'shades', color: '#151515' },
  { name: 'Beard', kind: 'beard' },
  { name: 'Moustache', kind: 'moustache' },
  { name: 'Stubble', kind: 'stubble' },
  { name: 'Freckles', kind: 'freckles' },
  { name: 'Rosy cheeks', kind: 'blush' },
  { name: 'Hair bow', kind: 'bow', color: '#e0457b' },
  { name: 'Flower', kind: 'flower', color: '#f5f0f8' },
  { name: 'Cap', kind: 'cap', color: '#c0392b' },
  { name: 'Straw hat', kind: 'sunhat', color: '#e8c97a' },
  { name: 'Beanie', kind: 'beanie', color: '#3d6fa8' },
  { name: 'Headband', kind: 'headband', color: '#2ecc71' },
  { name: 'Earrings', kind: 'earrings', color: '#f1c40f' },
  { name: 'Eyepatch', kind: 'patch', color: '#1a1a1a' },
  { name: 'Bandana', kind: 'bandana', color: '#c0392b' },
];

const clampInt = (v, lo, hi, d) => (Number.isInteger(v) && v >= lo && v <= hi ? v : d);
const hsv3 = (v, d) => (Array.isArray(v) && v.length === 3 ? v.map((x, i) => clampInt(Math.round(x), 0, 100, d[i])) : d);

export const DEFAULT_LOOK = Object.freeze({ body: 0, skin: 3, hair: 0, shirt: 0, acc: 0, eyes: [55, 60, 55], hairColor: [6, 70, 45], pants: [62, 55, 40] });

// Any untrusted object -> a valid look (missing or bad fields fall back to the default).
export function sanitizeLook(l) {
  const d = DEFAULT_LOOK;
  if (!l || typeof l !== 'object') return { ...d, eyes: [...d.eyes], hairColor: [...d.hairColor], pants: [...d.pants] };
  return {
    body: clampInt(l.body, 0, 1, d.body),
    skin: clampInt(l.skin, 0, SKINS.length - 1, d.skin),
    hair: clampInt(l.hair, 0, HAIR.length - 1, d.hair),
    shirt: clampInt(l.shirt, 0, SHIRTS.length - 1, d.shirt),
    acc: clampInt(l.acc, 0, ACCESSORIES.length - 1, d.acc),
    eyes: hsv3(l.eyes, d.eyes),
    hairColor: hsv3(l.hairColor, d.hairColor),
    pants: hsv3(l.pants, d.pants),
  };
}

const NATURAL_HAIR = [[6, 70, 45], [8, 75, 25], [10, 55, 70], [12, 80, 95], [4, 80, 60], [0, 0, 15], [14, 40, 92], [0, 0, 75], [95, 50, 60], [55, 60, 80]];
export function randomLook(rand = Math.random) {
  const pick = (n) => Math.floor(rand() * n);
  const r100 = () => pick(101);
  return sanitizeLook({
    body: pick(2), skin: pick(16), hair: pick(HAIR.length - 1), shirt: pick(SHIRTS.length),
    acc: rand() < 0.4 ? 0 : pick(ACCESSORIES.length),
    eyes: [r100(), 40 + pick(50), 35 + pick(50)],
    hairColor: rand() < 0.75 ? NATURAL_HAIR[pick(NATURAL_HAIR.length)] : [r100(), 50 + pick(50), 50 + pick(50)],
    pants: [r100(), 20 + pick(70), 20 + pick(60)],
  });
}

// [h, s, v] in 0..100 -> '#rrggbb'
export function hsvHex([h, s, v]) {
  h = (h / 100) * 6; s /= 100; v /= 100;
  const i = Math.floor(h) % 6, f = h - Math.floor(h);
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i];
  return '#' + [r, g, b].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

// The main colour of a look's shirt (name tags, map dots).
export const shirtColor = (look) => SHIRTS[sanitizeLook(look).shirt].a;

// A stable string for caching sprites of one look.
export const lookKey = (l) => [l.body, l.skin, l.hair, l.shirt, l.acc, ...l.eyes, ...l.hairColor, ...l.pants].join('.');
